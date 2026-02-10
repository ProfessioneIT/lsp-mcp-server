# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**lsp-mcp-server** is an MCP (Model Context Protocol) server that bridges Claude Code to Language Server Protocol (LSP) servers. It enables semantic code intelligence capabilities like go-to-definition, find-references, hover information, workspace symbol search, diagnostics, completion, rename, code actions, call/type hierarchy, and document formatting.

## Build Commands

```bash
npm run build          # Compile TypeScript to dist/
npm run dev            # Watch mode for development
npm start              # Run the compiled server (node dist/index.js)
npm test               # Run unit tests (vitest)
npm run test:watch     # Watch mode for tests
npm run test:integration  # Run integration tests (separate vitest config)
npm run lint           # Run ESLint
npm run lint:fix       # Auto-fix ESLint issues
npm run typecheck      # Type-check without emitting
npm run clean          # Remove dist/
```

### Running a Single Test

```bash
npm test -- tests/unit/position.test.ts           # Run specific test file
npm test -- -t "converts 1-indexed"               # Run tests matching pattern
```

### Interactive Testing with MCP Inspector

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## Architecture

```
Claude Code ──[MCP/stdio]──> lsp-mcp-server ──[LSP/stdio]──> Language Servers
                                   │
                                   ├── ConnectionManager (keyed by serverId + workspaceRoot)
                                   ├── DocumentManager (per-URI versioning, thread-safe open/close)
                                   ├── DiagnosticsCache (stores pushed publishDiagnostics)
                                   └── Tool Handlers (24 MCP tools)
```

### Key Design Decisions

1. **Server Instance Keying**: Servers are keyed by `(serverId, workspaceRoot)` pairs via `createServerKey()` in `src/utils/workspace.ts`. This enables proper monorepo support where each workspace can have its own language server instance.

2. **Diagnostics are Push-Based**: Unlike request-based LSP features, diagnostics come from `publishDiagnostics` notifications. The `LSPClientImpl` caches these internally, and `DiagnosticsCache` provides a global cache. Always open a document first to trigger diagnostics.

3. **1-Indexed Positions**: All tool inputs/outputs use 1-indexed line/column for human readability. The `toLspPosition()` and `fromLspPosition()` functions in `src/utils/position.ts` handle conversion to LSP's 0-indexed format.

4. **UTF-16 Position Handling**: LSP uses UTF-16 code units for character positions (relevant for emoji and non-BMP characters). Position utilities handle this conversion.

5. **Global Tool Context**: Tool handlers access shared services (ConnectionManager, DocumentManager, DiagnosticsCache, Config) via the global `ToolContext` set in `src/tools/context.ts`. This is initialized in `src/index.ts` before server startup.

6. **Interface/Implementation Separation**: `src/types.ts` defines interfaces (`LSPClient`, `ConnectionManager`, `DocumentManager`, `DiagnosticsCache`), while `src/services/` contains the concrete implementations (`LSPClientImpl`, `ConnectionManagerImpl`, `DocumentManagerImpl`, `DiagnosticsCacheImpl`). Tool handlers only depend on interfaces.

### Data Flow for a Typical Tool Call

1. MCP request arrives at `src/index.ts` via `CallToolRequestSchema` handler
2. Input validated with Zod schema from `src/schemas/tool-schemas.ts`
3. Tool handler in `src/tools/` uses `getToolContext()` to access services
4. Most handlers call `prepareFile(filePath)` from `src/tools/utils.ts`, which:
   - Validates the path and converts to URI
   - Calls `connectionManager.getClientForFile(filePath)` to get/create an LSP client
   - Calls `documentManager.ensureOpen(uri, client)` to open the file
   - Returns `{ client, uri }` ready for LSP requests
5. Tool sends LSP request via client, converts response positions, returns JSON

**Note:** `src/index.ts` currently uses the deprecated `Server` class from MCP SDK. There is a TODO to migrate to the `McpServer` high-level API (`registerTool()` pattern).

### Adding a New Tool

1. Add Zod schema to `src/schemas/tool-schemas.ts`
2. Create handler function in appropriate `src/tools/*.ts` file
3. Export handler from `src/tools/index.ts`
4. Add tool definition to `TOOLS` array in `src/index.ts`
5. Add handler to `toolHandlers` map in `src/index.ts`

### Server Lifecycle

- Servers auto-start on first request when `autoStart: true` (default)
- Crashed servers restart with exponential backoff (max 3 attempts in 5 minutes)
- Idle servers stop after `idleTimeout` (default 30 minutes)
- Per-server `requestTimeout` can override the global default
- `ConnectionManager.shutdownAll()` called on SIGINT/SIGTERM

## TypeScript & Module Conventions

- **ESM-only**: The project uses `"type": "module"` with `NodeNext` module resolution. **All imports must use `.js` extensions** (e.g., `import { foo } from './bar.js'`), even when importing `.ts` files.
- **Strict TypeScript**: `noUncheckedIndexedAccess` is enabled (indexed access returns `T | undefined`), `exactOptionalPropertyTypes` is enabled (must use `undefined` explicitly for optional properties, not just omit them).
- **Unused variables**: Prefix with `_` (enforced by ESLint rule `argsIgnorePattern: "^_"`).
- **Vitest globals**: Tests use `globals: true` — no need to import `describe`, `it`, `expect`.
- **Unit tests** go in `tests/unit/`, integration tests have a separate `vitest.integration.config.ts`.

## Security

The following security measures are enforced:

- **Absolute Path Validation**: All file paths must be absolute (validated in `src/schemas/tool-schemas.ts`)
- **Workspace Boundary Validation**: File modifications (rename, format, code actions) use `validatePathWithinWorkspace()` in `src/utils/uri.ts` to prevent writing outside the workspace root
- **File Size Limits**: Files larger than `MAX_FILE_SIZE_BYTES` (10 MB, defined in `src/constants.ts`) are rejected to prevent memory exhaustion
- **No Shell Execution**: Language servers are spawned with `shell: false` to prevent command injection

## Configuration

Configuration via JSON file (path in `LSP_CONFIG_PATH` env var). See `src/config.ts` for loading logic and `src/constants.ts` for defaults.

Workspace root auto-detected by walking up from file path looking for root markers (`package.json`, `tsconfig.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `.git`). Override with `LSP_WORKSPACE_ROOT` env var.

## Error Handling

Custom `LSPError` class in `src/types.ts` provides structured errors with:
- Error code (enum `LSPErrorCode`)
- Human-readable message
- Actionable suggestion
- Optional details (server_id, file_path, install_command)

Tool handlers catch and convert errors to this format. Binary files are rejected via extension blocklist + null byte detection in `src/utils/uri.ts`.
