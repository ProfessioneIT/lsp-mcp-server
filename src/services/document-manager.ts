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
 * Create a unique key for tracking document state per client.
 */
function createDocKey(uri: string, clientId: string): string {
  return `${uri}:${clientId}`;
}

/**
 * Manages document synchronization with language servers.
 */
export class DocumentManagerImpl implements IDocumentManager {
  private documents = new Map<string, DocumentState>();
  private versionCounters = new Map<string, number>();
  private openLocks = new Map<string, Promise<void>>();

  /**
   * Open a document with a specific client.
   */
  async openDocument(uri: string, client: LSPClient): Promise<void> {
    const docKey = createDocKey(uri, client.serverId);

    // Check if already open with this client
    const existing = this.documents.get(docKey);
    if (existing && existing.openWithClients.has(client.serverId)) {
      return;
    }

    // Check for concurrent opens
    const existingLock = this.openLocks.get(docKey);
    if (existingLock) {
      await existingLock;
      return;
    }

    const openPromise = this.openDocumentInternal(uri, client, docKey);
    this.openLocks.set(docKey, openPromise);

    try {
      await openPromise;
    } finally {
      this.openLocks.delete(docKey);
    }
  }

  /**
   * Ensure a document is open (idempotent).
   */
  async ensureOpen(uri: string, client: LSPClient): Promise<void> {
    return this.openDocument(uri, client);
  }

  /**
   * Close a document for a specific client.
   */
  async closeDocument(uri: string, client: LSPClient): Promise<void> {
    const docKey = createDocKey(uri, client.serverId);
    const doc = this.documents.get(docKey);

    if (!doc) {
      return;
    }

    doc.openWithClients.delete(client.serverId);

    if (doc.openWithClients.size === 0) {
      // No clients have this document open, close it
      try {
        client.didClose(uri);
      } catch (error) {
        logger.warn(`Error closing document: ${uri}`, error);
      }

      this.documents.delete(docKey);
      // Clean up version counter to prevent memory leak
      this.versionCounters.delete(uri);
      logger.debug(`Closed document: ${uri}`);
    }
  }

  /**
   * Update document content (for unsaved changes).
   */
  async updateContent(uri: string, content: string, client: LSPClient): Promise<void> {
    const docKey = createDocKey(uri, client.serverId);
    const doc = this.documents.get(docKey);

    if (!doc) {
      // Document not open, open it first with the new content
      await this.openDocument(uri, client);
      return;
    }

    // Increment version
    const newVersion = this.getNextVersion(uri);
    doc.version = newVersion;
    doc.content = content;

    // Send didChange notification
    try {
      client.didChange(uri, newVersion, [{ text: content }]);
      logger.debug(`Updated document: ${uri}`, { version: newVersion });
    } catch (error) {
      logger.warn(`Error updating document: ${uri}`, error);
    }
  }

  /**
   * Get current content for a URI.
   */
  getContent(uri: string): string | undefined {
    // Find any document state with this URI
    for (const [key, doc] of this.documents) {
      if (key.startsWith(uri + ':')) {
        return doc.content;
      }
    }
    return undefined;
  }

  /**
   * Check if document is open with a specific client.
   */
  isOpen(uri: string, client: LSPClient): boolean {
    const docKey = createDocKey(uri, client.serverId);
    const doc = this.documents.get(docKey);
    return doc?.openWithClients.has(client.serverId) ?? false;
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

  private async openDocumentInternal(
    uri: string,
    client: LSPClient,
    docKey: string
  ): Promise<void> {
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

    // Create or update document state
    let doc = this.documents.get(docKey);
    if (!doc) {
      doc = {
        uri,
        content,
        version,
        languageId,
        openWithClients: new Set(),
      };
      this.documents.set(docKey, doc);
    } else {
      doc.content = content;
      doc.version = version;
    }

    doc.openWithClients.add(client.serverId);

    // Convert path to URI for LSP
    const lspUri = uri.startsWith('file://') ? uri : pathToUri(uri);

    // Send didOpen notification
    try {
      client.didOpen({
        uri: lspUri,
        languageId,
        version,
        text: content,
      });

      logger.debug(`Opened document: ${uri}`, {
        languageId,
        version,
        contentLength: content.length,
      });
    } catch (error) {
      // Remove from tracking if didOpen fails
      doc.openWithClients.delete(client.serverId);
      if (doc.openWithClients.size === 0) {
        this.documents.delete(docKey);
      }
      throw error;
    }
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
