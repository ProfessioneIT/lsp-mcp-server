# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**lsp-mcp-server** is an MCP (Model Context Protocol) server that bridges Claude Code to Language Server Protocol (LSP) servers. It exposes 29 `lsp_*` tools (definition, references, hover, symbols, diagnostics, completion, rename, code actions, call/type hierarchy, formatting, highlights, inlay hints, selection/folding ranges, batch indexing, and server management). Built-in server configs cover TypeScript/JS, Python, Rust, Go, C/C++, Ruby, PHP, Elixir, Kotlin, and Java.

## Commands

```bash
npm run build          # Compile TypeScript (src/ -> dist/)
npm run dev            # tsc --watch
npm test               # Unit tests (vitest, tests/unit/**/*.test.ts)
npm run test:watch
npm run typecheck      # tsc --noEmit
npm run lint           # ESLint on src/ only
npm run lint:fix
npm run clean          # rm -rf dist

npm test -- tests/unit/position.test.ts   # Single test file
npm test -- -t "converts 1-indexed"       # Tests matching a name

npx @modelcontextprotocol/inspector node dist/index.js   # Interactive MCP testing
```

`npm run test:integration` points at `vitest.integration.config.ts`, which does not exist yet, and `tests/integration/` is empty.

## Release

Every push to `main` triggers `.forgejo/workflows/publish.yml`: `npm test`, `npm run typecheck`, `npm run build`, then an automatic patch bump, a `vX.Y.Z` tag, a `chore: bump version ... [skip ci]` commit, and `npm publish`. Do not bump the version manually. Lint is not run in CI, so run it locally.

## Architecture

```
Claude Code ──[MCP/stdio]──> lsp-mcp-server ──[LSP/stdio]──> Language Servers
                                   │
                                   ├── ConnectionManager (one client per serverId + workspaceRoot)
                                   ├── DocumentManager (per-URI versioning, open/close)
                                   ├── DiagnosticsCache (stores pushed publishDiagnostics)
                                   └── Tool handlers (src/tools/*.ts)
```

- **Interfaces vs implementations**: `src/types.ts` defines `LSPClient`, `ConnectionManager`, `DocumentManager`, `DiagnosticsCache`, `Config`, and `LSPError`. Concrete classes live in `src/services/`. Tool handlers depend only on the interfaces.
- **Global tool context**: `src/index.ts` builds the services and calls `setToolContext()`. Handlers read them via `getToolContext()` from `src/tools/context.ts`.
- **Server keying**: clients are keyed by `createServerKey(serverId, workspaceRoot)` (`src/utils/workspace.ts`), so monorepo sub-projects get their own server instance. Concurrent first requests share one init promise via `initLocks`.
- **Diagnostics are push-based**: they arrive as `publishDiagnostics` notifications and are cached. A file must be opened (any tool taking `file_path`, or `lsp_index_files`) before diagnostics exist for it. `lsp_workspace_diagnostics` only sees opened files.
- **Positions**: tool inputs/outputs are 1-indexed line/column. `src/utils/position.ts` converts to LSP's 0-indexed UTF-16 code units.
- **Lifecycle**: servers auto-start on first use (`autoStart`), crashed servers restart with exponential backoff (max 3 attempts in 5 minutes), idle servers stop after `idleTimeout` (default 30 min). `shutdownAll()` runs on SIGINT/SIGTERM.

### Request flow

1. `CallToolRequestSchema` handler in `src/index.ts` looks up the tool in `toolHandlers` and calls `XxxSchema.parse(input)` then the handler.
2. Most handlers call `prepareFile(filePath)` (`src/tools/utils.ts`), which resolves the server by file extension, detects the workspace root, gets or starts the client, calls `documentManager.ensureOpen()`, and returns `{ client, uri, content }`.
3. The handler sends the LSP request, converts positions back to 1-indexed, and returns a plain object. `index.ts` serializes every result and error with `serializeToolResult()` (`src/utils/json.ts`), which honors the `minify` config option. Don't call `JSON.stringify` directly for tool output.
4. Handlers should just throw. `index.ts` maps anything with `toJSON` (an `LSPError`) to its structured error, Zod errors to `INVALID_INPUT`, and everything else to a generic error, all with `isError: true`.

`src/index.ts` still uses the deprecated low-level `Server` class from the MCP SDK. There is a TODO to migrate to `McpServer` / `registerTool()`.

### Adding a tool

1. Add a Zod schema to `src/schemas/tool-schemas.ts`.
2. Implement the handler in `src/tools/*.ts` and re-export it from `src/tools/index.ts`.
3. Add an entry to the `TOOLS` array in `src/index.ts`. Its `inputSchema` is **hand-written JSON Schema**, not generated from Zod, so keep the two in sync manually. Include `annotations` (`readOnlyHint`, etc.) like the existing entries.
4. Add the handler to the `toolHandlers` map in `src/index.ts`.
5. Update user-facing docs: the tool reference in `README.md`, and `SKILL.md` (tool count and decision tree). Update the MCP `instructions` string in `src/index.ts` if the tool changes how clients should navigate.

