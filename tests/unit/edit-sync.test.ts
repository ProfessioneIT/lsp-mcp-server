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
import { prepareFile } from '../../src/tools/utils.js';
import { handleDiagnostics } from '../../src/tools/diagnostics.js';
import { pathToUri } from '../../src/utils/uri.js';

function fakeClient() {
  return {
    serverId: 'test',
    capabilities: {},
    didOpen: vi.fn(),
    didClose: vi.fn(),
    didChange: vi.fn(),
    didSave: vi.fn(),
    waitForServerWork: vi.fn(async () => {}),
    waitForDiagnostics: vi.fn(async () => true),
    getCachedDiagnostics: vi.fn(() => []),
  };
}

describe('syncing edits made on disk', () => {
  let dir: string;
  let file: string;
  let uri: string;
  let client: ReturnType<typeof fakeClient>;
  let documentManager: DocumentManagerImpl;

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-sync-')));
    file = path.join(dir, 'a.ts');
    fs.writeFileSync(file, "const a: number = 'x';\n");
    uri = pathToUri(file);
    client = fakeClient();
    documentManager = new DocumentManagerImpl();
    setToolContext({
      connectionManager: { getClientForFile: async () => client } as never,
      documentManager,
      diagnosticsCache: new DiagnosticsCacheImpl(),
      config: {} as never,
    });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('sends the new content to the server when an open file changed on disk', async () => {
    await documentManager.ensureOpen(uri, client as never);
    fs.writeFileSync(file, '// fixed\nconst a: number = 1;\n');
    expect(await documentManager.syncWithDisk(uri, client as never)).toBe(true);
    expect(client.didChange).toHaveBeenCalledWith(uri, 2, [{ text: '// fixed\nconst a: number = 1;\n' }]);
    expect(client.didSave).toHaveBeenCalledWith(uri);
  });

  it('does nothing when the file is unchanged', async () => {
    await documentManager.ensureOpen(uri, client as never);
    expect(await documentManager.syncWithDisk(uri, client as never)).toBe(false);
    expect(client.didChange).not.toHaveBeenCalled();
    expect(client.didSave).not.toHaveBeenCalled();
  });

  it('prepareFile returns the current content and reports the sync', async () => {
    const first = await prepareFile(file);
    expect(first.touchedAt).not.toBeNull();
    const second = await prepareFile(file);
    expect(second.touchedAt).toBeNull();

    fs.writeFileSync(file, 'const a = 2;\n');
    const third = await prepareFile(file);
    expect(third.content).toBe('const a = 2;\n');
    expect(third.touchedAt).not.toBeNull();
  });

  it('lsp_diagnostics waits for fresh diagnostics only after an open or a change', async () => {
    await handleDiagnostics({ file_path: file, severity_filter: 'all' });
    expect(client.waitForDiagnostics).toHaveBeenCalledTimes(1);

    await handleDiagnostics({ file_path: file, severity_filter: 'all' });
    expect(client.waitForDiagnostics).toHaveBeenCalledTimes(1);

    fs.writeFileSync(file, 'const a = 2;\n');
    await handleDiagnostics({ file_path: file, severity_filter: 'all' });
    expect(client.waitForDiagnostics).toHaveBeenCalledTimes(2);
  });
});
