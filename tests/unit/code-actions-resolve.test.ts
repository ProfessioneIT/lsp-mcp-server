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
import type { CodeAction } from 'vscode-languageserver-protocol';
import { setToolContext } from '../../src/tools/context.js';
import { handleCodeActions } from '../../src/tools/code-actions.js';
import { pathToUri } from '../../src/utils/uri.js';
import { LSPErrorCode } from '../../src/types.js';
import { createFakeLspClient, createFakeToolContext } from './helpers/fake-lsp-client.js';

describe('handleCodeActions resolve step', () => {
  let dir: string;
  let file: string;
  let uri: string;

  const lazyAction: CodeAction = {
    title: 'Extract into function',
    kind: 'refactor.extract',
    data: { id: 'x' },
  };

  const edit = () => ({
    changes: {
      [uri]: [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          newText: '// extracted\n',
        },
      ],
    },
  });

  function setup(actions: CodeAction[], resolved: () => CodeAction) {
    const client = createFakeLspClient(dir, {
      capabilities: { codeActionProvider: true },
      codeActions: vi.fn(async () => actions),
      resolveCodeAction: vi.fn(async () => resolved()),
    });
    setToolContext(createFakeToolContext(client));
    return client;
  }

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-codeaction-')));
    file = path.join(dir, 'main.rs');
    fs.writeFileSync(file, 'let a = 1;\nlet b = 2;\n');
    uri = pathToUri(file);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const input = () => ({
    file_path: file,
    start_line: 1,
    start_column: 1,
    end_line: 2,
    end_column: 1,
    apply: true,
    action_index: 0,
  });

  it('resolves a lazy action and applies the edit it returns', async () => {
    const client = setup([lazyAction], () => ({ ...lazyAction, edit: edit() }));

    const result = await handleCodeActions(input());

    expect(client.resolveCodeAction).toHaveBeenCalledOnce();
    expect(fs.readFileSync(file, 'utf-8')).toBe('// extracted\nlet a = 1;\nlet b = 2;\n');
    expect(result.applied?.title).toBe('Extract into function');
  });

  it('reports the resolved edit on the returned action, not the lazy stub', async () => {
    setup([lazyAction], () => ({ ...lazyAction, edit: edit() }));

    const result = await handleCodeActions(input());

    expect(result.actions[0]?.edit).toBeDefined();
  });

  it('still refuses an action the server resolves without an edit', async () => {
    setup([lazyAction], () => lazyAction);

    await expect(handleCodeActions(input())).rejects.toMatchObject({
      code: LSPErrorCode.CAPABILITY_NOT_SUPPORTED,
    });
    expect(fs.readFileSync(file, 'utf-8')).toBe('let a = 1;\nlet b = 2;\n');
  });

  it('does not resolve an action that already carries its edit', async () => {
    const eager: CodeAction = { ...lazyAction, edit: edit() };
    const client = setup([eager], () => eager);

    await handleCodeActions(input());

    expect(client.resolveCodeAction).not.toHaveBeenCalled();
  });
});