### Adding a language

Add an entry to `DEFAULT_SERVERS` and an install hint to `INSTALL_COMMANDS` in `src/constants.ts`. `rootPatterns` on the server entry drive workspace-root detection for that language.

## Gotchas

- **Never import from `vscode-jsonrpc` directly.** `createMessageConnection`, `StreamMessageReader`, etc. must come from `vscode-languageserver-protocol/node`, and there is deliberately no direct `vscode-jsonrpc` dependency. Two copies of vscode-jsonrpc break `initialize` with "Unknown parameter structure byName". `tests/unit/jsonrpc-init.test.ts` guards this.
- **Open documents are tracked per client instance**, not per server id (`DocumentManagerImpl` keys by the client object). Several instances of one server can run for different roots, and a restarted server is a new client that must receive `didOpen` again.
- **Waiting for server work**: the client advertises `window.workDoneProgress` and tracks progress tokens. `prepareFile()` calls `client.waitForServerWork()` after opening a document for the first time in an instance: it waits `SERVER_WORK_SETTLE_MS` for the server to start work (e.g. TypeScript project loading) and then until that work ends, capped at `SERVER_WORK_MAX_WAIT_MS`. Without it, cross-file results right after an open are silently partial.
- **Startup failures**: `initialize` uses the request timeout and fails as soon as the server process exits. A server that timed out during initialize is not retried by `ConnectionManager` (each retry would wait the full timeout again); crashes on start still are.
- **Applying server edits**: use `collectTextEdits()` from `src/utils/workspace-edit.ts`, which reads both `changes` and `documentChanges` and counts file operations. Refuse to apply edits that need file operations rather than applying part of them.
- **Deleted files**: `forgetDeletedFiles()` in `src/tools/utils.ts` closes them, notifies servers via `didDeleteFiles`, and clears cached diagnostics. `prepareFile()` throws `FILE_NOT_FOUND` for missing files instead of answering from stale content.
- **`Diagnostic.message` can be `string | MarkupContent`** since LSP types 3.18. Use `getDiagnosticMessageText()` from `src/tools/utils.ts`.
- **Workspace root resolution** (`findWorkspaceRootForLanguage` in `src/utils/workspace.ts`): the server's `rootPatterns` are tried in priority order, and for the first pattern found the *nearest* ancestor directory containing it wins. Only if none match does it fall back to `LSP_WORKSPACE_ROOT`, then the *outermost* directory containing a `DEFAULT_ROOT_MARKERS` entry, then the file's own directory. So `LSP_WORKSPACE_ROOT` does not override a matching `rootPatterns` hit.
- **`LSP_CONFIG_PATH` is defined in `ENV` but `src/config.ts` never reads it**, so it is not documented in the README. Config is loaded from the first of `./.lsp-mcp.json`, `./lsp-mcp.json`, `$XDG_CONFIG_HOME/lsp-mcp/config.json`, `~/.lsp-mcp.json`. User `servers` override built-ins with the same `id`. `minify` accepts `"default"` (no whitespace) or `"full"` (also drops `null` properties). Any other value leaves output pretty-printed. `LSP_LOG_LEVEL` and `LSP_REQUEST_TIMEOUT` override the file (legacy `LSP_MCP_*` names still work).

## TypeScript & Module Conventions

- **ESM-only** (`"type": "module"`, `NodeNext`). All relative imports use `.js` extensions, even for `.ts` sources.
- **`noUncheckedIndexedAccess`**: indexed access returns `T | undefined`.
- **`exactOptionalPropertyTypes`**: a property declared `foo?: T` cannot be assigned `undefined`. Omit it, or declare it `foo?: T | undefined`.
- **Unused variables/args/caught errors**: prefix with `_` (ESLint).
- **Tests**: unit tests in `tests/unit/`. Vitest has `globals: true`, but existing tests import `describe`/`it`/`expect` from `vitest` explicitly. `tsconfig.json` excludes `tests/`, so `npm run typecheck` does not type-check tests.

## Security Invariants

- All tool file paths must be absolute (enforced in the Zod schemas).
- File-modifying tools (rename, format, code actions with `apply`) must call `validatePathWithinWorkspace()` from `src/utils/uri.ts` before writing.
- Files over `MAX_FILE_SIZE_BYTES` (10 MB) are rejected. Binary files are rejected by extension blocklist plus null-byte sniffing in `src/utils/uri.ts`.
- Language servers are spawned with `shell: false`.
