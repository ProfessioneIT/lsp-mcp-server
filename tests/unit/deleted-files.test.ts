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
import { forgetDeletedFiles } from '../../src/tools/utils.js';
import { pathToUri } from '../../src/utils/uri.js';
import type { LSPClient } from '../../src/types.js';

const DIAG = { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: 'boom', severity: 1 };

describe('forgetDeletedFiles', () => {
  let dir: string;
  let client: LSPClient & { didClose: ReturnType<typeof vi.fn>; didDeleteFiles: ReturnType<typeof vi.fn> };
  let documentManager: DocumentManagerImpl;
  let diagnosticsCache: DiagnosticsCacheImpl;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-deleted-'));
    client = { serverId: 'typescript', didOpen: vi.fn(), didClose: vi.fn(), didChange: vi.fn(), didDeleteFiles: vi.fn() } as never;
    documentManager = new DocumentManagerImpl();
    diagnosticsCache = new DiagnosticsCacheImpl();
    setToolContext({
      connectionManager: { listActiveServers: () => [{ id: 'typescript', workspaceRoot: dir, status: 'running', client }] } as never,
      documentManager,
      diagnosticsCache,
      config: {} as never,
    });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('drops diagnostics, closes the document, and notifies servers for deleted files', async () => {
    const probe = path.join(dir, 'probe.ts');
    fs.writeFileSync(probe, 'const a: number = "x";\n');
    const uri = pathToUri(probe);
    await documentManager.ensureOpen(uri, client);
    diagnosticsCache.update(uri, [DIAG] as never);

    fs.unlinkSync(probe);
    const forgotten = await forgetDeletedFiles();

    expect(forgotten).toEqual([uri]);
    expect(diagnosticsCache.get(uri)).toEqual([]);
    expect(diagnosticsCache.getUris()).not.toContain(uri);
    expect(client.didClose).toHaveBeenCalledWith(uri);
    expect(client.didDeleteFiles).toHaveBeenCalledWith([uri]);
    expect(documentManager.isOpen(uri, client)).toBe(false);
  });

  it('leaves files that still exist untouched', async () => {
    const kept = path.join(dir, 'kept.ts');
    fs.writeFileSync(kept, 'export const x = 1;\n');
    const uri = pathToUri(kept);
    await documentManager.ensureOpen(uri, client);
    diagnosticsCache.update(uri, [DIAG] as never);

    expect(await forgetDeletedFiles()).toEqual([]);
    expect(diagnosticsCache.get(uri)).toHaveLength(1);
    expect(client.didClose).not.toHaveBeenCalled();
  });
});
