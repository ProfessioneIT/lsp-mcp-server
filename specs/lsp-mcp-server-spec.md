# LSP MCP Server - Development Specification

## Executive Summary

Build an MCP server that bridges Claude Code to Language Server Protocol (LSP) servers, enabling semantic code intelligence capabilities like go-to-definition, find-references, hover information, and workspace symbol search.

**Project Name:** `lsp-mcp-server`
**Language:** TypeScript
**Transport:** stdio (for Claude Code integration)
**Target Users:** Claude Code users who want enhanced code navigation

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Claude Code                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ MCP Protocol (stdio)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      lsp-mcp-server                             │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              LSP Connection Manager                       │  │
│  │  - Spawns and manages language server processes           │  │
│  │  - Routes requests by (language, workspace root) pair     │  │
│  │  - Handles lifecycle (init, shutdown, restart)            │  │
│  │  - Supports multiple instances per language for monorepos │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              Document Sync Manager                        │  │
│  │  - Tracks open documents per server instance              │  │
│  │  - Sends didOpen/didChange/didClose notifications         │  │
│  │  - Manages document versions (monotonic per URI)          │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              Diagnostics Cache                            │  │
│  │  - Stores diagnostics from publishDiagnostics notifs      │  │
│  │  - Indexed by document URI                                │  │
│  │  - Invalidated on document close or server restart        │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ LSP Protocol (stdio per server)
                              ▼
┌────────────────────┐  ┌──────────────┐  ┌──────────────┐
│ typescript-language│  │    pylsp     │  │ rust-analyzer│  ...
│      -server       │  │              │  │              │
└────────────────────┘  └──────────────┘  └──────────────┘
```

### Key Architecture Decisions

**Multi-root Workspace Support:** In monorepos, the same language may have multiple project roots (e.g., two TypeScript projects with different `tsconfig.json`). The connection manager maintains server instances keyed by `(languageId, workspaceRoot)` pairs, not just language.

**Workspace Root Detection:** The server detects workspace root by walking up from the file path looking for root markers (`package.json`, `tsconfig.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `.git`). This can be overridden via the `LSP_WORKSPACE_ROOT` environment variable.

**Diagnostics are Push-Based:** LSP servers push diagnostics via `textDocument/publishDiagnostics` notifications - they cannot be requested on demand. The server caches all received diagnostics and the `lsp_diagnostics` tool returns cached results.

**Position Encoding:** LSP traditionally uses UTF-16 code unit offsets. This server negotiates `positionEncodings` capability (LSP 3.17+) preferring UTF-32/UTF-8 when available, with proper UTF-16 conversion as fallback for emoji and non-BMP characters.

**Indexing Convention:** All tool inputs and outputs use **1-indexed** line and column numbers for human readability. Conversion to/from LSP's 0-indexed positions is handled internally.

---

## Phase 1: Core Infrastructure

### 1.1 Project Setup

```
lsp-mcp-server/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── types.ts              # TypeScript interfaces
│   ├── constants.ts          # Configuration constants
│   ├── utils/
│   │   ├── position.ts       # UTF-16 <-> UTF-32 position conversion
│   │   ├── uri.ts            # File path <-> URI conversion, symlink handling
│   │   └── workspace.ts      # Workspace root detection
│   ├── tools/
│   │   ├── definition.ts     # Go to definition tool
│   │   ├── type-definition.ts # Go to type definition tool
│   │   ├── references.ts     # Find references tool
│   │   ├── implementations.ts # Find implementations tool
│   │   ├── hover.ts          # Hover information tool
│   │   ├── signature-help.ts # Signature help tool
│   │   ├── symbols.ts        # Workspace/document symbols
│   │   ├── diagnostics.ts    # Get diagnostics tool
│   │   ├── completion.ts     # Code completion tool
│   │   └── rename.ts         # Rename symbol tool
│   ├── services/
│   │   ├── lsp-client.ts     # LSP client wrapper
│   │   ├── connection-manager.ts  # Manages multiple LS instances
│   │   ├── document-manager.ts    # Document sync handling
│   │   ├── diagnostics-cache.ts   # Caches pushed diagnostics
│   │   └── language-detector.ts   # Detect language from file
│   └── schemas/
│       └── tool-schemas.ts   # Zod schemas for all tools
├── tests/
│   ├── unit/
│   │   ├── position.test.ts  # UTF-16 conversion tests
│   │   └── workspace.test.ts # Root detection tests
│   └── integration/
│       └── typescript.test.ts # Real LSP server tests
└── dist/
```

### 1.2 Dependencies

```json
{
  "name": "lsp-mcp-server",
  "version": "1.1.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsc --watch",
    "test": "vitest",
    "test:integration": "vitest --config vitest.integration.config.ts",
    "lint": "eslint src/",
    "lint:fix": "eslint src/ --fix",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "vscode-languageserver-protocol": "^3.17.5",
    "vscode-jsonrpc": "^8.2.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.0.0",
    "eslint": "^8.57.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0"
  }
}
```

