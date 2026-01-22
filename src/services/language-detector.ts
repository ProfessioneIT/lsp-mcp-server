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
