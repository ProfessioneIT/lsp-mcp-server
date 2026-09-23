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
import { pathToUri } from '../../src/utils/uri.js';
import type { LSPClient } from '../../src/types.js';

function fakeClient(serverId = 'cpp'): LSPClient & {
  didOpen: ReturnType<typeof vi.fn>;
  didClose: ReturnType<typeof vi.fn>;
} {
  return { serverId, didOpen: vi.fn(), didClose: vi.fn(), didChange: vi.fn() } as never;
}

describe('DocumentManagerImpl open tracking', () => {
  let dir: string;
  let uri: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-docmgr-'));
    const file = path.join(dir, 'LoopRunner.cc');
    fs.writeFileSync(file, 'int main() { return 0; }\n');
    uri = pathToUri(file);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('opens a document only once per client instance', async () => {
    const dm = new DocumentManagerImpl();
    const client = fakeClient();
    await dm.ensureOpen(uri, client);
    await dm.ensureOpen(uri, client);
    expect(client.didOpen).toHaveBeenCalledTimes(1);
  });

  it('opens the document in every instance of the same server (multi-root)', async () => {
    const dm = new DocumentManagerImpl();
    const rootInstance = fakeClient('cpp');
    const subdirInstance = fakeClient('cpp');
    await dm.ensureOpen(uri, rootInstance);
    await dm.ensureOpen(uri, subdirInstance);
    expect(subdirInstance.didOpen).toHaveBeenCalledTimes(1);
    expect(dm.isOpen(uri, subdirInstance)).toBe(true);
  });

  it('reopens the document in a replacement instance after a restart', async () => {
    const dm = new DocumentManagerImpl();
    const original = fakeClient('cpp');
    await dm.ensureOpen(uri, original);
    const restarted = fakeClient('cpp');
    await dm.ensureOpen(uri, restarted);
    expect(restarted.didOpen).toHaveBeenCalledTimes(1);
  });

  it('closes the document only in the given instance', async () => {
    const dm = new DocumentManagerImpl();
    const a = fakeClient('cpp');
    const b = fakeClient('cpp');
    await dm.ensureOpen(uri, a);
    await dm.ensureOpen(uri, b);
    await dm.closeDocument(uri, a);
    expect(a.didClose).toHaveBeenCalledWith(uri);
    expect(b.didClose).not.toHaveBeenCalled();
    expect(dm.isOpen(uri, a)).toBe(false);
    expect(dm.isOpen(uri, b)).toBe(true);
  });

  it('lists the documents open in an instance', async () => {
    const dm = new DocumentManagerImpl();
    const a = fakeClient('cpp');
    const b = fakeClient('cpp');
    await dm.ensureOpen(uri, a);
    expect(dm.getOpenUris(a)).toEqual([uri]);
    expect(dm.getOpenUris(b)).toEqual([]);
  });
});