**Note:** We use `vscode-jsonrpc` + `vscode-languageserver-protocol` directly instead of `vscode-languageclient`, which has VS Code-specific abstractions unsuitable for standalone Node.js processes.

### 1.3 Configuration Schema

The server supports configuration via a JSON file (path in `LSP_CONFIG_PATH` env var) or environment variables:

```typescript
interface LSPServerConfig {
  // Server identifier (e.g., "typescript", "python", "rust")
  id: string;

  // File extensions this server handles
  extensions: string[];

  // Language IDs (as per LSP spec)
  languageIds: string[];

  // Command to start the language server
  // Supports absolute paths and npx (e.g., "npx typescript-language-server")
  command: string;

  // Command arguments
  args: string[];

  // Environment variables
  env?: Record<string, string>;

  // Initialization options to pass to the server
  initializationOptions?: Record<string, unknown>;

  // Patterns to identify project root (e.g., ["package.json", "tsconfig.json"])
  rootPatterns?: string[];
}

interface Config {
  servers: LSPServerConfig[];

  // Default timeout for LSP requests (ms)
  requestTimeout: number;

  // Whether to auto-start servers on first request
  autoStart: boolean;

  // Log level
  logLevel: "debug" | "info" | "warn" | "error";

  // Idle timeout before shutting down unused servers (ms)
  idleTimeout: number;
}
```

**Default Configuration Example:**

```json
{
  "servers": [
    {
      "id": "typescript",
      "extensions": [".ts", ".tsx", ".js", ".jsx"],
      "languageIds": ["typescript", "typescriptreact", "javascript", "javascriptreact"],
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "rootPatterns": ["tsconfig.json", "jsconfig.json", "package.json"]
    },
    {
      "id": "python",
      "extensions": [".py", ".pyi"],
      "languageIds": ["python"],
      "command": "pylsp",
      "args": [],
      "rootPatterns": ["pyproject.toml", "setup.py", "requirements.txt"]
    },
    {
      "id": "rust",
      "extensions": [".rs"],
      "languageIds": ["rust"],
      "command": "rust-analyzer",
      "args": [],
      "rootPatterns": ["Cargo.toml"]
    },
    {
      "id": "go",
      "extensions": [".go"],
      "languageIds": ["go"],
      "command": "gopls",
      "args": ["serve"],
      "rootPatterns": ["go.mod", "go.work"]
    }
  ],
  "requestTimeout": 30000,
  "autoStart": true,
  "logLevel": "info",
  "idleTimeout": 1800000
}
```

---

## Phase 2: LSP Client Implementation

### 2.1 LSP Client Wrapper (`lsp-client.ts`)

Responsibilities:
- Spawn language server process via stdio
- Handle LSP JSON-RPC communication
- Manage initialization handshake with capability negotiation
- Track server capabilities
- Handle request/response correlation
- Implement request cancellation ($/cancelRequest)
- Listen for and cache diagnostics from publishDiagnostics

```typescript
interface LSPClient {
  // Lifecycle
  initialize(rootUri: string): Promise<InitializeResult>;
  shutdown(): Promise<void>;
  exit(): void;

  // Document sync
  didOpen(document: TextDocumentItem): void;
  didChange(uri: string, version: number, changes: TextDocumentContentChangeEvent[]): void;
  didClose(uri: string): void;

  // Language features (positions are 0-indexed internally)
  definition(uri: string, position: Position): Promise<Location | Location[] | LocationLink[] | null>;
  typeDefinition(uri: string, position: Position): Promise<Location | Location[] | LocationLink[] | null>;
  references(uri: string, position: Position, includeDeclaration: boolean): Promise<Location[] | null>;
  implementation(uri: string, position: Position): Promise<Location | Location[] | LocationLink[] | null>;
  hover(uri: string, position: Position): Promise<Hover | null>;
  signatureHelp(uri: string, position: Position): Promise<SignatureHelp | null>;
  documentSymbols(uri: string): Promise<DocumentSymbol[] | SymbolInformation[] | null>;
  workspaceSymbols(query: string): Promise<SymbolInformation[] | WorkspaceSymbol[] | null>;
  completion(uri: string, position: Position): Promise<CompletionList | CompletionItem[] | null>;
  prepareRename(uri: string, position: Position): Promise<Range | { range: Range; placeholder: string } | null>;
  rename(uri: string, position: Position, newName: string): Promise<WorkspaceEdit | null>;

  // Request management
  cancelRequest(id: number | string): void;

  // Diagnostics (from cache, populated by publishDiagnostics notifications)
  getCachedDiagnostics(uri: string): Diagnostic[];

  // State
  readonly capabilities: ServerCapabilities;
  readonly isInitialized: boolean;
  readonly workspaceRoot: string;
}
```

### 2.2 Connection Manager (`connection-manager.ts`)

