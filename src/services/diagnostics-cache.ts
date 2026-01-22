import type { Diagnostic } from 'vscode-languageserver-protocol';
import type { DiagnosticsCache as IDiagnosticsCache } from '../types.js';
import { logger } from '../utils/logger.js';

/**
 * Caches diagnostics received from language servers via publishDiagnostics notifications.
 *
 * Diagnostics in LSP are push-based - servers send them proactively when files change.
 * This cache stores them so tools can retrieve them on demand.
 */
export class DiagnosticsCacheImpl implements IDiagnosticsCache {
  private cache = new Map<string, Diagnostic[]>();

  /**
   * Update cached diagnostics for a URI.
   * Called when publishDiagnostics notification is received.
   */
  update(uri: string, diagnostics: Diagnostic[]): void {
    this.cache.set(uri, diagnostics);

    logger.debug(`Updated diagnostics cache: ${uri}`, {
      count: diagnostics.length,
      errors: diagnostics.filter(d => d.severity === 1).length,
      warnings: diagnostics.filter(d => d.severity === 2).length,
    });
  }

  /**
   * Get cached diagnostics for a URI.
   */
  get(uri: string): Diagnostic[] {
    return this.cache.get(uri) ?? [];
  }

  /**
   * Clear diagnostics for a URI.
   * Called when document is closed.
   */
  clear(uri: string): void {
    this.cache.delete(uri);
    logger.debug(`Cleared diagnostics cache: ${uri}`);
  }

  /**
   * Clear all cached diagnostics.
   * Called when server restarts.
   */
  clearAll(): void {
    this.cache.clear();
    logger.debug('Cleared all diagnostics cache');
  }

  /**
   * Get all URIs with cached diagnostics.
   */
  getUris(): string[] {
    return [...this.cache.keys()];
  }

  /**
   * Get total count of diagnostics across all files.
   */
  getTotalCount(): number {
    let total = 0;
    for (const diagnostics of this.cache.values()) {
      total += diagnostics.length;
    }
    return total;
  }

  /**
   * Get summary of diagnostics across all files.
   */
  getSummary(): { errors: number; warnings: number; info: number; hints: number } {
    let errors = 0;
    let warnings = 0;
    let info = 0;
    let hints = 0;

    for (const diagnostics of this.cache.values()) {
      for (const d of diagnostics) {
        switch (d.severity) {
          case 1: errors++; break;
          case 2: warnings++; break;
          case 3: info++; break;
          case 4: hints++; break;
        }
      }
    }

    return { errors, warnings, info, hints };
  }
}

/**
 * Create a diagnostics cache instance.
 */
export function createDiagnosticsCache(): IDiagnosticsCache {
  return new DiagnosticsCacheImpl();
}
