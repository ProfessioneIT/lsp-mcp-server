/** Exercise the compiled executable through the public MCP protocol. */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const entrypoint = fileURLToPath(new URL('../../dist/index.js', import.meta.url));
const fixturePath = fileURLToPath(new URL('../fixtures/behavior-server.mjs', import.meta.url));

function readResult(result: CallToolResult): unknown {
  const content = result.content[0];
  if (!content || content.type !== 'text') {
    throw new Error('Expected a text tool result');
  }
  return JSON.parse(content.text);
}

describe('MCP stdio compatibility', () => {
  let workspaceRoot: string;
  let filePath: string;
  let client: Client | undefined;
  let transport: StdioClientTransport | undefined;
  let stderr: string;
  let protocolErrors: Error[];

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lsp-mcp-stdio-'));
    filePath = path.join(workspaceRoot, 'main.fixture');
    stderr = '';
    protocolErrors = [];
    await fs.writeFile(filePath, 'before');
    await fs.writeFile(path.join(workspaceRoot, 'other.fixture'), 'other');
    await fs.writeFile(path.join(workspaceRoot, '.lsp-mcp.json'), JSON.stringify({
      logLevel: 'info',
      servers: [{
        id: 'behavior-fixture',
        extensions: ['.fixture'],
        languageIds: ['fixture'],
        command: process.execPath,
        args: [fixturePath],
        env: { FIXTURE_NO_LOAD: 'true', FIXTURE_PULL: 'true' },
      }],
    }));
  });

  afterEach(async () => {
    try {
      await client?.close();
    } finally {
      await transport?.close();
      client = undefined;
      transport = undefined;
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  async function connect(name = 'codex'): Promise<Client> {
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [entrypoint],
      cwd: workspaceRoot,
      stderr: 'pipe',
      env: { LSP_LOG_LEVEL: 'info' },
    });
    transport.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    // No roots, sampling, or elicitation capability is required by this server.
    client = new Client({ name, version: 'compatibility-test' }, { capabilities: {} });
    client.onerror = (error) => protocolErrors.push(error);
    try {
      await client.connect(transport);
    } catch (error) {
      throw new Error(`MCP initialization failed. Server stderr:\n${stderr}`, { cause: error });
    }
    return client;
  }

  it.each(['codex', 'claude-code'])('initializes, lists tools, and returns status for %s', async (name) => {
    const connected = await connect(name);
    expect(connected.getServerVersion()).toMatchObject({ name: 'lsp-mcp-server' });
    expect(connected.getServerCapabilities()).toMatchObject({ tools: {} });

    const { tools } = await connected.listTools();
    expect(tools).toHaveLength(29);
    expect(new Set(tools.map(tool => tool.name)).size).toBe(tools.length);
    expect(tools.map(tool => tool.name)).toEqual(expect.arrayContaining([
      'lsp_server_status', 'lsp_find_references', 'lsp_diagnostics', 'lsp_rename',
    ]));
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.description).toBeTruthy();
    }

    const result = await connected.callTool({ name: 'lsp_server_status', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(readResult(result)).toEqual({ servers: [] });
    expect(stderr).toContain('LSP-MCP server running on stdio');
    expect(protocolErrors).toEqual([]);
  });

  it('includes essential navigation and edit guidance in the first 512 instruction characters', async () => {
    const connected = await connect();
    const instructions = connected.getInstructions()?.slice(0, 512) ?? '';
    expect(instructions).toContain('absolute file paths');
    expect(instructions).toContain('1-indexed');
    expect(instructions).toContain('auto-start');
    expect(instructions).toContain('dry_run=true');
    expect(instructions).toContain('apply=false');
    expect(instructions).toContain('lsp_index_files before lsp_workspace_diagnostics');
  });

  it('auto-starts a language server and preserves 1-indexed positions in tool results', async () => {
    const connected = await connect();
    const result = await connected.callTool({
      name: 'lsp_find_references',
      arguments: { file_path: filePath, line: 1, column: 2 },
    });
    expect(result.isError).not.toBe(true);
    expect(readResult(result)).toMatchObject({
      total_count: 2,
      references: [
        { path: filePath, line: 1, column: 2 },
        { path: path.join(workspaceRoot, 'other.fixture'), line: 1, column: 2 },
      ],
    });
    expect(protocolErrors).toEqual([]);
  });

  it('refreshes diagnostics after edits made outside the MCP server', async () => {
    const connected = await connect();
    const request = { name: 'lsp_diagnostics', arguments: { file_path: filePath } };
    const before = await connected.callTool(request);
    expect(before.isError).not.toBe(true);
    expect(readResult(before)).toMatchObject({ diagnostics: [{ message: 'before' }] });

    await fs.writeFile(filePath, 'after');
    const after = await connected.callTool(request);
    expect(after.isError).not.toBe(true);
    expect(readResult(after)).toMatchObject({ diagnostics: [{ message: 'after' }] });
    expect(protocolErrors).toEqual([]);
  });

  it('returns structured tool errors and keeps the connection usable', async () => {
    const connected = await connect();
    const invalid = await connected.callTool({
      name: 'lsp_find_references',
      arguments: { file_path: 'relative.fixture', line: 1, column: 1 },
    });
    expect(invalid.isError).toBe(true);
    expect(readResult(invalid)).toMatchObject({ error: { code: 'INVALID_INPUT' } });

    const unknown = await connected.callTool({ name: 'lsp_missing_tool', arguments: {} });
    expect(unknown.isError).toBe(true);
    expect(readResult(unknown)).toMatchObject({ error: { code: 'UNKNOWN_TOOL' } });

    const status = await connected.callTool({ name: 'lsp_server_status', arguments: {} });
    expect(status.isError).not.toBe(true);
    expect(readResult(status)).toEqual({ servers: [] });
  });
});