Responsibilities:
- Maintain pool of LSP client instances, keyed by (languageId, workspaceRoot)
- Route requests based on file path (detect language and workspace root)
- Handle server crashes and restart (max 3 retries per server)
- Lazy initialization (start servers on demand)
- Idle server shutdown

```typescript
interface ConnectionManager {
  // Get or create client for a file (detects language and workspace root)
  getClientForFile(filePath: string): Promise<LSPClient>;

  // Get client by explicit parameters
  getClient(languageId: string, workspaceRoot: string): Promise<LSPClient>;

  // Manually start a specific server
  startServer(serverId: string, workspaceRoot: string): Promise<LSPClient>;

  // Stop a server
  stopServer(serverId: string, workspaceRoot?: string): Promise<void>;

  // Stop all servers
  shutdownAll(): Promise<void>;

  // List active servers with their workspace roots
  listActiveServers(): Array<{ id: string; workspaceRoot: string; status: string }>;

  // Detect workspace root for a file path
  detectWorkspaceRoot(filePath: string): string;
}
```

### 2.3 Document Manager (`document-manager.ts`)

Responsibilities:
- Track which documents have been opened with which server instances
- Read file contents from disk when needed (with encoding detection)
- Send appropriate didOpen/didChange/didClose notifications
- Cache document content to avoid re-reading
- Maintain monotonic version counters per URI
- Handle concurrent access with per-URI locks

```typescript
interface DocumentManager {
  // Open a document (reads from disk, sends didOpen)
  openDocument(uri: string, client: LSPClient): Promise<void>;

  // Ensure document is open (idempotent, thread-safe)
  ensureOpen(uri: string, client: LSPClient): Promise<void>;

  // Close a document
  closeDocument(uri: string, client: LSPClient): Promise<void>;

  // Update document content (for unsaved changes - rarely used)
  updateContent(uri: string, content: string, client: LSPClient): Promise<void>;

  // Get current content
  getContent(uri: string): string | undefined;

  // Check if document is open with a specific client
  isOpen(uri: string, client: LSPClient): boolean;

  // Get current version for a URI
  getVersion(uri: string): number;
}
```

### 2.4 Diagnostics Cache (`diagnostics-cache.ts`)

Responsibilities:
- Store diagnostics received from `textDocument/publishDiagnostics` notifications
- Index by document URI for fast lookup
- Invalidate on document close or server restart

```typescript
interface DiagnosticsCache {
  // Called when publishDiagnostics notification is received
  update(uri: string, diagnostics: Diagnostic[]): void;

  // Get cached diagnostics for a URI
  get(uri: string): Diagnostic[];

  // Clear diagnostics for a URI (on document close)
  clear(uri: string): void;

  // Clear all diagnostics (on server restart)
  clearAll(): void;
}
```

### 2.5 Position Utilities (`utils/position.ts`)

Handle UTF-16 code unit conversion for LSP compatibility:

```typescript
// Convert 1-indexed (line, column) to LSP 0-indexed Position
// Handles UTF-16 surrogate pairs for non-BMP characters
function toLspPosition(
  line: number,
  column: number,
  documentContent: string
): Position;

// Convert LSP 0-indexed Position to 1-indexed (line, column)
function fromLspPosition(
  position: Position,
  documentContent: string
): { line: number; column: number };

// Convert a range
function toLspRange(/* ... */): Range;
function fromLspRange(/* ... */): { start: {...}; end: {...} };
```

---

## Phase 3: MCP Tools Implementation

### 3.1 Tool: `lsp_goto_definition`

**Purpose:** Navigate to the definition of a symbol at a given position.

```typescript
// Input Schema
const GotoDefinitionSchema = z.object({
  file_path: z.string()
    .describe("Absolute path to the source file"),
  line: z.number()
    .int()
    .min(1)
    .describe("Line number (1-indexed)"),
  column: z.number()
    .int()
    .min(1)
    .describe("Column number (1-indexed)")
}).strict();

// Tool registration
server.registerTool(
  "lsp_goto_definition",
  {
    title: "Go to Definition",
    description: `Find the definition location of a symbol at the specified position.

Returns the file path, line, and column where the symbol is defined.
Useful for navigating to function implementations, class definitions,
variable declarations, type definitions, etc.

All line and column numbers are 1-indexed.

Returns:
  JSON with definition location(s), each including a context line:
  {
    "definitions": [
      {
        "path": "/path/to/file.ts",
        "line": 10,
        "column": 5,
        "end_line": 10,
        "end_column": 20,
        "context": "export function myFunction(a: string): void {"
      }
    ]
  }

  Returns empty array if no definition found.`,
    inputSchema: GotoDefinitionSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  async (params) => { /* implementation */ }
);
```

### 3.2 Tool: `lsp_goto_type_definition`

**Purpose:** Navigate to the type definition of a symbol (e.g., go to the interface/class that defines the type of a variable).

