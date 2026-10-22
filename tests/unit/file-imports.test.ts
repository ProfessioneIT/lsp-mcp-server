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
import { handleFileImports, handleRelatedFiles } from '../../src/tools/symbols.js';
import { pathToUri } from '../../src/utils/uri.js';

describe('import analysis', () => {
  let dir: string;
  let diagnosticsCache: DiagnosticsCacheImpl;
  const files: Record<string, string> = {
    'src/utils.ts': 'export const helper = 1;\nexport const other = 2;\nexport const third = 3;\n',
    'src/a.ts': 'export const A = 1;\n',
    'src/app.ts': [
      'import {',
      '  helper,',
      '  other,',
      '  third,',
      '} from "./utils";',
      'import { readFileSync } from "fs";',
      'export { A } from "./a";',
      'export * from "./lib";',
      '',
    ].join('\n'),
    'src/dashboard.ts': 'import { readFileSync } from "fs";\nimport * as path from "path";\n',
    'src/lib/index.ts': 'export const L = 1;\n',
  };
  const p = (name: string): string => path.join(dir, name);

  beforeEach(async () => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-imports-')));
    for (const [name, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(p(name)), { recursive: true });
      fs.writeFileSync(p(name), content);
    }
    const client = {
      serverId: 'test',
      workspaceRoot: dir,
      capabilities: {},
      didOpen: vi.fn(),
      didClose: vi.fn(),
      didChange: vi.fn(),
      waitForServerWork: vi.fn(async () => {}),
      getCachedDiagnostics: () => [],
      supportsPullDiagnostics: () => false,
      hasPushedDiagnostics: () => false,
    };
    diagnosticsCache = new DiagnosticsCacheImpl();
    setToolContext({
      connectionManager: { getClientForFile: async () => client } as never,
      documentManager: new DocumentManagerImpl(),
      diagnosticsCache,
      config: {} as never,
    });
    // Open every file and mark it as seen, as indexing does
    for (const name of Object.keys(files)) {
      await handleFileImports({ file_path: p(name) });
      diagnosticsCache.update(pathToUri(p(name)), []);
    }
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads multi-line imports and re-exports', async () => {
    const result = await handleFileImports({ file_path: p('src/app.ts') });
    expect(result.imports).toEqual([
      { module: './utils', line: 1, symbols: ['helper', 'other', 'third'] },
      { module: 'fs', line: 6, symbols: ['readFileSync'] },
      { module: './a', line: 7, symbols: ['A'] },
      { module: './lib', line: 8 },
    ]);
  });

  it('lists multi-line imports and re-exports as related files', async () => {
    const result = await handleRelatedFiles({ file_path: p('src/app.ts'), relationship: 'imports' });
    expect(result.imports).toEqual(['./utils', './a', './lib']);
  });

  it('finds importers through multi-line imports, re-exports and index files', async () => {
    expect((await handleRelatedFiles({ file_path: p('src/utils.ts'), relationship: 'imported_by' })).imported_by)
      .toEqual([p('src/app.ts')]);
    expect((await handleRelatedFiles({ file_path: p('src/lib/index.ts'), relationship: 'imported_by' })).imported_by)
      .toEqual([p('src/app.ts')]);
  });

  it('does not match imported_by on a substring of the file name', async () => {
    // dashboard.ts imports "path", which contains "a"; it does not import a.ts
    const result = await handleRelatedFiles({ file_path: p('src/a.ts'), relationship: 'imported_by' });
    expect(result.imported_by).toEqual([p('src/app.ts')]);
  });

  it.each(['\uFEFF', '\u00A0'])('reads imports after Unicode whitespace %j', async (prefix) => {
    const filePath = p('src/whitespace.ts');
    fs.writeFileSync(filePath, `${prefix}import { helper } from "./utils";\n`);

    const result = await handleFileImports({ file_path: filePath });
    expect(result.imports).toEqual([
      { module: './utils', line: 1, symbols: ['helper'] },
    ]);
    expect((await handleRelatedFiles({ file_path: filePath, relationship: 'imports' })).imports)
      .toEqual(['./utils']);
  });

  it('reads re-exports after a UTF-8 BOM without shifting line numbers', async () => {
    const filePath = p('src/bom-export.ts');
    fs.writeFileSync(filePath, '\uFEFFexport { A } from "./a";\nexport * from "./lib";\n');

    const result = await handleFileImports({ file_path: filePath });
    expect(result.imports).toEqual([
      { module: './a', line: 1, symbols: ['A'] },
      { module: './lib', line: 2 },
    ]);
  });

  it.each(['.ts', '.tsx', '.js', '.jsx'])('prefers a sibling %s file over a directory index', async (extension) => {
    fs.writeFileSync(p(`src/lib${extension}`), 'export const L = 2;\n');

    const index = await handleRelatedFiles({ file_path: p('src/lib/index.ts'), relationship: 'imported_by' });
    expect(index.imported_by).toEqual([]);
    const sibling = await handleRelatedFiles({ file_path: p(`src/lib${extension}`), relationship: 'imported_by' });
    expect(sibling.imported_by).toEqual([p('src/app.ts')]);
  });

  it.each(['./lib/', './lib/.'])('keeps explicit directory imports pointed at the index: %s', async (specifier) => {
    fs.writeFileSync(p('src/lib.ts'), 'export const L = 2;\n');
    const importer = p('src/directory-import.ts');
    fs.writeFileSync(importer, `export * from "${specifier}";\n`);
    await handleFileImports({ file_path: importer });
    diagnosticsCache.update(pathToUri(importer), []);

    const index = await handleRelatedFiles({ file_path: p('src/lib/index.ts'), relationship: 'imported_by' });
    expect(index.imported_by).toEqual([importer]);
    const sibling = await handleRelatedFiles({ file_path: p('src/lib.ts'), relationship: 'imported_by' });
    expect(sibling.imported_by).toEqual([p('src/app.ts')]);
  });

  it.each([
    ['require("./utils")', { module: './utils', line: 1 }],
    ['import("./utils")', { module: './utils', line: 1, is_dynamic: true }],
  ])('keeps dependencies following a re-export: %s', async (expression, dependency) => {
    const filePath = p('src/re-export-and-load.ts');
    fs.writeFileSync(filePath, `export { A } from "./a"; const loaded = ${expression};\n`);

    const result = await handleFileImports({ file_path: filePath });
    expect(result.imports).toEqual([
      { module: './a', line: 1, symbols: ['A'] },
      dependency,
    ]);
    expect((await handleRelatedFiles({ file_path: filePath, relationship: 'imports' })).imports)
      .toEqual(['./a', './utils']);
  });
});
