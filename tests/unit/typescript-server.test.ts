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
import { DEFAULT_SERVERS } from '../../src/constants.js';
import { findWorkspaceTypeScript, resolveServerConfig } from '../../src/services/typescript-server.js';

function installTypeScript(dir: string, version: string): void {
  const pkg = path.join(dir, 'node_modules', 'typescript');
  fs.mkdirSync(path.join(pkg, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'typescript', version }));
  fs.writeFileSync(path.join(pkg, 'bin', 'tsc'), '#!/usr/bin/env node\n');
}

describe('TypeScript server selection', () => {
  const builtIn = DEFAULT_SERVERS.find((s) => s.id === 'typescript')!;
  let root: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-ts-')));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('finds the workspace TypeScript, including one hoisted to a parent directory', () => {
    installTypeScript(root, '7.0.2');
    const pkg = path.join(root, 'packages', 'app');
    fs.mkdirSync(pkg, { recursive: true });
    expect(findWorkspaceTypeScript(pkg)).toEqual({ version: '7.0.2', packageDir: path.join(root, 'node_modules', 'typescript') });
  });

  it('uses the native TypeScript 7 language server when the workspace has TypeScript 7', () => {
    installTypeScript(root, '7.0.2');
    const resolved = resolveServerConfig(builtIn, root);
    expect(resolved.command).toBe(process.execPath);
    expect(resolved.args).toEqual([path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '--lsp', '--stdio']);
    expect(resolved.id).toBe('typescript');
  });

  it('keeps typescript-language-server for TypeScript 6 and older', () => {
    installTypeScript(root, '5.9.3');
    expect(resolveServerConfig(builtIn, root)).toBe(builtIn);
  });

  it('keeps typescript-language-server when the workspace has no TypeScript', () => {
    expect(resolveServerConfig(builtIn, root)).toBe(builtIn);
  });

  it('never changes a typescript server the user configured', () => {
    installTypeScript(root, '7.0.2');
    const userConfig = { ...builtIn, command: '/opt/custom/typescript-language-server' };
    expect(resolveServerConfig(userConfig, root)).toBe(userConfig);
  });

  it('leaves other languages alone', () => {
    installTypeScript(root, '7.0.2');
    const python = DEFAULT_SERVERS.find((s) => s.id === 'python')!;
    expect(resolveServerConfig(python, root)).toBe(python);
  });
});
