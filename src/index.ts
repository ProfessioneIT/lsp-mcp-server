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
  WorkspaceDiagnosticsSchema,
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
  FindSymbolSchema,
  FileExportsSchema,
  FileImportsSchema,
  RelatedFilesSchema,
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
  handleFileExports,
  handleFileImports,
  handleRelatedFiles,
  handleDiagnostics,
  handleWorkspaceDiagnostics,
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
  handleFindSymbol,
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
    description: 'Find where a function, class, or variable is defined. More accurate than grep—handles aliases, re-exports, and overloads correctly. Returns file path, line, and column of the definition.',
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
    description: 'Find the type that defines a variable, parameter, or return value. Use when you have a variable and want to see its interface/class definition, not where the variable itself is declared.',
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
    description: 'Find every usage of a symbol across the codebase. Use before renaming or deleting to understand impact. More complete than grep—finds semantic matches, not just text.',
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
    description: 'Find all concrete implementations of an interface, abstract class, or abstract method. Use to understand how an abstraction is actually used in practice.',
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
    description: 'Get the type signature and documentation for any symbol. Use to understand what a function accepts/returns or what type a variable has, without reading its implementation.',
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
    description: 'Get parameter hints for a function call. Use when you need to know what arguments a function expects and their types, especially for overloaded functions.',
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
    description: 'Get a structured outline of a file: all functions, classes, interfaces, and variables with their types and relationships. Faster and more accurate than reading and parsing the file yourself.',
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
    description: 'Find any function, class, interface, or type by name—no file path needed. Start here when exploring a codebase or locating where something is defined. Supports fuzzy matching.',
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
    name: 'lsp_file_exports',
    description: 'Get the public API surface of a file: top-level functions, classes, interfaces, and variables with their type signatures. Use to understand what a module exposes without reading the entire file.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the source file' },
        include_signatures: { type: 'boolean', description: 'Include type signatures (slower but more informative)', default: true },
      },
      required: ['file_path'],
    },
    annotations: {
      title: 'File Exports',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'lsp_file_imports',
    description: 'Get all imports/dependencies of a file. Shows what modules this file depends on, including ES modules, CommonJS require(), and dynamic imports. Use to understand file dependencies.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the source file' },
      },
      required: ['file_path'],
    },
    annotations: {
      title: 'File Imports',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'lsp_related_files',
    description: 'Find files connected to a given file: what it imports and what imports it. Use to understand a file\'s dependencies and dependents before refactoring.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the source file' },
        relationship: {
          type: 'string',
          enum: ['imports', 'imported_by', 'all'],
          description: 'Which relationships to include',
          default: 'all',
        },
      },
      required: ['file_path'],
    },
    annotations: {
      title: 'Related Files',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'lsp_diagnostics',
    description: 'Get compiler errors, warnings, and hints for a file. Use after making changes to check for type errors, missing imports, or other issues. Results are cached from language server notifications.',
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
    name: 'lsp_workspace_diagnostics',
    description: 'Get all errors and warnings across the entire project—no file path needed. Use during initial analysis to find problems or after changes to check overall project health. Only includes files opened in this session.',
    inputSchema: {
      type: 'object',
      properties: {
        severity_filter: {
          type: 'string',
          enum: ['all', 'error', 'warning', 'info', 'hint'],
          description: 'Filter diagnostics by minimum severity',
          default: 'all',
        },
        limit: { type: 'number', description: 'Maximum number of diagnostics to return', default: 50 },
        group_by: {
          type: 'string',
          enum: ['file', 'severity'],
          description: 'How to group/sort results',
          default: 'file',
        },
      },
      required: [],
    },
    annotations: {
      title: 'Workspace Diagnostics',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'lsp_completions',
    description: 'Get intelligent code completion suggestions at a position. Returns available methods, properties, variables, and types that are valid in that context. More accurate than text-based completion.',
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
    description: 'Rename a symbol across the entire codebase safely. Handles all references, imports, and re-exports. Use dry_run=true (default) to preview changes before applying. More reliable than find-and-replace.',
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
    description: 'Get quick fixes and refactoring suggestions at a position. Use to auto-fix errors, organize imports, extract functions, or apply other automated transformations. Set apply=true to execute an action.',
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
    description: 'Trace function calls: who calls this function (incoming) and what it calls (outgoing). Essential for understanding code flow and assessing impact before modifying a function.',
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
    description: 'Explore inheritance: find parent classes/interfaces (supertypes) and child classes/implementations (subtypes). Use to understand class relationships before modifying a base class or interface.',
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
    description: 'Format a file according to project style settings (prettier, eslint, etc.). Use after making edits to ensure consistent formatting. Set apply=true to write changes.',
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
    description: 'Get comprehensive information about a symbol in one call: type signature, definition location, all references, implementations, and call hierarchy. Use when you need full context about something instead of making multiple separate queries.',
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
    name: 'lsp_find_symbol',
    description: 'Find a symbol by name alone—no file path or position needed. Returns the definition location plus full context (type info, references, call hierarchy). Use when you know a symbol name but not where it is defined.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Symbol name to search for (supports fuzzy matching)' },
        kind: {
          type: 'string',
          enum: ['File', 'Module', 'Namespace', 'Package', 'Class', 'Method', 'Property', 'Field', 'Constructor', 'Enum', 'Interface', 'Function', 'Variable', 'Constant', 'String', 'Number', 'Boolean', 'Array', 'Object', 'Key', 'Null', 'EnumMember', 'Struct', 'Event', 'Operator', 'TypeParameter'],
          description: 'Filter to specific symbol kind',
        },
        include: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['hover', 'definition', 'references', 'implementations', 'incoming_calls', 'outgoing_calls'],
          },
          description: 'What information to include for the found symbol',
          default: ['hover', 'definition', 'references'],
        },
        references_limit: { type: 'number', description: 'Maximum number of references to include', default: 20 },
      },
      required: ['name'],
    },
    annotations: {
      title: 'Find Symbol',
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'lsp_server_status',
    description: 'Check which language servers are running and their state. Use to verify LSP is available before analysis or to debug connection issues.',
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
    description: 'Start a language server manually for a workspace. Usually not needed—servers auto-start when you use other LSP tools. Use only when you need explicit control over server lifecycle.',
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
    description: 'Stop a running language server to free resources. Servers auto-stop after idle timeout, so manual stop is rarely needed.',
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
  lsp_file_exports: {
    schema: FileExportsSchema,
    handler: async (input) => handleFileExports(FileExportsSchema.parse(input)),
  },
  lsp_file_imports: {
    schema: FileImportsSchema,
    handler: async (input) => handleFileImports(FileImportsSchema.parse(input)),
  },
  lsp_related_files: {
    schema: RelatedFilesSchema,
    handler: async (input) => handleRelatedFiles(RelatedFilesSchema.parse(input)),
  },
  lsp_diagnostics: {
    schema: DiagnosticsSchema,
    handler: async (input) => handleDiagnostics(DiagnosticsSchema.parse(input)),
  },
  lsp_workspace_diagnostics: {
    schema: WorkspaceDiagnosticsSchema,
    handler: async (input) => handleWorkspaceDiagnostics(WorkspaceDiagnosticsSchema.parse(input)),
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
  lsp_find_symbol: {
    schema: FindSymbolSchema,
    handler: async (input) => handleFindSymbol(FindSymbolSchema.parse(input)),
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
