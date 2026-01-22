#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import {
  GotoDefinitionSchema,
  GotoTypeDefinitionSchema,
  FindReferencesSchema,
  FindImplementationsSchema,
  HoverSchema,
  SignatureHelpSchema,
  DocumentSymbolsSchema,
  WorkspaceSymbolsSchema,
  DiagnosticsSchema,
  CompletionsSchema,
  RenameSchema,
  ServerStatusSchema,
  StartServerSchema,
  StopServerSchema,
} from './schemas/tool-schemas.js';

import {
  handleGotoDefinition,
  handleGotoTypeDefinition,
  handleFindReferences,
  handleFindImplementations,
  handleHover,
  handleSignatureHelp,
  handleDocumentSymbols,
  handleWorkspaceSymbols,
  handleDiagnostics,
  handleCompletions,
  handleRename,
  handleServerStatus,
  handleStartServer,
  handleStopServer,
  setToolContext,
} from './tools/index.js';

import { createConnectionManager } from './services/connection-manager.js';
import { createDocumentManager } from './services/document-manager.js';
import { createDiagnosticsCache } from './services/diagnostics-cache.js';
import { loadConfig } from './config.js';
import { log, setLogLevel } from './utils/logger.js';
import type { LSPError } from './types.js';
import type { CallToolRequest } from '@modelcontextprotocol/sdk/types.js';

// ============================================================================
// Tool Definitions
// ============================================================================

const TOOLS = [
  {
    name: 'lsp_goto_definition',
    description: 'Navigate to the definition of a symbol at the given position. Returns file path, line, and column of the definition.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the source file' },
        line: { type: 'number', description: 'Line number (1-indexed)' },
        column: { type: 'number', description: 'Column number (1-indexed)' },
      },
      required: ['file_path', 'line', 'column'],
    },
  },
  {
    name: 'lsp_goto_type_definition',
    description: 'Navigate to the type definition of a symbol. Useful for finding the class/interface that defines a variable\'s type.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the source file' },
        line: { type: 'number', description: 'Line number (1-indexed)' },
        column: { type: 'number', description: 'Column number (1-indexed)' },
      },
      required: ['file_path', 'line', 'column'],
    },
  },
  {
    name: 'lsp_find_references',
    description: 'Find all references to the symbol at the given position across the workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the source file' },
        line: { type: 'number', description: 'Line number (1-indexed)' },
        column: { type: 'number', description: 'Column number (1-indexed)' },
        include_declaration: { type: 'boolean', description: 'Whether to include the declaration in results', default: true },
        limit: { type: 'number', description: 'Maximum number of results to return', default: 100 },
        offset: { type: 'number', description: 'Number of results to skip (for pagination)', default: 0 },
      },
      required: ['file_path', 'line', 'column'],
    },
  },
  {
    name: 'lsp_find_implementations',
    description: 'Find all implementations of an interface or abstract method.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the source file' },
        line: { type: 'number', description: 'Line number (1-indexed)' },
        column: { type: 'number', description: 'Column number (1-indexed)' },
        limit: { type: 'number', description: 'Maximum number of results', default: 50 },
      },
      required: ['file_path', 'line', 'column'],
    },
  },
  {
    name: 'lsp_hover',
    description: 'Get hover information (type info, documentation) for the symbol at the given position.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the source file' },
        line: { type: 'number', description: 'Line number (1-indexed)' },
        column: { type: 'number', description: 'Column number (1-indexed)' },
      },
      required: ['file_path', 'line', 'column'],
    },
  },
  {
    name: 'lsp_signature_help',
    description: 'Get function/method signature information when inside a call expression.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the source file' },
        line: { type: 'number', description: 'Line number (1-indexed)' },
        column: { type: 'number', description: 'Column number (1-indexed)' },
      },
      required: ['file_path', 'line', 'column'],
    },
  },
  {
    name: 'lsp_document_symbols',
    description: 'Get all symbols (functions, classes, variables, etc.) defined in a document.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the source file' },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'lsp_workspace_symbols',
    description: 'Search for symbols across the entire workspace by name.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query to match symbol names (supports fuzzy matching)' },
        kinds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter results to specific symbol kinds (e.g., "Class", "Function", "Variable")',
        },
        limit: { type: 'number', description: 'Maximum number of results', default: 50 },
      },
      required: ['query'],
    },
  },
  {
    name: 'lsp_diagnostics',
    description: 'Get cached diagnostics (errors, warnings) for a file. Diagnostics come from language server notifications.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the source file' },
        severity_filter: {
          type: 'string',
          enum: ['all', 'error', 'warning', 'info', 'hint'],
          description: 'Filter diagnostics by minimum severity',
          default: 'all',
        },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'lsp_completions',
    description: 'Get code completion suggestions at the given position.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the source file' },
        line: { type: 'number', description: 'Line number (1-indexed)' },
        column: { type: 'number', description: 'Column number (1-indexed)' },
        limit: { type: 'number', description: 'Maximum number of suggestions', default: 20 },
      },
      required: ['file_path', 'line', 'column'],
    },
  },
  {
    name: 'lsp_rename',
    description: 'Rename a symbol across the workspace. By default performs a dry run showing changes without applying them.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the source file' },
        line: { type: 'number', description: 'Line number (1-indexed)' },
        column: { type: 'number', description: 'Column number (1-indexed)' },
        new_name: { type: 'string', description: 'New name for the symbol' },
        dry_run: { type: 'boolean', description: 'If true, only preview changes without applying. If false, apply changes to files.', default: true },
      },
      required: ['file_path', 'line', 'column', 'new_name'],
    },
  },
  {
    name: 'lsp_server_status',
    description: 'Get status of running language servers.',
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: 'Specific server ID to check, or omit for all servers' },
      },
    },
  },
  {
    name: 'lsp_start_server',
    description: 'Manually start a language server for a specific workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: "Server ID from configuration (e.g., 'typescript', 'python')" },
        workspace_root: { type: 'string', description: 'Absolute path to the workspace/project root' },
      },
      required: ['server_id', 'workspace_root'],
    },
  },
  {
    name: 'lsp_stop_server',
    description: 'Stop a running language server.',
    inputSchema: {
      type: 'object',
      properties: {
        server_id: { type: 'string', description: "Server ID from configuration (e.g., 'typescript', 'python')" },
        workspace_root: { type: 'string', description: 'Workspace root to stop server for. If omitted, stops all instances of this server type.' },
      },
      required: ['server_id'],
    },
  },
];

