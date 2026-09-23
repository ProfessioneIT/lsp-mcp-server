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
import { findWorkspaceRootForLanguage } from '../../src/utils/workspace.js';

const CPP_PATTERNS = ['compile_commands.json', 'compile_flags.txt', '.clangd', 'CMakeLists.txt', 'Makefile'];

describe('findWorkspaceRootForLanguage', () => {
  let root: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-root-')));
    fs.mkdirSync(path.join(root, 'src', 'rxlib'), { recursive: true });
    fs.writeFileSync(path.join(root, 'CMakeLists.txt'), '');
    fs.writeFileSync(path.join(root, 'src', 'CMakeLists.txt'), '');
    fs.writeFileSync(path.join(root, 'src', 'rxlib', 'CMakeLists.txt'), '');
    fs.writeFileSync(path.join(root, 'src', 'rxlib', 'LoopRunner.cc'), '');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('prefers a higher-priority marker further up over a lower-priority one nearby', async () => {
    fs.writeFileSync(path.join(root, 'compile_commands.json'), '[]');
    const file = path.join(root, 'src', 'rxlib', 'LoopRunner.cc');
    expect(await findWorkspaceRootForLanguage(file, CPP_PATTERNS)).toBe(root);
  });

  it('uses the nearest directory for the highest-priority marker that exists', async () => {
    const file = path.join(root, 'src', 'rxlib', 'LoopRunner.cc');
    expect(await findWorkspaceRootForLanguage(file, CPP_PATTERNS)).toBe(path.join(root, 'src', 'rxlib'));
  });

  it('keeps nested projects separate when each has the top-priority marker', async () => {
    fs.writeFileSync(path.join(root, 'compile_commands.json'), '[]');
    fs.writeFileSync(path.join(root, 'src', 'rxlib', 'compile_commands.json'), '[]');
    const file = path.join(root, 'src', 'rxlib', 'LoopRunner.cc');
    expect(await findWorkspaceRootForLanguage(file, CPP_PATTERNS)).toBe(path.join(root, 'src', 'rxlib'));
  });
});
