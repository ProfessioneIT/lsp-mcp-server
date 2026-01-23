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