```typescript
const GotoTypeDefinitionSchema = z.object({
  file_path: z.string()
    .describe("Absolute path to the source file"),
  line: z.number()
    .int()
    .min(1)
    .describe("Line number (1-indexed)"),
  column: z.number()
    .int()
    .min(1)
    .describe("Column number (1-indexed)")
}).strict();

// Returns same format as lsp_goto_definition
{
  "definitions": [
    {
      "path": "/path/to/types.ts",
      "line": 15,
      "column": 1,
      "end_line": 25,
      "end_column": 2,
      "context": "interface UserProfile {"
    }
  ]
}
```

### 3.3 Tool: `lsp_find_references`

**Purpose:** Find all references to a symbol throughout the codebase.

```typescript
const FindReferencesSchema = z.object({
  file_path: z.string()
    .describe("Absolute path to the source file"),
  line: z.number()
    .int()
    .min(1)
    .describe("Line number (1-indexed)"),
  column: z.number()
    .int()
    .min(1)
    .describe("Column number (1-indexed)"),
  include_declaration: z.boolean()
    .default(true)
    .describe("Whether to include the declaration in results"),
  limit: z.number()
    .int()
    .min(1)
    .max(500)
    .default(100)
    .describe("Maximum number of results to return"),
  offset: z.number()
    .int()
    .min(0)
    .default(0)
    .describe("Number of results to skip (for pagination)")
}).strict();

// Returns
{
  "references": [
    {
      "path": "/path/to/file.ts",
      "line": 5,
      "column": 10,
      "end_line": 5,
      "end_column": 20,
      "context": "  const result = myFunction(args);"
    }
  ],
  "total_count": 150,
  "returned_count": 100,
  "offset": 0,
  "has_more": true
}
```

### 3.4 Tool: `lsp_find_implementations`

**Purpose:** Find implementations of an interface, abstract method, or type.

```typescript
const FindImplementationsSchema = z.object({
  file_path: z.string()
    .describe("Absolute path to the source file"),
  line: z.number()
    .int()
    .min(1)
    .describe("Line number (1-indexed)"),
  column: z.number()
    .int()
    .min(1)
    .describe("Column number (1-indexed)"),
  limit: z.number()
    .int()
    .min(1)
    .max(100)
    .default(50)
    .describe("Maximum number of results")
}).strict();

// Returns same format as lsp_find_references
{
  "implementations": [
    {
      "path": "/path/to/impl.ts",
      "line": 20,
      "column": 1,
      "end_line": 45,
      "end_column": 2,
      "context": "class ConcreteService implements IService {"
    }
  ],
  "total_count": 3,
  "returned_count": 3,
  "has_more": false
}
```

### 3.5 Tool: `lsp_hover`

**Purpose:** Get hover information (type info, documentation) for a symbol.

```typescript
const HoverSchema = z.object({
  file_path: z.string()
    .describe("Absolute path to the source file"),
  line: z.number()
    .int()
    .min(1)
    .describe("Line number (1-indexed)"),
  column: z.number()
    .int()
    .min(1)
    .describe("Column number (1-indexed)")
}).strict();

// Returns
{
  "contents": "```typescript\nfunction myFunction(a: string, b: number): Promise<Result>\n```\n\nDoes something useful with the inputs.",
  "range": {
    "start": { "line": 5, "column": 10 },
    "end": { "line": 5, "column": 20 }
  }
}
```

### 3.6 Tool: `lsp_signature_help`

**Purpose:** Get function/method signature information at a call site.

```typescript
const SignatureHelpSchema = z.object({
  file_path: z.string()
    .describe("Absolute path to the source file"),
  line: z.number()
    .int()
    .min(1)
    .describe("Line number (1-indexed)"),
  column: z.number()
    .int()
    .min(1)
    .describe("Column number (1-indexed, should be inside the parentheses)")
}).strict();

// Returns
{
  "signatures": [
    {
      "label": "myFunction(a: string, b: number): Promise<Result>",
      "documentation": "Does something useful with the inputs.",
      "parameters": [
        {
          "label": "a: string",
          "documentation": "The input string"
        },
        {
          "label": "b: number",
          "documentation": "The count"
        }
      ]
    }
  ],
  "active_signature": 0,
  "active_parameter": 1
}
```

### 3.7 Tool: `lsp_document_symbols`

**Purpose:** Get all symbols (functions, classes, variables) in a document.

```typescript
const DocumentSymbolsSchema = z.object({
  file_path: z.string()
    .describe("Absolute path to the source file")
}).strict();

// Returns hierarchical symbol tree (all positions 1-indexed)
{
  "symbols": [
    {
      "name": "MyClass",
      "kind": "Class",
      "range": {
        "start": { "line": 10, "column": 1 },
        "end": { "line": 50, "column": 2 }
      },
      "selection_range": {
        "start": { "line": 10, "column": 7 },
        "end": { "line": 10, "column": 14 }
      },
      "children": [
        {
          "name": "constructor",
          "kind": "Constructor",
          "range": {
            "start": { "line": 12, "column": 3 },
            "end": { "line": 15, "column": 4 }
          }
        },
        {
          "name": "myMethod",
          "kind": "Method",
          "range": {
            "start": { "line": 17, "column": 3 },
            "end": { "line": 25, "column": 4 }
          }
        }
      ]
    }
  ]
}
```

