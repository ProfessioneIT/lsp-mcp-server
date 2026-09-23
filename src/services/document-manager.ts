/**
 * Copyright (c) 2026 Ivan Iraci <ivan.iraci@professioneit.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import type {
  DocumentManager as IDocumentManager,
  DocumentState,
  LSPClient,
} from '../types.js';
import { logger } from '../utils/logger.js';
import { readFile, pathToUri, getExtension } from '../utils/uri.js';

// Map from file extension to language ID
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.pyi': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.hpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.scala': 'scala',
  '.lua': 'lua',
  '.sh': 'shellscript',
  '.bash': 'shellscript',
  '.zsh': 'shellscript',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.xml': 'xml',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'sass',
  '.less': 'less',
  '.md': 'markdown',
  '.sql': 'sql',
  '.graphql': 'graphql',
  '.gql': 'graphql',
};

/**
 * Get the language ID for a file path.
 */
function getLanguageId(filePath: string): string {
  const ext = getExtension(filePath);
  return EXTENSION_TO_LANGUAGE[ext] ?? 'plaintext';
}

/**
 * Manages document synchronization with language servers.
 *
 * Open state is tracked per client *instance*, not per server id: the same
 * server id can run several instances (one per workspace root), and a crashed
 * or stopped server is replaced by a new client object. Each instance must
 * receive its own didOpen, so documents are keyed by the client object itself.
 * A WeakMap lets state for discarded clients be garbage-collected.
 */
export class DocumentManagerImpl implements IDocumentManager {
  private documentsByClient = new WeakMap<LSPClient, Map<string, DocumentState>>();
  private clientIds = new WeakMap<LSPClient, number>();
  private nextClientId = 1;
  private latestContent = new Map<string, string>();
  private versionCounters = new Map<string, number>();
  private openLocks = new Map<string, Promise<void>>();

  /**
   * Open a document with a specific client instance.
   */
  async openDocument(uri: string, client: LSPClient): Promise<void> {
    if (this.docsFor(client).has(uri)) {
      return;
    }

    // Serialize concurrent opens of the same document on the same instance
    const lockKey = `${this.clientId(client)}\u0000${uri}`;
    const existingLock = this.openLocks.get(lockKey);
    if (existingLock) {
      await existingLock;
      return;
    }

    const openPromise = this.openDocumentInternal(uri, client);
    this.openLocks.set(lockKey, openPromise);

    try {
      await openPromise;
    } finally {
      this.openLocks.delete(lockKey);
    }
  }

  /**
   * Ensure a document is open (idempotent).
   */
  async ensureOpen(uri: string, client: LSPClient): Promise<void> {
    return this.openDocument(uri, client);
  }

  /**
   * Close a document in a specific client instance.
   */
  async closeDocument(uri: string, client: LSPClient): Promise<void> {
    const docs = this.docsFor(client);
    if (!docs.has(uri)) {
      return;
    }

    docs.delete(uri);
    try {
      client.didClose(uri);
    } catch (error) {
      logger.warn(`Error closing document: ${uri}`, error);
    }
    logger.debug(`Closed document: ${uri}`);
  }

  /**
   * Update document content (for unsaved changes).
   */
  async updateContent(uri: string, content: string, client: LSPClient): Promise<void> {
    const doc = this.docsFor(client).get(uri);

    if (!doc) {
      // Document not open, open it first with the new content
      await this.openDocument(uri, client);
      return;
    }

    // Increment version
    const newVersion = this.getNextVersion(uri);
    doc.version = newVersion;
    doc.content = content;
    this.latestContent.set(uri, content);

    // Send didChange notification
    try {
      client.didChange(uri, newVersion, [{ text: content }]);
      logger.debug(`Updated document: ${uri}`, { version: newVersion });
    } catch (error) {
      logger.warn(`Error updating document: ${uri}`, error);
    }
  }

  /**
   * Get the most recently opened or updated content for a URI.
   */
  getContent(uri: string): string | undefined {
    return this.latestContent.get(uri);
  }

  /**
   * Check if document is open in a specific client instance.
   */
  isOpen(uri: string, client: LSPClient): boolean {
    return this.docsFor(client).has(uri);
  }

  /**
   * List the documents open in a specific client instance.
   */
  getOpenUris(client: LSPClient): string[] {
    return [...this.docsFor(client).keys()];
  }

  /**
   * Get current version for a URI.
   */
  getVersion(uri: string): number {
    return this.versionCounters.get(uri) ?? 0;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async openDocumentInternal(uri: string, client: LSPClient): Promise<void> {
    // Convert file:// URI to path for reading
    let filePath: string;
    if (uri.startsWith('file://')) {
      filePath = uri.slice(7);
      if (process.platform === 'win32' && filePath.startsWith('/')) {
        filePath = filePath.slice(1);
      }
      filePath = decodeURIComponent(filePath);
    } else {
      filePath = uri;
    }

    // Read file content
    const content = await readFile(filePath);
    const languageId = getLanguageId(filePath);
    const version = this.getNextVersion(uri);

    const doc: DocumentState = {
      uri,
      content,
      version,
      languageId,
      openWithClients: new Set([client.serverId]),
    };

    // Convert path to URI for LSP
    const lspUri = uri.startsWith('file://') ? uri : pathToUri(uri);

    // Send didOpen notification; only track the document once it succeeded
    client.didOpen({
      uri: lspUri,
      languageId,
      version,
      text: content,
    });

    this.docsFor(client).set(uri, doc);
    this.latestContent.set(uri, content);

    logger.debug(`Opened document: ${uri}`, {
      languageId,
      version,
      contentLength: content.length,
    });
  }

  private docsFor(client: LSPClient): Map<string, DocumentState> {
    let docs = this.documentsByClient.get(client);
    if (!docs) {
      docs = new Map();
      this.documentsByClient.set(client, docs);
    }
    return docs;
  }

  private clientId(client: LSPClient): number {
    let id = this.clientIds.get(client);
    if (id === undefined) {
      id = this.nextClientId++;
      this.clientIds.set(client, id);
    }
    return id;
  }

  private getNextVersion(uri: string): number {
    const current = this.versionCounters.get(uri) ?? 0;
    const next = current + 1;
    this.versionCounters.set(uri, next);
    return next;
  }
}

/**
 * Create a document manager instance.
 */
export function createDocumentManager(): IDocumentManager {
  return new DocumentManagerImpl();
}
