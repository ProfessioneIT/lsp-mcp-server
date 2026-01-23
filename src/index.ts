#!/usr/bin/env node
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


// TODO: Migrate to McpServer high-level API when time permits
// The Server class is deprecated in favor of McpServer from '@modelcontextprotocol/sdk/server/mcp.js'
// McpServer provides a simpler API with registerTool() instead of manual setRequestHandler() calls
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
  CodeActionsSchema,
  CallHierarchySchema,
  TypeHierarchySchema,
  FormatDocumentSchema,
  SmartSearchSchema,
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
  handleCodeActions,
  handleCallHierarchy,
  handleTypeHierarchy,
  handleFormatDocument,
  handleSmartSearch,
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
    annotations: {
      title: 'Go to Definition',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
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
    annotations: {
      title: 'Go to Type Definition',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
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
    annotations: {
      title: 'Find References',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
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
    annotations: {
      title: 'Find Implementations',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
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
    annotations: {
      title: 'Hover Information',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
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
    annotations: {
      title: 'Signature Help',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
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
    annotations: {
      title: 'Document Symbols',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
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
    annotations: {
      title: 'Workspace Symbols',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
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
    annotations: {
      title: 'Get Diagnostics',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
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
    annotations: {
      title: 'Code Completions',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
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
    annotations: {
      title: 'Rename Symbol',
      readOnlyHint: false, // Can modify files when dry_run=false
      idempotentHint: true,
      destructiveHint: false, // Reversible via undo
      openWorldHint: false,
    },
  },
  {
    name: 'lsp_code_actions',
    description: 'Get available code actions (refactorings, quick fixes) at a position or range. Use for automated fixes, imports organization, and refactoring operations.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the source file' },
        start_line: { type: 'number', description: 'Start line number (1-indexed)' },
        start_column: { type: 'number', description: 'Start column number (1-indexed)' },
        end_line: { type: 'number', description: 'End line number (1-indexed). Defaults to start line.' },
        end_column: { type: 'number', description: 'End column number (1-indexed). Defaults to start column.' },
        kinds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by code action kinds: quickfix, refactor, refactor.extract, refactor.inline, refactor.rewrite, source, source.organizeImports, source.fixAll',
        },
        apply: { type: 'boolean', description: 'If true, apply the first available action. If false, just list available actions.', default: false },
        action_index: { type: 'number', description: 'Index of the action to apply (when apply=true). Defaults to 0 (first action).' },
      },
      required: ['file_path', 'start_line', 'start_column'],
    },
    annotations: {
      title: 'Code Actions',
      readOnlyHint: false, // Can modify files when apply=true
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'lsp_call_hierarchy',
    description: 'Get the call hierarchy for a function/method - who calls this function (incoming) and what functions this calls (outgoing). Essential for understanding code flow and impact analysis before refactoring.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the source file' },
        line: { type: 'number', description: 'Line number (1-indexed)' },
        column: { type: 'number', description: 'Column number (1-indexed)' },
        direction: {
          type: 'string',
          enum: ['incoming', 'outgoing', 'both'],
          description: 'Direction of call hierarchy: incoming (callers), outgoing (callees), or both',
          default: 'both',
        },
      },
      required: ['file_path', 'line', 'column'],
    },
    annotations: {
      title: 'Call Hierarchy',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'lsp_type_hierarchy',
    description: 'Get the type hierarchy for a class/interface - supertypes (parents, interfaces) and subtypes (children, implementations). Use for understanding inheritance and planning refactoring that affects class hierarchies.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the source file' },
        line: { type: 'number', description: 'Line number (1-indexed)' },
        column: { type: 'number', description: 'Column number (1-indexed)' },
        direction: {
          type: 'string',
          enum: ['supertypes', 'subtypes', 'both'],
          description: 'Direction of type hierarchy: supertypes (parents), subtypes (children), or both',
          default: 'both',
        },
      },
      required: ['file_path', 'line', 'column'],
    },
    annotations: {
      title: 'Type Hierarchy',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'lsp_format_document',
    description: 'Format a document using the language server\'s formatting capabilities. Respects project-specific formatting settings.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the source file to format' },
        tab_size: { type: 'number', description: 'Number of spaces per tab (default: 2)', default: 2 },
        insert_spaces: { type: 'boolean', description: 'Use spaces instead of tabs (default: true)', default: true },
        apply: { type: 'boolean', description: 'If true, apply formatting changes to file. If false, return edits without applying.', default: false },
      },
      required: ['file_path'],
    },
    annotations: {
      title: 'Format Document',
      readOnlyHint: false, // Can modify files when apply=true
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'lsp_smart_search',
    description: 'Comprehensive symbol search combining multiple LSP operations in one call. Get definition, references, implementations, type info, and call hierarchy for a symbol. More efficient than calling multiple individual tools.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the source file' },
        line: { type: 'number', description: 'Line number (1-indexed)' },
        column: { type: 'number', description: 'Column number (1-indexed)' },
        include: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['hover', 'definition', 'references', 'implementations', 'incoming_calls', 'outgoing_calls'],
          },
          description: 'Which information to include in results',
          default: ['hover', 'definition', 'references'],
        },
        references_limit: { type: 'number', description: 'Maximum number of references/implementations to return', default: 20 },
      },
      required: ['file_path', 'line', 'column'],
    },
    annotations: {
      title: 'Smart Search',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
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
    annotations: {
      title: 'Server Status',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
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
    annotations: {
      title: 'Start Server',
      readOnlyHint: false,
      idempotentHint: true,
      openWorldHint: false,
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
    annotations: {
      title: 'Stop Server',
      readOnlyHint: false,
      idempotentHint: true,
      openWorldHint: false,
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
  lsp_code_actions: {
    schema: CodeActionsSchema,
    handler: async (input) => handleCodeActions(CodeActionsSchema.parse(input)),
  },
  lsp_call_hierarchy: {
    schema: CallHierarchySchema,
    handler: async (input) => handleCallHierarchy(CallHierarchySchema.parse(input)),
  },
  lsp_type_hierarchy: {
    schema: TypeHierarchySchema,
    handler: async (input) => handleTypeHierarchy(TypeHierarchySchema.parse(input)),
  },
  lsp_format_document: {
    schema: FormatDocumentSchema,
    handler: async (input) => handleFormatDocument(FormatDocumentSchema.parse(input)),
  },
  lsp_smart_search: {
    schema: SmartSearchSchema,
    handler: async (input) => handleSmartSearch(SmartSearchSchema.parse(input)),
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