### 3.8 Tool: `lsp_workspace_symbols`

**Purpose:** Search for symbols across the entire workspace.

```typescript
const WorkspaceSymbolsSchema = z.object({
  query: z.string()
    .min(1)
    .describe("Search query to match symbol names (supports fuzzy matching)"),
  kinds: z.array(z.enum([
    "File", "Module", "Namespace", "Package", "Class", "Method", "Property",
    "Field", "Constructor", "Enum", "Interface", "Function", "Variable",
    "Constant", "String", "Number", "Boolean", "Array", "Object", "Key",
    "Null", "EnumMember", "Struct", "Event", "Operator", "TypeParameter"
  ]))
    .optional()
    .describe("Filter results to specific symbol kinds"),
  limit: z.number()
    .int()
    .min(1)
    .max(100)
    .default(50)
    .describe("Maximum number of results")
}).strict();

// Returns
{
  "symbols": [
    {
      "name": "processUserData",
      "kind": "Function",
      "path": "/path/to/utils.ts",
      "line": 45,
      "column": 1,
      "container_name": "UserModule"
    }
  ],
  "total_count": 23,
  "returned_count": 23,
  "has_more": false
}
```

### 3.9 Tool: `lsp_diagnostics`

**Purpose:** Get diagnostics (errors, warnings) for a file.

**Note:** Diagnostics are pushed by language servers, not requested. This tool returns cached diagnostics from `textDocument/publishDiagnostics` notifications. The file must be opened first (which happens automatically when using other tools on the file).

```typescript
const DiagnosticsSchema = z.object({
  file_path: z.string()
    .describe("Absolute path to the source file"),
  severity_filter: z.enum(["all", "error", "warning", "info", "hint"])
    .default("all")
    .describe("Filter diagnostics by minimum severity")
}).strict();

// Returns (all positions 1-indexed)
{
  "diagnostics": [
    {
      "range": {
        "start": { "line": 15, "column": 5 },
        "end": { "line": 15, "column": 20 }
      },
      "severity": "error",
      "code": "TS2322",
      "source": "typescript",
      "message": "Type 'string' is not assignable to type 'number'.",
      "context": "  const count: number = 'hello';"
    }
  ],
  "summary": {
    "errors": 2,
    "warnings": 5,
    "info": 1,
    "hints": 0
  },
  "note": "Diagnostics are cached from language server notifications. If file was recently modified, re-open it to refresh."
}
```

### 3.10 Tool: `lsp_completions`

**Purpose:** Get code completion suggestions at a position.

**Note:** This tool has limited utility for Claude Code since it requires exact cursor position in a partially-typed buffer. Most useful for exploring available methods/properties on an object.

```typescript
const CompletionsSchema = z.object({
  file_path: z.string()
    .describe("Absolute path to the source file"),
  line: z.number()
    .int()
    .min(1)
    .describe("Line number (1-indexed)"),
  column: z.number()
    .int()
    .min(1)
    .describe("Column number (1-indexed, position where completion is triggered)"),
  limit: z.number()
    .int()
    .min(1)
    .max(50)
    .default(20)
    .describe("Maximum number of suggestions")
}).strict();

// Returns
{
  "completions": [
    {
      "label": "addEventListener",
      "kind": "Method",
      "detail": "(type: string, listener: EventListener): void",
      "documentation": "Registers an event handler...",
      "insert_text": "addEventListener($1, $2)",
      "sort_text": "0000"
    }
  ],
  "is_incomplete": true
}
```

### 3.11 Tool: `lsp_rename`

**Purpose:** Rename a symbol across the workspace.

**Important:** This tool validates the rename first using `prepareRename`. By default it returns a preview of changes (`dry_run: true`). Set `dry_run: false` to apply the changes.

```typescript
const RenameSchema = z.object({
  file_path: z.string()
    .describe("Absolute path to the source file"),
  line: z.number()
    .int()
    .min(1)
    .describe("Line number (1-indexed)"),
  column: z.number()
    .int()
    .min(1)
    .describe("Column number (1-indexed)"),
  new_name: z.string()
    .min(1)
    .describe("New name for the symbol"),
  dry_run: z.boolean()
    .default(true)
    .describe("If true, only preview changes without applying. If false, apply changes to files.")
}).strict();

// Returns workspace edit (all positions 1-indexed)
{
  "changes": {
    "/path/to/file1.ts": [
      {
        "range": {
          "start": { "line": 10, "column": 5 },
          "end": { "line": 10, "column": 15 }
        },
        "new_text": "newFunctionName",
        "context": "function oldFunctionName() {"
      }
    ],
    "/path/to/file2.ts": [
      {
        "range": {
          "start": { "line": 25, "column": 10 },
          "end": { "line": 25, "column": 20 }
        },
        "new_text": "newFunctionName",
        "context": "  const result = oldFunctionName();"
      }
    ]
  },
  "files_affected": 2,
  "edits_count": 5,
  "applied": false,
  "original_name": "oldFunctionName"
}
```

