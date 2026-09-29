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

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DocumentManagerImpl } from '../../src/services/document-manager.js';
import { DiagnosticsCacheImpl } from '../../src/services/diagnostics-cache.js';
import { setToolContext } from '../../src/tools/context.js';
import { handleDiagnostics, handleWorkspaceDiagnostics } from '../../src/tools/diagnostics.js';
import { handleCodeActions } from '../../src/tools/code-actions.js';
import { pathToUri } from '../../src/utils/uri.js';

const diag = (message: string) => ({
  range: { start: { line: 2, character: 6 }, end: { line: 2, character: 11 } },
  message,
  severity: 1,
});

describe('tools with a pull-diagnostics server', () => {
  let dir: string;
  let main: string;
  let other: string;
  let client: Record<string, unknown> & { pullDiagnostics: ReturnType<typeof vi.fn> };
  let diagnosticsCache: DiagnosticsCacheImpl;
  let documentManager: DocumentManagerImpl;

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-pull-')));
    main = path.join(dir, 'main.ts');
    other = path.join(dir, 'other.ts');
    fs.writeFileSync(main, "import { add } from './math.js';\n\nconst total: string = add(1, 2);\n");
    fs.writeFileSync(other, 'export const x: number = "x";\n');
    diagnosticsCache = new DiagnosticsCacheImpl();
    documentManager = new DocumentManagerImpl();
    client = {
      serverId: 'typescript',
      workspaceRoot: dir,
      capabilities: { diagnosticProvider: { interFileDependencies: true, workspaceDiagnostics: false } },
      didOpen: vi.fn(),
      didClose: vi.fn(),
      didChange: vi.fn(),
      didSave: vi.fn(),
      waitForServerWork: vi.fn(async () => {}),
      waitForDiagnostics: vi.fn(async () => true),
      getCachedDiagnostics: vi.fn(() => []),
      supportsPullDiagnostics: () => true,
      hasPushedDiagnostics: vi.fn(() => false),
      pullDiagnostics: vi.fn(async (uri: string) => {
        const items = [diag(`error in ${path.basename(uri)}`)];
        diagnosticsCache.update(uri, items as never);
        return items;
      }),
      codeActions: vi.fn(async () => []),
    };
    setToolContext({
      connectionManager: {
        getClientForFile: async () => client,
        listActiveServers: () => [{ id: 'typescript', workspaceRoot: dir, status: 'running', client }],
      } as never,
      documentManager,
      diagnosticsCache,
      config: {} as never,
    });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('lsp_diagnostics returns the pulled diagnostics', async () => {
    const result = await handleDiagnostics({ file_path: main, severity_filter: 'all' });
    expect(result.diagnostics.map((d) => d.message)).toEqual(['error in main.ts']);
    expect(client.waitForDiagnostics).not.toHaveBeenCalled();
  });

  it('lsp_workspace_diagnostics pulls every open document first', async () => {
    await documentManager.ensureOpen(pathToUri(main), client as never);
    await documentManager.ensureOpen(pathToUri(other), client as never);
    const result = await handleWorkspaceDiagnostics({ severity_filter: 'all', limit: 50, group_by: 'file' });
    expect(client.pullDiagnostics).toHaveBeenCalledTimes(2);
    expect(result.total_count).toBe(2);
  });

  it('lsp_code_actions sends the pulled diagnostics as context', async () => {
    await handleCodeActions({ file_path: main, start_line: 3, start_column: 7, end_line: 3, end_column: 12, apply: false, action_index: 0 });
    const context = (client.codeActions as ReturnType<typeof vi.fn>).mock.calls[0]![2];
    expect(context.map((d: { message: string }) => d.message)).toEqual(['error in main.ts']);
  });

  it('waits for a fresh publish after a change when the server also pushed diagnostics for the file', async () => {
    // Like rust-analyzer: cargo check results are pushed and become stale after an edit
    (client.hasPushedDiagnostics as ReturnType<typeof vi.fn>).mockReturnValue(true);
    await handleDiagnostics({ file_path: main, severity_filter: 'all' });
    expect(client.waitForDiagnostics).toHaveBeenCalledTimes(1);
    expect(client.pullDiagnostics).toHaveBeenCalledTimes(1);
  });
});
