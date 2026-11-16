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

import type { Config, ConnectionManager, LSPClient } from '../../../src/types.js';
import { DocumentManagerImpl } from '../../../src/services/document-manager.js';
import { DiagnosticsCacheImpl } from '../../../src/services/diagnostics-cache.js';
import type { ToolContext } from '../../../src/tools/context.js';

/**
 * A complete `LSPClient` whose language features all reject, so a test that
 * reaches one it did not override is told, rather than answered falsely.
 * Override only what the code under test uses.
 */
export function createFakeLspClient(
  workspaceRoot: string,
  overrides: Partial<LSPClient> = {}
): LSPClient {
  const unused = () => Promise.reject(new Error('fake LSPClient: unexpected call'));

  const base: LSPClient = {
    initialize: unused,
    shutdown: () => Promise.resolve(),
    exit: () => {},

    didOpen: () => {},
    didChange: () => {},
    didClose: () => {},
    didSave: () => {},
    waitForDiagnostics: () => Promise.resolve(true),
    waitForServerWork: () => Promise.resolve(),
    didDeleteFiles: () => {},

    definition: unused,
    typeDefinition: unused,
    references: unused,
    implementation: unused,
    hover: unused,
    signatureHelp: unused,
    documentSymbols: unused,
    workspaceSymbols: unused,
    completion: unused,
    prepareRename: unused,
    rename: unused,

    codeActions: () => Promise.resolve([]),
    resolveCodeAction: unused,

    prepareCallHierarchy: unused,
    callHierarchyIncomingCalls: unused,
    callHierarchyOutgoingCalls: unused,

    prepareTypeHierarchy: unused,
    typeHierarchySupertypes: unused,
    typeHierarchySubtypes: unused,

    formatDocument: unused,

    documentHighlight: unused,
    inlayHints: unused,
    selectionRange: unused,
    foldingRanges: unused,

    cancelRequest: () => {},

    getCachedDiagnostics: () => [],
    supportsPullDiagnostics: () => false,
    hasPushedDiagnostics: () => false,
    pullDiagnostics: unused,

    capabilities: {},
    isInitialized: true,
    workspaceRoot,
    serverId: 'test',

    onDiagnostics: () => {},
    onError: () => {},
    onExit: () => {},
  };

  return { ...base, ...overrides };
}

/**
 * A tool context around one client. The connection manager answers
 * `getClientForFile` with it and ignores the rest.
 */
export function createFakeToolContext(client: LSPClient): ToolContext {
  const connectionManager: ConnectionManager = {
    getClientForFile: () => Promise.resolve(client),
    getClient: () => Promise.resolve(client),
    startServer: () => Promise.resolve(client),
    stopServer: () => Promise.resolve(),
    shutdownAll: () => Promise.resolve(),
    listActiveServers: () => [],
    detectWorkspaceRoot: () => client.workspaceRoot,
  };

  const config: Config = {
    servers: [],
    requestTimeout: 1000,
    autoStart: false,
    logLevel: 'error',
    idleTimeout: 1000,
    minify: false,
  };

  return {
    connectionManager,
    documentManager: new DocumentManagerImpl(),
    diagnosticsCache: new DiagnosticsCacheImpl(),
    config,
  };
}