### 3.12 Tool: `lsp_server_status`

**Purpose:** Check status of language servers.

```typescript
const ServerStatusSchema = z.object({
  server_id: z.string()
    .optional()
    .describe("Specific server ID to check, or omit for all servers")
}).strict();

// Returns
{
  "servers": [
    {
      "id": "typescript",
      "status": "running",
      "pid": 12345,
      "workspace_root": "/path/to/project",
      "capabilities": ["definition", "typeDefinition", "references", "implementation", "hover", "signatureHelp", "completion", "rename", "documentSymbol", "workspaceSymbol"],
      "uptime_seconds": 3600,
      "documents_open": 5,
      "restart_count": 0
    },
    {
      "id": "python",
      "status": "stopped",
      "last_error": null
    }
  ]
}
```

### 3.13 Tool: `lsp_start_server`

**Purpose:** Manually start a language server for a workspace.

```typescript
const StartServerSchema = z.object({
  server_id: z.string()
    .describe("Server ID from configuration (e.g., 'typescript', 'python')"),
  workspace_root: z.string()
    .describe("Absolute path to the workspace/project root")
}).strict();

// Returns
{
  "status": "started",
  "server_id": "typescript",
  "workspace_root": "/path/to/project",
  "capabilities": ["definition", "typeDefinition", "references", "implementation", "hover", "signatureHelp", "completion", "rename", "documentSymbol", "workspaceSymbol"]
}
```

### 3.14 Tool: `lsp_stop_server`

**Purpose:** Stop a running language server.

```typescript
const StopServerSchema = z.object({
  server_id: z.string()
    .describe("Server ID from configuration (e.g., 'typescript', 'python')"),
  workspace_root: z.string()
    .optional()
    .describe("Workspace root to stop server for. If omitted, stops all instances of this server type.")
}).strict();

// Returns
{
  "status": "stopped",
  "server_id": "typescript",
  "workspace_root": "/path/to/project",
  "was_running": true
}
```

---

## Phase 4: Error Handling Strategy

### 4.1 Error Categories

```typescript
enum LSPErrorCode {
  // Server lifecycle errors
  SERVER_NOT_FOUND = "SERVER_NOT_FOUND",           // Server binary not installed
  SERVER_START_FAILED = "SERVER_START_FAILED",    // Failed to spawn process
  SERVER_CRASHED = "SERVER_CRASHED",              // Process exited unexpectedly
  SERVER_TIMEOUT = "SERVER_TIMEOUT",              // Request timed out
  SERVER_NOT_READY = "SERVER_NOT_READY",          // Server still initializing

  // Request errors
  FILE_NOT_FOUND = "FILE_NOT_FOUND",              // File doesn't exist
  FILE_NOT_READABLE = "FILE_NOT_READABLE",        // Permission denied or binary file
  INVALID_POSITION = "INVALID_POSITION",          // Line/column out of range
  UNSUPPORTED_LANGUAGE = "UNSUPPORTED_LANGUAGE",  // No server for this file type
  CAPABILITY_NOT_SUPPORTED = "CAPABILITY_NOT_SUPPORTED", // Server doesn't support this
  RENAME_NOT_ALLOWED = "RENAME_NOT_ALLOWED",      // Cannot rename this symbol

  // Protocol errors
  INVALID_RESPONSE = "INVALID_RESPONSE",          // Malformed response from server
  REQUEST_CANCELLED = "REQUEST_CANCELLED"         // Request was cancelled
}
```

### 4.2 Error Response Format

```typescript
interface LSPError {
  code: LSPErrorCode;
  message: string;
  suggestion: string;
  details?: {
    server_id?: string;
    file_path?: string;
    position?: { line: number; column: number };
    install_command?: string;  // For SERVER_NOT_FOUND
  };
}

// Example error responses
{
  "error": {
    "code": "SERVER_NOT_FOUND",
    "message": "Language server 'typescript-language-server' not found in PATH",
    "suggestion": "Install it with: npm install -g typescript-language-server typescript",
    "details": {
      "server_id": "typescript",
      "install_command": "npm install -g typescript-language-server typescript"
    }
  }
}

{
  "error": {
    "code": "FILE_NOT_READABLE",
    "message": "Cannot read file: appears to be binary",
    "suggestion": "This tool only works with text source files.",
    "details": {
      "file_path": "/path/to/image.png"
    }
  }
}

{
  "error": {
    "code": "RENAME_NOT_ALLOWED",
    "message": "Cannot rename this symbol",
    "suggestion": "The language server does not allow renaming at this position. This might be a keyword, built-in, or imported from a read-only module.",
    "details": {
      "file_path": "/path/to/file.ts",
      "position": { "line": 10, "column": 5 }
    }
  }
}
```

