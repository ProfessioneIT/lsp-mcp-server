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

import { describe, it, expect, vi } from 'vitest';
import type { ServerCapabilities } from 'vscode-languageserver-protocol';
import { LSPClientImpl } from '../../src/services/lsp-client.js';

/**
 * Build an LSPClientImpl with injected capabilities and a stubbed sendRequest so
 * prepareRename can be exercised without a live language server.
 */
function clientWithCapabilities(
  renameProvider: ServerCapabilities['renameProvider']
): { client: LSPClientImpl; sendRequest: ReturnType<typeof vi.fn> } {
  const client = new LSPClientImpl({
    id: 'test',
    command: 'noop',
    args: [],
    languageId: 'python',
  });
  // _capabilities is private; inject via defineProperty for a focused unit test.
  Object.defineProperty(client, '_capabilities', {
    value: { renameProvider } satisfies ServerCapabilities,
    writable: true,
    configurable: true,
  });
  const sendRequest = vi.fn().mockResolvedValue({ start: 0, end: 5 });
  Object.defineProperty(client, 'sendRequest', {
    value: sendRequest,
    writable: true,
    configurable: true,
  });
  return { client, sendRequest };
}

describe('LSPClientImpl.prepareRename', () => {
  it('returns null WITHOUT sending prepareRename when renameProvider === true', async () => {
    // LSP spec: renameProvider === true means rename is supported without
    // prepareRename. Sending it anyway makes servers like pylsp/rope answer
    // MethodNotFound (-32601) and abort the rename.
    const { client, sendRequest } = clientWithCapabilities(true);

    const result = await client.prepareRename('file:///x.py', {
      line: 0,
      character: 4,
    });

    expect(result).toBeNull();
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it('returns null WITHOUT sending prepareRename when renameProvider is undefined', async () => {
    const { client, sendRequest } = clientWithCapabilities(undefined);

    const result = await client.prepareRename('file:///x.py', {
      line: 0,
      character: 4,
    });

    expect(result).toBeNull();
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it('sends prepareRename when the provider object advertises prepareProvider', async () => {
    const { client, sendRequest } = clientWithCapabilities({
      prepareProvider: true,
    });

    const result = await client.prepareRename('file:///x.py', {
      line: 0,
      character: 4,
    });

    expect(sendRequest).toHaveBeenCalledOnce();
    expect(result).toEqual({ start: 0, end: 5 });
  });

  it('returns null WITHOUT sending prepareRename when provider object lacks prepareProvider', async () => {
    const { client, sendRequest } = clientWithCapabilities({
      prepareProvider: false,
    });

    const result = await client.prepareRename('file:///x.py', {
      line: 0,
      character: 4,
    });

    expect(result).toBeNull();
    expect(sendRequest).not.toHaveBeenCalled();
  });
});
