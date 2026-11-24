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
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setToolContext, type ToolContext } from '../../src/tools/context.js';
import { handleFileImports, handleRelatedFiles } from '../../src/tools/symbols.js';
import { prepareFile } from '../../src/tools/utils.js';
import { canonicalFilePath, pathToUri } from '../../src/utils/uri.js';
import { LSPErrorCode, type LSPClient, type ServerInstance } from '../../src/types.js';
import { createFakeLspClient, createFakeToolContext } from './helpers/fake-lsp-client.js';

const DIAG = { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: 'boom', severity: 1 as const };

/**
 * Documents are opened under their real path. Paths compared against them
 * must be canonicalised the same way, or a symlinked spelling (e.g. /tmp on
 * macOS) silently stops matching.
 */
describe('canonical file paths', () => {
  let real: string;
  let link: string;
  let client: LSPClient;
  let ctx: ToolContext;

  beforeEach(() => {
    real = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-canonical-')));
    link = `${real}-link`;
    fs.symlinkSync(real, link);
    fs.writeFileSync(path.join(real, 'a.ts'), "import { b } from './b';\n");
    fs.writeFileSync(path.join(real, 'b.ts'), 'export const b = 1;\n');

    client = createFakeLspClient(real);
    ctx = createFakeToolContext(client);
    const instance: ServerInstance = {
      id: 'test',
      workspaceRoot: real,
      status: 'running',
      client,
      pid: null,
      startTime: null,
      restartCount: 0,
      lastError: null,
    };
    ctx.connectionManager.listActiveServers = () => [instance];
    setToolContext(ctx);
  });

  afterEach(() => {
    fs.rmSync(link, { force: true });
    fs.rmSync(real, { recursive: true, force: true });
  });

  describe('canonicalFilePath', () => {
    it('resolves symlinks for an existing file', () => {
      expect(canonicalFilePath(path.join(link, 'a.ts'))).toBe(path.join(real, 'a.ts'));
    });

    it('resolves the directory of a missing file', () => {
      expect(canonicalFilePath(path.join(link, 'gone.ts'))).toBe(path.join(real, 'gone.ts'));
    });

    it('keeps a path whose directory does not exist either', () => {
      const missing = path.join(link, 'no-such-dir', 'gone.ts');
      expect(canonicalFilePath(missing)).toBe(missing);
    });
  });

  it('opens documents under their real path', async () => {
    const { uri } = await prepareFile(path.join(link, 'a.ts'));

    expect(uri).toBe(pathToUri(path.join(real, 'a.ts')));
  });

  it('finds importers of a file reached through a symlink', async () => {
    await handleFileImports({ file_path: path.join(link, 'a.ts') });
    // Stand in for the server publishing diagnostics for the opened document
    for (const uri of ctx.documentManager.getOpenUris(client)) {
      ctx.diagnosticsCache.update(uri, []);
    }

    const result = await handleRelatedFiles({ file_path: path.join(link, 'b.ts'), relationship: 'imported_by' });

    expect(result.imported_by).toEqual([path.join(real, 'a.ts')]);
  });

  it('does not list a file reached through a symlink as its own importer', async () => {
    fs.writeFileSync(path.join(real, 'self.ts'), "export * from './self';\n");
    await handleFileImports({ file_path: path.join(link, 'self.ts') });
    for (const uri of ctx.documentManager.getOpenUris(client)) {
      ctx.diagnosticsCache.update(uri, []);
    }

    const result = await handleRelatedFiles({ file_path: path.join(link, 'self.ts'), relationship: 'imported_by' });

    expect(result.imported_by).toEqual([]);
  });

  it('forgets a deleted file reached through a symlink', async () => {
    const linked = path.join(link, 'a.ts');
    const { uri } = await prepareFile(linked);
    ctx.diagnosticsCache.update(uri, [DIAG]);

    fs.unlinkSync(path.join(real, 'a.ts'));

    await expect(prepareFile(linked)).rejects.toMatchObject({ code: LSPErrorCode.FILE_NOT_FOUND });
    expect(ctx.documentManager.isOpen(uri, client)).toBe(false);
    expect(ctx.diagnosticsCache.getUris()).not.toContain(uri);
  });
});