### 4.3 Graceful Degradation

- **Server crash:** Automatic restart with exponential backoff (max 3 times within 5 minutes)
- **Capability not supported:** Return clear message indicating which capabilities are available
- **Timeout:** Cancel request, return partial results if available, suggest retrying
- **File not found:** Clear error with suggestion to check path
- **Binary file:** Detect via file extension blocklist and magic bytes, refuse early

### 4.4 Binary File Detection

Files with these extensions are automatically rejected:
- Images: `.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, `.ico`, `.svg`, `.webp`
- Archives: `.zip`, `.tar`, `.gz`, `.rar`, `.7z`
- Compiled: `.exe`, `.dll`, `.so`, `.dylib`, `.class`, `.pyc`, `.o`, `.a`
- Media: `.mp3`, `.mp4`, `.wav`, `.avi`, `.mov`
- Documents: `.pdf`, `.doc`, `.docx`, `.xls`, `.xlsx`
- Data: `.sqlite`, `.db`

Additionally, files are checked for null bytes in the first 8KB to detect other binary files.

---

## Phase 5: Performance Considerations

### 5.1 Lazy Initialization

- Don't start language servers until first request for that language
- Cache initialized clients for reuse (keyed by language + workspace root)
- Shutdown idle servers after configurable timeout (default: 30 minutes)

### 5.2 Request Management

- Implement request cancellation ($/cancelRequest) for abandoned requests
- Queue requests during server initialization
- Timeout after configurable duration (default: 30 seconds)

### 5.3 Response Truncation

- Limit large result sets (configurable, default: 100 references)
- Include pagination info: `total_count`, `returned_count`, `offset`, `has_more`
- Return results sorted by relevance/proximity when possible

### 5.4 Document Caching

- Cache file contents after first read
- Use monotonic version counters (never reuse versions)
- Invalidate cache only on explicit close or server restart
- Use per-URI mutex for concurrent access safety

### 5.5 Concurrency

- Use async/await throughout, no blocking operations
- Per-URI locks prevent race conditions on document operations
- Per-server locks prevent concurrent initialization

---

## Phase 6: Testing Strategy

### 6.1 Unit Tests

- Test position conversion (UTF-16 ↔ UTF-32) with emoji, combining characters, surrogate pairs
- Test workspace root detection with various project structures
- Test each tool handler with mocked LSP client
- Test connection manager routing logic
- Test document manager sync behavior with concurrent access
- Test diagnostics cache invalidation
- Test error handling paths

### 6.2 Integration Tests

- Test against real `typescript-language-server` with sample TypeScript project
- Test against real `pylsp` with sample Python project
- Test multi-language project scenarios
- Test server crash and recovery
- Test concurrent requests to same file
- Test concurrent requests to different files

### 6.3 Edge Case Tests

- Files with emoji in content (UTF-16 handling)
- Very long lines (10,000+ characters)
- Very large files (100,000+ lines)
- Files with mixed line endings
- Symlinked files and directories
- Files on network drives (slow I/O)
- Monorepo with multiple tsconfig.json files

### 6.4 MCP Inspector Testing

```bash
# Start server in debug mode
npx @modelcontextprotocol/inspector node dist/index.js

