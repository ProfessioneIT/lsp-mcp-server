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
import type { ServerCapabilities } from 'vscode-languageserver-protocol';
import { DocumentManagerImpl } from '../../src/services/document-manager.js';
import { DiagnosticsCacheImpl } from '../../src/services/diagnostics-cache.js';
import { setToolContext } from '../../src/tools/context.js';
import { handleRename } from '../../src/tools/rename.js';
import { pathToUri } from '../../src/utils/uri.js';
import { LSPErrorCode } from '../../src/types.js';

describe('handleRename prepare step', () => {
  let dir: string;
  let file: string;
  let uri: string;

  const edit = () => ({
    changes: { [uri]: [{ range: { start: { line: 0, character: 4 }, end: { line: 0, character: 7 } }, newText: 'sum' }] },
  });

  function setup(
    renameProvider: ServerCapabilities['renameProvider'],
    prepareRename: () => Promise<unknown>,
    renameResult: () => unknown = edit,
  ) {
    const client = {
      serverId: 'test',
      capabilities: { renameProvider } satisfies ServerCapabilities,
      didOpen: vi.fn(),
      didClose: vi.fn(),
      didChange: vi.fn(),
      prepareRename: vi.fn(prepareRename),
      rename: vi.fn(async () => renameResult()),
      workspaceRoot: dir,
    };
    setToolContext({
      connectionManager: { getClientForFile: async () => client } as never,
      documentManager: new DocumentManagerImpl(),
      diagnosticsCache: new DiagnosticsCacheImpl(),
      config: {} as never,
    });
    return client;
  }

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-rename-')));
    file = path.join(dir, 'calc.py');
    fs.writeFileSync(file, 'def add(a, b):\n    return a + b\n');
    uri = pathToUri(file);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const input = () => ({ file_path: file, line: 1, column: 5, new_name: 'sum', dry_run: true });

  it('renames directly when the server does not support prepareRename (renameProvider: true)', async () => {
    const client = setup(true, async () => null);
    const result = await handleRename(input());
    expect(client.rename).toHaveBeenCalledOnce();
    expect(result.edits_count).toBe(1);
  });

  it('reports RENAME_NOT_ALLOWED when a prepare-capable server rejects the position with null', async () => {
    const client = setup({ prepareProvider: true }, async () => null);
    await expect(handleRename(input())).rejects.toMatchObject({ code: LSPErrorCode.RENAME_NOT_ALLOWED });
    expect(client.rename).not.toHaveBeenCalled();
  });

  it('surfaces the server error when prepareRename fails', async () => {
    const serverError = Object.assign(new Error('You cannot rename this element.'), { code: -32603 });
    const client = setup({ prepareProvider: true }, async () => { throw serverError; });
    await expect(handleRename(input())).rejects.toThrow('You cannot rename this element.');
    expect(client.rename).not.toHaveBeenCalled();
  });

  it('falls back to a plain rename when prepareRename is not implemented (MethodNotFound)', async () => {
    const notFound = Object.assign(new Error('Unhandled method textDocument/prepareRename'), { code: -32601 });
    const client = setup({ prepareProvider: true }, async () => { throw notFound; });
    const result = await handleRename(input());
    expect(client.rename).toHaveBeenCalledOnce();
    expect(result.edits_count).toBe(1);
  });

  it('keeps the placeholder from prepareRename as original_name', async () => {
    setup({ prepareProvider: true }, async () => ({ range: { start: { line: 0, character: 4 }, end: { line: 0, character: 7 } }, placeholder: 'add' }));
    const result = await handleRename(input());
    expect(result.original_name).toBe('add');
  });

  it('reads edits from documentChanges (e.g. pylsp)', async () => {
    setup(true, async () => null, () => ({
      documentChanges: [{ textDocument: { uri, version: 1 }, edits: edit().changes[uri] }],
    }));
    const result = await handleRename(input());
    expect(result.files_affected).toBe(1);
    expect(result.edits_count).toBe(1);
  });

  it('applies edits from documentChanges to disk', async () => {
    setup(true, async () => null, () => ({
      documentChanges: [{ textDocument: { uri, version: 1 }, edits: edit().changes[uri] }],
    }));
    const result = await handleRename({ ...input(), dry_run: false });
    expect(result.applied).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toContain('def sum(a, b):');
  });

  it('refuses to apply a rename that needs file operations, without writing anything', async () => {
    setup(true, async () => null, () => ({
      documentChanges: [
        { textDocument: { uri, version: 1 }, edits: edit().changes[uri] },
        { kind: 'rename', oldUri: uri, newUri: pathToUri(path.join(dir, 'sum.py')) },
      ],
    }));
    await expect(handleRename({ ...input(), dry_run: false })).rejects.toMatchObject({ code: LSPErrorCode.CAPABILITY_NOT_SUPPORTED });
    expect(fs.readFileSync(file, 'utf8')).toContain('def add(a, b):');
  });

  it('notes skipped file operations in a dry run', async () => {
    setup(true, async () => null, () => ({
      documentChanges: [
        { textDocument: { uri, version: 1 }, edits: edit().changes[uri] },
        { kind: 'rename', oldUri: uri, newUri: pathToUri(path.join(dir, 'sum.py')) },
      ],
    }));
    const result = await handleRename(input());
    expect(result.edits_count).toBe(1);
    expect(result.note).toMatch(/file operation/i);
  });
});