// ============================================================================
// Tool Handlers Map
// ============================================================================

type ToolHandler = (input: unknown) => Promise<unknown>;

const toolHandlers: Record<string, { schema: unknown; handler: ToolHandler }> = {
  lsp_goto_definition: {
    schema: GotoDefinitionSchema,
    handler: async (input) => handleGotoDefinition(GotoDefinitionSchema.parse(input)),
  },
  lsp_goto_type_definition: {
    schema: GotoTypeDefinitionSchema,
    handler: async (input) => handleGotoTypeDefinition(GotoTypeDefinitionSchema.parse(input)),
  },
  lsp_find_references: {
    schema: FindReferencesSchema,
    handler: async (input) => handleFindReferences(FindReferencesSchema.parse(input)),
  },
  lsp_find_implementations: {
    schema: FindImplementationsSchema,
    handler: async (input) => handleFindImplementations(FindImplementationsSchema.parse(input)),
  },
  lsp_hover: {
    schema: HoverSchema,
    handler: async (input) => handleHover(HoverSchema.parse(input)),
  },
  lsp_signature_help: {
    schema: SignatureHelpSchema,
    handler: async (input) => handleSignatureHelp(SignatureHelpSchema.parse(input)),
  },
  lsp_document_symbols: {
    schema: DocumentSymbolsSchema,
    handler: async (input) => handleDocumentSymbols(DocumentSymbolsSchema.parse(input)),
  },
  lsp_workspace_symbols: {
    schema: WorkspaceSymbolsSchema,
    handler: async (input) => handleWorkspaceSymbols(WorkspaceSymbolsSchema.parse(input)),
  },
  lsp_diagnostics: {
    schema: DiagnosticsSchema,
    handler: async (input) => handleDiagnostics(DiagnosticsSchema.parse(input)),
  },
  lsp_completions: {
    schema: CompletionsSchema,
    handler: async (input) => handleCompletions(CompletionsSchema.parse(input)),
  },
  lsp_rename: {
    schema: RenameSchema,
    handler: async (input) => handleRename(RenameSchema.parse(input)),
  },
  lsp_server_status: {
    schema: ServerStatusSchema,
    handler: async (input) => handleServerStatus(ServerStatusSchema.parse(input)),
  },
  lsp_start_server: {
    schema: StartServerSchema,
    handler: async (input) => handleStartServer(StartServerSchema.parse(input)),
  },
  lsp_stop_server: {
    schema: StopServerSchema,
    handler: async (input) => handleStopServer(StopServerSchema.parse(input)),
  },
};

// ============================================================================
// Main
// ============================================================================

async function main() {
  // Load configuration
  const config = await loadConfig();
  setLogLevel(config.logLevel);

  log('info', 'Starting LSP-MCP server...');

  // Create managers
  const connectionManager = createConnectionManager(config);
  const documentManager = createDocumentManager();
  const diagnosticsCache = createDiagnosticsCache();

  // Set tool context
  setToolContext({
    connectionManager,
    documentManager,
    diagnosticsCache,
    config,
  });

  // Create MCP server
  const server = new Server(
    {
      name: 'lsp-mcp-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register list tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  // Register call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
    const { name, arguments: args } = request.params;

    const toolEntry = toolHandlers[name];
    if (!toolEntry) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: {
                code: 'UNKNOWN_TOOL',
                message: `Unknown tool: ${name}`,
                suggestion: 'Use lsp_server_status to see available tools and servers.',
              },
            }),
          },
        ],
        isError: true,
      };
    }

    try {
      const result = await toolEntry.handler(args);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      // Handle LSP errors
      if (error && typeof error === 'object' && 'toJSON' in error) {
        const lspError = error as LSPError;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(lspError.toJSON()),
            },
          ],
          isError: true,
        };
      }

      // Handle Zod validation errors
      if (error && typeof error === 'object' && 'issues' in error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: {
                  code: 'INVALID_INPUT',
                  message: 'Invalid input parameters',
                  details: (error as { issues: unknown[] }).issues,
                },
              }),
            },
          ],
          isError: true,
        };
      }

      // Handle generic errors
      const message = error instanceof Error ? error.message : String(error);
      log('error', `Tool ${name} failed: ${message}`);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: {
                code: 'INTERNAL_ERROR',
                message,
                suggestion: 'Check server logs for details.',
              },
            }),
          },
        ],
        isError: true,
      };
    }
  });

  // Handle shutdown
  const shutdown = async () => {
    log('info', 'Shutting down...');
    await connectionManager.shutdownAll();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);

  log('info', 'LSP-MCP server running on stdio');
}

main().catch((error) => {
  log('error', `Fatal error: ${error}`);
  process.exit(1);
});