# Test tool calls interactively
```

---

## Phase 7: Claude Code Integration

### 7.1 MCP Configuration

Add to Claude Code's MCP config (`~/.config/claude-code/mcp.json` or `settings.json`):

```json
{
  "mcpServers": {
    "lsp": {
      "command": "node",
      "args": ["/path/to/lsp-mcp-server/dist/index.js"],
      "env": {
        "LSP_CONFIG_PATH": "/path/to/lsp-config.json",
        "LSP_LOG_LEVEL": "info"
      }
    }
  }
}
```

### 7.2 Expected Usage Patterns

Claude Code will use these tools when:

1. **Understanding code:** "What does this function do?" → `lsp_hover`, `lsp_goto_definition`
2. **Understanding types:** "What type is this variable?" → `lsp_goto_type_definition`
3. **Finding usage:** "Where is this function used?" → `lsp_find_references`
4. **Finding implementations:** "What classes implement this interface?" → `lsp_find_implementations`
5. **Navigating:** "Show me the class definition" → `lsp_goto_definition`
6. **Refactoring:** "Rename this variable" → `lsp_rename`
7. **Debugging:** "What errors are in this file?" → `lsp_diagnostics`
8. **Exploring:** "What functions are in this file?" → `lsp_document_symbols`
9. **Searching:** "Find all auth-related functions" → `lsp_workspace_symbols`
10. **Understanding function calls:** "What parameters does this function take?" → `lsp_signature_help`

---

## Implementation Checklist

### Phase 1: Setup (Day 1)
- [ ] Initialize npm project with TypeScript
- [ ] Set up tsconfig.json with strict mode
- [ ] Install dependencies
- [ ] Create directory structure
- [ ] Define TypeScript interfaces in types.ts
- [ ] Create constants.ts with defaults
- [ ] Set up ESLint and Vitest

### Phase 2: Core Utilities (Day 2)
- [ ] Implement UTF-16 position conversion utilities
- [ ] Implement workspace root detection
- [ ] Implement file URI utilities with symlink handling
- [ ] Implement binary file detection
- [ ] Write unit tests for utilities

### Phase 3: LSP Client (Days 3-4)
- [ ] Implement JSON-RPC message handling
- [ ] Implement LSP client initialization handshake
- [ ] Implement capability negotiation (including positionEncodings)
- [ ] Implement document sync methods
- [ ] Implement language feature requests
- [ ] Implement request cancellation
- [ ] Implement diagnostics notification handler
- [ ] Add timeout handling
- [ ] Test with typescript-language-server

### Phase 4: Connection Manager (Day 5)
- [ ] Implement server spawning with proper stdio setup
- [ ] Implement language/extension routing
- [ ] Implement workspace root detection integration
- [ ] Implement multi-instance support (language + root keying)
- [ ] Implement server lifecycle management
- [ ] Implement crash recovery with exponential backoff
- [ ] Implement idle server shutdown
- [ ] Test multi-language scenarios
- [ ] Test monorepo scenarios

### Phase 5: Document & Diagnostics Managers (Day 6)
- [ ] Implement file reading with encoding detection
- [ ] Implement didOpen/didChange/didClose
- [ ] Implement content caching
- [ ] Implement monotonic version tracking
- [ ] Implement per-URI locking
- [ ] Implement diagnostics cache
- [ ] Test with various file types
- [ ] Test concurrent access

### Phase 6: MCP Server & Tools (Days 7-9)
- [ ] Set up MCP server with stdio transport
- [ ] Implement lsp_goto_definition
- [ ] Implement lsp_goto_type_definition
- [ ] Implement lsp_find_references (with pagination)
- [ ] Implement lsp_find_implementations
- [ ] Implement lsp_hover
- [ ] Implement lsp_signature_help
- [ ] Implement lsp_document_symbols
- [ ] Implement lsp_workspace_symbols (with kind filter)
- [ ] Implement lsp_diagnostics
- [ ] Implement lsp_completions
- [ ] Implement lsp_rename (with prepareRename and dry_run)
- [ ] Implement lsp_server_status
- [ ] Implement lsp_start_server
- [ ] Implement lsp_stop_server

### Phase 7: Error Handling & Polish (Day 10)
- [ ] Add comprehensive error handling for all error categories
- [ ] Add structured logging
- [ ] Add configuration file support with validation
- [ ] Write README documentation

### Phase 8: Testing & Integration (Days 11-12)
- [ ] Test with MCP Inspector
- [ ] Integration test with Claude Code
- [ ] Test UTF-16 edge cases (emoji, surrogate pairs)
- [ ] Test large files and long lines
- [ ] Performance testing
- [ ] Create evaluation questions

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Language server not installed | Provide clear error message with installation instructions |
| Server crash during request | Automatic restart with exponential backoff, request retry |
| Large codebase slow responses | Pagination, timeouts, partial results |
| Different LSP versions | Test against common servers, capability negotiation |
| Memory leaks from idle servers | Automatic shutdown after idle timeout |
| UTF-16 position bugs | Comprehensive unit tests with edge cases |
| Monorepo confusion | Explicit workspace root detection and multi-instance support |
| Race conditions | Per-URI and per-server locks |
| Binary files | Extension blocklist + magic byte detection |

---

## Future Enhancements

1. **File watching:** React to file system changes (invalidate caches, refresh diagnostics)
2. **Semantic tokens:** Syntax highlighting information
3. **Code actions:** Quick fixes and refactoring suggestions
4. **Call hierarchy:** Incoming/outgoing call trees
5. **Type hierarchy:** Class inheritance visualization
6. **Folding ranges:** Code folding information
7. **Formatting:** Code formatting support
8. **Selection range:** Smart selection expansion
9. **Linked editing ranges:** Synchronized editing (e.g., HTML tag pairs)
10. **Inlay hints:** Inline type annotations

---

## Resources

- [LSP Specification 3.17](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [vscode-languageserver-node](https://github.com/microsoft/vscode-languageserver-node)
- [typescript-language-server](https://github.com/typescript-language-server/typescript-language-server)
- [python-lsp-server](https://github.com/python-lsp/python-lsp-server)
- [rust-analyzer](https://rust-analyzer.github.io/)
- [gopls](https://pkg.go.dev/golang.org/x/tools/gopls)
