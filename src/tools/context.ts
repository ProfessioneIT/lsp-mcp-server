import type { ConnectionManager, DocumentManager, DiagnosticsCache, Config } from '../types.js';

/**
 * Context passed to tool handlers containing shared services.
 */
export interface ToolContext {
  connectionManager: ConnectionManager;
  documentManager: DocumentManager;
  diagnosticsCache: DiagnosticsCache;
  config: Config;
}

/**
 * Global tool context - initialized when the server starts.
 */
let toolContext: ToolContext | null = null;

/**
 * Set the global tool context.
 */
export function setToolContext(ctx: ToolContext): void {
  toolContext = ctx;
}

/**
 * Get the global tool context.
 */
export function getToolContext(): ToolContext {
  if (!toolContext) {
    throw new Error('Tool context not initialized. Call setToolContext first.');
  }
  return toolContext;
}
