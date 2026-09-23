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
import { handleInlayHints } from '../../src/tools/inlay-hints.js';
import { handleCodeActions } from '../../src/tools/code-actions.js';
import { clampToDocument } from '../../src/utils/position.js';
import { pathToUri } from '../../src/utils/uri.js';
import { LSPErrorCode } from '../../src/types.js';

describe('clampToDocument', () => {
  const content = 'fn main() {\n    let x = 1;\n}\n';

  it('keeps positions inside the document unchanged', () => {
    expect(clampToDocument({ line: 1, character: 4 }, content)).toEqual({ line: 1, character: 4 });
  });

  it('moves positions past the last line to the end of the document', () => {
    expect(clampToDocument({ line: 8, character: 0 }, content)).toEqual({ line: 3, character: 0 });
  });

  it('moves positions past the end of a line to the end of that line', () => {
    expect(clampToDocument({ line: 0, character: 99 }, content)).toEqual({ line: 0, character: 11 });
  });
});

describe('range tools', () => {
  let dir: string;
  let file: string;
  let uri: string;
  let client: Record<string, unknown>;

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-range-')));
    file = path.join(dir, 'main.py');
    fs.writeFileSync(file, 'import os\nx = 1\n');
    uri = pathToUri(file);
    client = {
      serverId: 'test',
      workspaceRoot: dir,
      capabilities: {},
      didOpen: vi.fn(),
      didClose: vi.fn(),
      didChange: vi.fn(),
      waitForServerWork: vi.fn(async () => {}),
      getCachedDiagnostics: () => [],
      inlayHints: vi.fn(async () => []),
      codeActions: vi.fn(async () => []),
    };
    setToolContext({
      connectionManager: { getClientForFile: async () => client } as never,
      documentManager: new DocumentManagerImpl(),
      diagnosticsCache: new DiagnosticsCacheImpl(),
      config: {} as never,
    });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('clamps an inlay hint range that ends past the end of the file', async () => {
    await handleInlayHints({ file_path: file, start_line: 1, start_column: 1, end_line: 9, end_column: 1, limit: 100 });
    const range = (client.inlayHints as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    expect(range.end).toEqual({ line: 2, character: 0 });
  });

  it('shows edits a code action sends in documentChanges', async () => {
    client.codeActions = vi.fn(async () => [{
      title: 'Remove unused import',
      kind: 'quickfix',
      edit: { documentChanges: [{ textDocument: { uri, version: 1 }, edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } }, newText: '' }] }] },
    }]);
    const result = await handleCodeActions({ file_path: file, start_line: 1, start_column: 1, apply: false, action_index: 0 });
    expect(result.actions[0]!.edit?.files_affected).toBe(1);
  });

  it('applies edits a code action sends in documentChanges', async () => {
    client.codeActions = vi.fn(async () => [{
      title: 'Remove unused import',
      kind: 'quickfix',
      edit: { documentChanges: [{ textDocument: { uri, version: 1 }, edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } }, newText: '' }] }] },
    }]);
    await handleCodeActions({ file_path: file, start_line: 1, start_column: 1, apply: true, action_index: 0 });
    expect(fs.readFileSync(file, 'utf8')).toBe('x = 1\n');
  });

  it('refuses to apply a code action that needs file operations, without writing anything', async () => {
    client.codeActions = vi.fn(async () => [{
      title: 'Move to new file',
      kind: 'refactor.move',
      edit: { documentChanges: [
        { kind: 'create', uri: pathToUri(path.join(dir, 'new.py')) },
        { textDocument: { uri, version: 1 }, edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } }, newText: '' }] },
      ] },
    }]);
    await expect(handleCodeActions({ file_path: file, start_line: 1, start_column: 1, apply: true, action_index: 0 }))
      .rejects.toMatchObject({ code: LSPErrorCode.CAPABILITY_NOT_SUPPORTED });
    expect(fs.readFileSync(file, 'utf8')).toBe('import os\nx = 1\n');
  });
});
