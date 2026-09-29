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

import { fileURLToPath } from 'node:url';
import * as os from 'node:os';
import { describe, it, expect, afterEach } from 'vitest';
import { createLSPClient } from '../../src/services/lsp-client.js';
import { createConnectionManager } from '../../src/services/connection-manager.js';
import { DEFAULT_CONFIG } from '../../src/constants.js';
import { LSPErrorCode } from '../../src/types.js';
import type { LSPClient } from '../../src/types.js';

const fixturePath = fileURLToPath(new URL('../fixtures/behavior-server.mjs', import.meta.url));

function fixtureClient(mode: string, timeout: number, env: Record<string, string> = {}): LSPClient {
  return createLSPClient(
    {
      id: 'behavior-fixture',
      extensions: ['.fixture'],
      languageIds: ['fixture'],
      command: process.execPath,
      args: [fixturePath],
      env: { FIXTURE_MODE: mode, ...env },
    },
    timeout,
  );
}

describe('LSPClientImpl lifecycle', () => {
  let client: LSPClient | undefined;

  afterEach(async () => {
    await client?.shutdown().catch(() => {});
    client = undefined;
  });

  it('fails initialize with a timeout when the server never answers', async () => {
    client = fixtureClient('silent', 500);
    const started = Date.now();
    await expect(client.initialize(os.tmpdir())).rejects.toMatchObject({ code: LSPErrorCode.SERVER_TIMEOUT });
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('fails initialize immediately when the server process exits', async () => {
    client = fixtureClient('crash', 20000);
    const started = Date.now();
    await expect(client.initialize(os.tmpdir())).rejects.toMatchObject({ code: LSPErrorCode.SERVER_START_FAILED });
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('waits for work the server reports after a document is opened', async () => {
    client = fixtureClient('loading', 5000, { FIXTURE_LOAD_MS: '800' });
    await client.initialize(os.tmpdir());
    const uri = 'file:///tmp/project/a.fixture';
    const openedAt = Date.now();
    client.didOpen({ uri, languageId: 'fixture', version: 1, text: 'x' });
    await client.waitForServerWork(openedAt, 300, 5000);
    expect(Date.now() - openedAt).toBeGreaterThanOrEqual(700);
    const refs = await client.references(uri, { line: 0, character: 0 }, true);
    expect(refs).toHaveLength(2);
  });

  it('only waits for the settle window when the server reports no work', async () => {
    client = fixtureClient('loading', 5000, { FIXTURE_NO_LOAD: 'true' });
    await client.initialize(os.tmpdir());
    const openedAt = Date.now();
    client.didOpen({ uri: 'file:///tmp/project/a.fixture', languageId: 'fixture', version: 1, text: 'x' });
    await client.waitForServerWork(openedAt, 300, 5000);
    const waited = Date.now() - openedAt;
    expect(waited).toBeGreaterThanOrEqual(290);
    expect(waited).toBeLessThan(1000);
  });

  it('does not retry a server that timed out during startup', async () => {
    const manager = createConnectionManager({
      ...DEFAULT_CONFIG,
      requestTimeout: 500,
      servers: [{
        id: 'behavior-fixture',
        extensions: ['.fixture'],
        languageIds: ['fixture'],
        command: process.execPath,
        args: [fixturePath],
        env: { FIXTURE_MODE: 'silent' },
      }],
    });
    const started = Date.now();
    await expect(manager.getClient('behavior-fixture', os.tmpdir())).rejects.toMatchObject({ code: LSPErrorCode.SERVER_TIMEOUT });
    expect(Date.now() - started).toBeLessThan(2000);
    await manager.shutdownAll();
  });

  it('waits for diagnostics published after a change', async () => {
    client = fixtureClient('loading', 5000, { FIXTURE_NO_LOAD: 'true', FIXTURE_DIAG_DELAY_MS: '400' });
    await client.initialize(os.tmpdir());
    const uri = 'file:///tmp/project/a.fixture';
    const openedAt = Date.now();
    client.didOpen({ uri, languageId: 'fixture', version: 1, text: 'first' });
    expect(await client.waitForDiagnostics(uri, openedAt, 3000)).toBe(true);
    expect(client.getCachedDiagnostics(uri)[0]!.message).toBe('first');

    const changedAt = Date.now();
    client.didChange(uri, 2, [{ text: 'second' }]);
    expect(await client.waitForDiagnostics(uri, changedAt, 3000)).toBe(true);
    expect(client.getCachedDiagnostics(uri)[0]!.message).toBe('second');
  });

  it('gives up waiting for diagnostics after the limit', async () => {
    client = fixtureClient('loading', 5000, { FIXTURE_NO_LOAD: 'true' });
    await client.initialize(os.tmpdir());
    const uri = 'file:///tmp/project/a.fixture';
    const since = Date.now();
    client.didOpen({ uri, languageId: 'fixture', version: 1, text: 'x' });
    expect(await client.waitForDiagnostics(uri, since, 300)).toBe(false);
    expect(Date.now() - since).toBeLessThan(1000);
  });

  it('pulls diagnostics from servers that declare diagnosticProvider', async () => {
    client = fixtureClient('loading', 5000, { FIXTURE_NO_LOAD: 'true', FIXTURE_PULL: 'true' });
    await client.initialize(os.tmpdir());
    expect(client.supportsPullDiagnostics()).toBe(true);
    const published: string[] = [];
    client.onDiagnostics((_uri, diagnostics) => published.push(diagnostics.map((d) => d.message).join(',')));

    const uri = 'file:///tmp/project/a.fixture';
    client.didOpen({ uri, languageId: 'fixture', version: 1, text: 'first' });
    const first = await client.pullDiagnostics(uri);
    // The server only pushed an empty list
    expect(client.hasPushedDiagnostics(uri)).toBe(false);
    expect(first?.map((d) => d.message)).toEqual(['first']);
    expect(client.getCachedDiagnostics(uri).map((d) => d.message)).toEqual(['first']);
    expect(published).toContain('first');

    // Unchanged document: the server answers 'unchanged', the client keeps the items
    await new Promise((resolve) => setTimeout(resolve, 100));
    const again = await client.pullDiagnostics(uri);
    expect(again?.map((d) => d.message)).toEqual(['first']);
    expect(client.getCachedDiagnostics(uri).map((d) => d.message)).toEqual(['first']);

    client.didChange(uri, 2, [{ text: 'second' }]);
    const second = await client.pullDiagnostics(uri);
    expect(second?.map((d) => d.message)).toEqual(['second']);
  });

  it('does not pull diagnostics from servers without diagnosticProvider', async () => {
    client = fixtureClient('loading', 5000, { FIXTURE_NO_LOAD: 'true' });
    await client.initialize(os.tmpdir());
    expect(client.supportsPullDiagnostics()).toBe(false);
    expect(await client.pullDiagnostics('file:///tmp/project/a.fixture')).toBeNull();
  });

  it('merges pushed and pulled diagnostics without duplicates', async () => {
    // Like rust-analyzer: pull returns the server's own diagnostics, while
    // others (e.g. cargo check) are still pushed.
    client = fixtureClient('loading', 5000, { FIXTURE_NO_LOAD: 'true', FIXTURE_PULL: 'true', FIXTURE_DIAG_DELAY_MS: '100', FIXTURE_PULL_PREFIX: 'native:' });
    await client.initialize(os.tmpdir());
    const uri = 'file:///tmp/project/a.fixture';
    client.didOpen({ uri, languageId: 'fixture', version: 1, text: 'first' });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const merged = await client.pullDiagnostics(uri);
    expect(merged?.map((d) => d.message).sort()).toEqual(['first', 'native:first']);
    expect(client.hasPushedDiagnostics(uri)).toBe(true);
    expect(client.getCachedDiagnostics(uri).map((d) => d.message).sort()).toEqual(['first', 'native:first']);
  });

  it('reports a diagnostic that is both pushed and pulled once', async () => {
    client = fixtureClient('loading', 5000, { FIXTURE_NO_LOAD: 'true', FIXTURE_PULL: 'true', FIXTURE_DIAG_DELAY_MS: '100' });
    await client.initialize(os.tmpdir());
    const uri = 'file:///tmp/project/a.fixture';
    client.didOpen({ uri, languageId: 'fixture', version: 1, text: 'first' });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect((await client.pullDiagnostics(uri))?.map((d) => d.message)).toEqual(['first']);
  });
});
