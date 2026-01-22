# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**lsp-mcp-server** is an MCP (Model Context Protocol) server that bridges Claude Code to Language Server Protocol (LSP) servers. It enables semantic code intelligence capabilities like go-to-definition, find-references, hover information, workspace symbol search, diagnostics, completion, and rename.

**Current State:** Fully implemented. The project contains a working MCP server with all 14 tools.

## Build Commands

```bash
npm run build        # Compile TypeScript to dist/
npm run dev          # Watch mode for development
npm start            # Run the compiled server (node dist/index.js)
npm test             # Run unit tests (vitest)
npm run test:integration  # Run integration tests
npm run lint         # Run ESLint
npm run typecheck    # Type-check without emitting
```

## Testing

```bash
# Interactive tool testing with MCP Inspector
npx @modelcontextprotocol/inspector node dist/index.js
```

## Architecture

```
Claude Code ──[MCP/stdio]──> lsp-mcp-server ──[LSP/stdio]──> Language Servers
                                   │
                                   ├── Connection Manager (keyed by language + workspace root)
                                   ├── Document Manager (per-URI versioning, concurrent access)
                                   ├── Diagnostics Cache (stores pushed diagnostics)
                                   └── Tool Handlers (14 MCP tools)
```

### Key Architecture Decisions

- **Multi-root workspace support:** Server instances keyed by `(languageId, workspaceRoot)` pairs for monorepo support
- **Diagnostics are push-based:** Cached from `publishDiagnostics` notifications, not requested on-demand
- **1-indexed positions:** All tool inputs/outputs use 1-indexed line/column for human readability
- **UTF-16 handling:** Proper conversion for emoji and non-BMP characters via position encoding negotiation

### Source Structure

```
src/
├── index.ts                    # MCP server entry point with tool registration
├── types.ts                    # TypeScript interfaces and error types
├── constants.ts                # Configuration defaults, symbol kinds, severities
├── config.ts                   # Configuration loading and defaults
├── utils/
│   ├── position.ts             # UTF-16 <-> UTF-32 position conversion
│   ├── uri.ts                  # File path <-> URI conversion
│   ├── workspace.ts            # Workspace root detection
│   └── logger.ts               # Logging utilities
├── tools/                      # MCP tool implementations (14 tools)
│   ├── definition.ts           # lsp_goto_definition, lsp_goto_type_definition
│   ├── references.ts           # lsp_find_references, lsp_find_implementations
│   ├── hover.ts                # lsp_hover, lsp_signature_help
│   ├── symbols.ts              # lsp_document_symbols, lsp_workspace_symbols
│   ├── diagnostics.ts          # lsp_diagnostics
│   ├── completion.ts           # lsp_completions
│   ├── rename.ts               # lsp_rename
│   ├── server.ts               # lsp_server_status, lsp_start_server, lsp_stop_server
│   ├── utils.ts                # Shared tool utilities
│   ├── context.ts              # Tool context (shared services)
│   └── index.ts                # Tool exports
├── services/
│   ├── lsp-client.ts           # LSP client wrapper (JSON-RPC, initialization)
│   ├── connection-manager.ts   # Multi-instance pool, routing by language + root
│   ├── document-manager.ts     # didOpen/didChange/didClose, content caching
│   ├── diagnostics-cache.ts    # Stores pushed diagnostics
│   ├── language-detector.ts    # File extension to language server mapping
│   └── index.ts                # Service exports
└── schemas/
    └── tool-schemas.ts         # Zod validation schemas for all tools
```

### MCP Tools (14 total)

| Tool | Purpose |
|------|---------|
| `lsp_goto_definition` | Navigate to symbol definition |
| `lsp_goto_type_definition` | Navigate to type definition of a symbol |
| `lsp_find_references` | Find all symbol references (with pagination) |
| `lsp_find_implementations` | Find implementations of interface/abstract method |
| `lsp_hover` | Get type info and documentation |
| `lsp_signature_help` | Get function signature at call site |
| `lsp_document_symbols` | Get symbols in a file |
| `lsp_workspace_symbols` | Search symbols across workspace (with kind filter) |
| `lsp_diagnostics` | Get cached errors/warnings |
| `lsp_completions` | Get code completion suggestions |
| `lsp_rename` | Rename symbol (with dry_run preview mode) |
| `lsp_server_status` | Check language server status |
| `lsp_start_server` | Manually start a server |
| `lsp_stop_server` | Stop a running server |

### Default Language Server Support

- TypeScript/JavaScript: `typescript-language-server --stdio`
- Python: `pylsp`
- Rust: `rust-analyzer`
- Go: `gopls serve`

## Key Dependencies

- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `vscode-languageserver-protocol` - LSP protocol types
- `vscode-jsonrpc` - JSON-RPC messaging (used directly, not vscode-languageclient)
- `zod` - Runtime schema validation
- `vitest` - Testing framework

## Configuration

Configuration via JSON file (path in `LSP_CONFIG_PATH` env var). Key settings:
- Per-server: command, args, file extensions, language IDs, root patterns
- Global: `requestTimeout` (30s), `autoStart` (true), `logLevel`, `idleTimeout` (30min)

Workspace root is auto-detected by walking up from file path looking for root markers (`package.json`, `tsconfig.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `.git`). Override with `LSP_WORKSPACE_ROOT` env var.

## Error Handling

- Binary files rejected via extension blocklist + null byte detection
- Server crashes trigger automatic restart with exponential backoff (max 3 retries)
- Errors include installation commands for missing language servers
- `prepareRename` validation before rename attempts
