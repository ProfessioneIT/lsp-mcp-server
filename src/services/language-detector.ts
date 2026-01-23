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

import type { LSPServerConfig } from '../types.js';
import { getExtension } from '../utils/uri.js';
import { DEFAULT_SERVERS } from '../constants.js';

/**
 * Detects the appropriate language server for a file.
 */
export class LanguageDetector {
  constructor(private readonly servers: LSPServerConfig[] = DEFAULT_SERVERS) {}

  /**
   * Get the server configuration for a file path.
   */
  getServerForFile(filePath: string): LSPServerConfig | undefined {
    const ext = getExtension(filePath);
    return this.servers.find(s => s.extensions.includes(ext));
  }

  /**
   * Get the server configuration by ID.
   */
  getServerById(serverId: string): LSPServerConfig | undefined {
    return this.servers.find(s => s.id === serverId);
  }

  /**
   * Get the server configuration for a language ID.
   */
  getServerForLanguage(languageId: string): LSPServerConfig | undefined {
    return this.servers.find(s => s.languageIds.includes(languageId));
  }

  /**
   * Check if a file extension is supported.
   */
  isExtensionSupported(extension: string): boolean {
    const ext = extension.startsWith('.') ? extension : `.${extension}`;
    return this.servers.some(s => s.extensions.includes(ext));
  }

  /**
   * Get all supported file extensions.
   */
  getSupportedExtensions(): string[] {
    const extensions = new Set<string>();
    for (const server of this.servers) {
      for (const ext of server.extensions) {
        extensions.add(ext);
      }
    }
    return [...extensions];
  }

  /**
   * Get all supported language IDs.
   */
  getSupportedLanguageIds(): string[] {
    const languageIds = new Set<string>();
    for (const server of this.servers) {
      for (const id of server.languageIds) {
        languageIds.add(id);
      }
    }
    return [...languageIds];
  }

  /**
   * Get all configured server IDs.
   */
  getServerIds(): string[] {
    return this.servers.map(s => s.id);
  }
}

/**
 * Create a language detector instance.
 */
export function createLanguageDetector(
  servers?: LSPServerConfig[]
): LanguageDetector {
  return new LanguageDetector(servers);
}
