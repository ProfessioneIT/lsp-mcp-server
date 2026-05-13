---
name: lsp-mcp-server
description: Use whenever code navigation, analysis, refactoring, or diagnostics are needed on a project that has a Language Server Protocol implementation. Covers all 29 lsp_* MCP tools exposed by lsp-mcp-server (TypeScript, Python, Rust, Go, C/C++, Ruby, PHP, Elixir, Kotlin, Java, and any user-configured language). Use it instead of grep/find/Read for ANY task that touches definitions, references, types, hover docs, completions, diagnostics, rename, code actions, call/type hierarchy, document/workspace symbols, document highlights, inlay hints, selection ranges, folding ranges, or batch file indexing.
---

# lsp-mcp-server — How to use it well

This MCP server exposes a Language Server (LSP) to you as 29 tools. LSP servers maintain a real semantic model of the codebase: they know that `User` in file A is the same class imported under an alias in file B, that `db.query` returns `Promise<Row[]>`, and that renaming a private method touches 17 call sites in 9 files. **Plain text search cannot give you any of that.**

## Hard rules

1. **Prefer LSP tools over text search for anything code-shaped.** Function/class/variable definitions, usages, types, imports, errors — always LSP, never `grep`/`Glob`/`Read`-and-scan.
2. **Plain text search is still right** for strings, comments, config files, docs, log lines, and matching across non-code files.
3. **All file paths must be absolute.** Relative paths are rejected by Zod validation.
4. **All line / column numbers are 1-indexed** (what an editor shows). Internal conversion to LSP 0-indexed happens for you.
5. **First-touch wakes the server.** Auto-start is on by default — you do not need `lsp_start_server`. The first tool call that takes a `file_path` will spawn the right language server and open the file. There is no need to ping `lsp_server_status` before each call.
6. **Position points at the symbol, not whitespace.** When you pass `line`/`column`, point at any character of the identifier itself. Pointing at a space, the `(` after a function name, or a comma will give empty or surprising results.

## Decision tree: pick the right tool

```
I know a name but not where it lives           → lsp_find_symbol          (preferred)
                                               → lsp_workspace_symbols    (when you want many matches)

I have a symbol at a position and want…
   …its definition                             → lsp_goto_definition
   …its TYPE definition (interface of a var)   → lsp_goto_type_definition
   …all usages                                 → lsp_find_references
   …concrete implementations of interface      → lsp_find_implementations
   …type / docs                                → lsp_hover
   …function parameter hints inside a call     → lsp_signature_help
   …who calls it / what it calls               → lsp_call_hierarchy
   …parents/children of a class                → lsp_type_hierarchy
   …EVERYTHING in one call                     → lsp_smart_search

I want to understand a file
   …structure / outline                        → lsp_document_symbols
   …public API only                            → lsp_file_exports
   …its imports                                → lsp_file_imports
   …who depends on it                          → lsp_related_files (with caveat — see below)
   …foldable structure (functions/blocks)      → lsp_folding_ranges

I have a position and want…
   …every occurrence in THIS file              → lsp_document_highlights   (cheaper than find_references for local edits)
   …inferred types / parameter names           → lsp_inlay_hints           (use on a small range)
   …semantic enclosing ranges (stmt/block/fn)  → lsp_selection_range       (great input to lsp_code_actions)

I want to act on the code
   …rename a symbol everywhere                 → lsp_rename             (dry_run first!)
   …apply quick-fixes / refactors              → lsp_code_actions
   …format the file                            → lsp_format_document
   …see completion at cursor                   → lsp_completions

I want errors / warnings
   …for one file                               → lsp_diagnostics
   …across many files                          → lsp_index_files [files], then lsp_workspace_diagnostics
```

## Canonical workflows

### A. "Find the definition of foo"
Do not grep. Do not Read the file. One call:

```json
{ "tool": "lsp_find_symbol",
  "input": { "name": "foo", "include": ["definition","hover"] } }
```

If `foo` is ambiguous (many matches), narrow by `kind: "Function" | "Class" | "Interface" | ...`. Result includes the resolved path, line, column, and signature.

**If you already know the file** but not the position, scope the search to that file — it is faster and avoids cross-file noise:

```json
{ "tool": "lsp_find_symbol",
  "input": { "name": "foo", "file_path": "/abs/path/file.ts", "include": ["definition","hover"] } }
```

### B. "Where is X used?"

If you already have a position (you just read it, or `lsp_find_symbol` returned one):

```json
{ "tool": "lsp_find_references",
  "input": { "file_path": "/abs/path/file.ts", "line": 42, "column": 10, "limit": 100 } }
```

If you don't know the position, chain via `lsp_find_symbol` with `include: ["definition","references"]` — one call, both answers.

### C. "Will renaming X break anything?"
**Always dry_run first.** Default is `dry_run: true`, do not override unless the diff looks right.

```json
{ "tool": "lsp_rename",
  "input": { "file_path": "...", "line": ..., "column": ..., "new_name": "...", "dry_run": true } }
```

Read the returned `changes` map. If correct, call again with `dry_run: false`.

### D. "Did my edit break anything?"
Diagnostics are **push-based**. The server emits them after a file is opened or changed. To get them:

1. Touch the file with any LSP tool that takes `file_path` (this opens it).
2. Call `lsp_diagnostics` on that file.

If you just wrote to the file via the regular `Edit` tool, the server still has the **old** content cached. Re-touching it with `lsp_diagnostics` is enough to trigger re-analysis in most servers, but for tightly-coupled type errors a brief moment may be required.

**For a project-wide scan**, warm up the relevant files first:

```json
{ "tool": "lsp_index_files",
  "input": { "files": ["/abs/a.ts", "/abs/b.ts", "/abs/c.ts"] } }
```

Then call `lsp_workspace_diagnostics`. Without the warm-up the workspace view is empty — it only sees opened files.

### E. "What does this file expose?"
For a quick public-API view, prefer `lsp_file_exports` over reading the whole file:

```json
{ "tool": "lsp_file_exports",
  "input": { "file_path": "/abs/file.ts", "include_signatures": true } }
```

This returns top-level symbols with their first-line signatures.

### F. "Give me the full picture of this symbol"
When you need definition + hover + references + call hierarchy together, do not chain three calls — use `lsp_smart_search`:

```json
{ "tool": "lsp_smart_search",
  "input": {
    "file_path": "...", "line": ..., "column": ...,
    "include": ["hover","definition","references","implementations","incoming_calls"],
    "references_limit": 20
  } }
```

It is more efficient than four sequential calls and handles partial failures gracefully.

### G. "Apply a quick fix to the error on line 15"
```json
{ "tool": "lsp_code_actions",
  "input": { "file_path": "...", "start_line": 15, "start_column": 1, "kinds": ["quickfix"] } }
```

Read the returned `actions[]`, pick the right index, then call again with `apply: true, action_index: N`. Common `kinds`: `quickfix`, `refactor.extract`, `source.organizeImports`, `source.fixAll`.

### H. "Extract this expression to a variable / function"
If you don't know the exact range, use `lsp_selection_range` first to get the chain of enclosing semantic ranges, pick the one matching your intent (just the expression vs the whole statement), then feed those bounds into `lsp_code_actions` with `kinds: ["refactor.extract"]`.

### I. "Show me the types in this function"
For inferred types and parameter-name hints across a region:

```json
{ "tool": "lsp_inlay_hints",
  "input": { "file_path": "...", "start_line": 10, "start_column": 1, "end_line": 80, "end_column": 1 } }
```

Returns `{ line, column, label, kind }` per hint. Keep the range tight — querying a whole 5,000-line file can return hundreds of hints.

### J. "Quick local read/write analysis"
For "where is this variable touched in this file, and is each touch a read or a write?":

```json
{ "tool": "lsp_document_highlights",
  "input": { "file_path": "...", "line": 42, "column": 10 } }
```

Each highlight has `kind: "read" | "write" | "text"`. Faster and more focused than `lsp_find_references` when you only care about the current file.

## Gotchas — read before you use these tools

1. **`lsp_workspace_diagnostics` only reflects opened files.**
   It does NOT scan unopened files. Use `lsp_index_files(files=[...])` to open a targeted batch first, then call `lsp_workspace_diagnostics`. If results look empty, suspect a missing warm-up step before suspecting "no errors".

2. **`lsp_related_files` `imported_by` only sees files already opened this session.**
   It is regex-based and limited to JS/TS-shaped import syntax. For other languages or for "everything that imports X", do `lsp_find_references` on the export instead — that uses the real LSP index and is language-correct. (Or `lsp_index_files` the candidate set first.)

3. **`lsp_file_imports` is regex-based, JS/TS-flavored.**
   It recognises `import …`, dynamic `import('…')`, and `require('…')`. It will not catch Python/Go/Rust import idioms accurately. For non-JS languages, `lsp_document_symbols` plus your own knowledge of the language is more reliable.

4. **`lsp_call_hierarchy` / `lsp_type_hierarchy` need a callable / class-like position.**
   Pointing at a variable will throw `CAPABILITY_NOT_SUPPORTED`. Point at the function name itself, or use `lsp_smart_search` which fails silently.

5. **`lsp_workspace_symbols` quality varies by language server.**
   `typescript-language-server` requires at least 1-2 characters and supports fuzzy matching well. `gopls` and `clangd` are more exact-match oriented. If a search returns nothing, try a longer / shorter query, then fall back to `lsp_document_symbols` on a likely file.

6. **Symbol kind names are LSP-standard, capitalised.**
   `Class`, `Function`, `Method`, `Interface`, `Variable`, `Property`, `Field`, `Enum`, `EnumMember`, `Constructor`, `Constant`, `Module`, `Namespace`, `Struct`, `TypeParameter`. Lowercase will silently match nothing.

7. **You usually don't need `lsp_start_server` or `lsp_stop_server`.**
   Auto-start fires on first file touch. Idle servers shut themselves down after 30 minutes. Only call these tools if you specifically need to reset or stop a misbehaving server.

8. **`lsp_format_document` and `lsp_rename` write files when `apply: true`.**
   They are sandboxed to the detected workspace root, but they are still file writes. Preview with `apply: false` / `dry_run: true` first.

## Output shape — what to expect

Every location is `{ path, line, column, end_line, end_column, context, symbol_name? }`. `context` is the trimmed source line — useful for showing a result without re-reading the file.

Errors return:
```json
{ "error": { "code": "...", "message": "...", "suggestion": "...", "details": { ... } } }
```
Common codes:
- `SERVER_NOT_FOUND` — language server binary not installed; the `suggestion` field has the install command.
- `UNSUPPORTED_LANGUAGE` — no server config for this extension.
- `CAPABILITY_NOT_SUPPORTED` — the language server cannot do this operation (e.g., call hierarchy on a variable, or rename on a literal).
- `RENAME_NOT_ALLOWED` — `lsp_rename` was called on a non-renameable position.
- `INVALID_POSITION` — line/column outside the file or in an invalid spot.
- `SERVER_TIMEOUT` — the LSP didn't respond. Try again; large workspaces (clangd, jls, gopls cold-start) can take 30s+ on first request.

## Server lifecycle quick facts

- Each `(serverId, workspaceRoot)` pair gets its own server instance — monorepos work correctly.
- Workspace root is auto-detected by walking up looking for `package.json`, `tsconfig.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `.git`, etc. Override via `LSP_WORKSPACE_ROOT`.
- Servers crash-restart with exponential backoff, max 3 attempts in 5 minutes.
- Files larger than 10 MB are rejected.

## When NOT to use these tools

- Reading prose / Markdown / TOML / YAML — use `Read`.
- Searching for a literal string, log message, regex pattern — use `Grep`.
- Listing files by glob — use `Glob`.
- Running tests, the compiler, or your build tool — use `Bash`.

The LSP tools speak code, not text. If your question is "find every place that mentions the word 'deprecated' in a comment" — that is a Grep job, not an LSP job.

## Minimal-step idioms

| Goal | Single call |
|---|---|
| "Where is class `OrderService` defined?" | `lsp_find_symbol(name="OrderService", kind="Class")` |
| "Find method `save` on the class in `user.ts`" | `lsp_find_symbol(name="save", file_path="/abs/.../user.ts", kind="Method")` |
| "All callers of `processPayment`" | `lsp_find_symbol(name="processPayment", include=["definition","incoming_calls"])` |
| "Outline of `routes/api.ts`" | `lsp_document_symbols(file_path=...)` |
| "Quick structural overview of a 2000-line file" | `lsp_folding_ranges(file_path=...)` |
| "Public API of `lib/index.ts`" | `lsp_file_exports(file_path=..., include_signatures=true)` |
| "Errors in the file I just edited" | `lsp_diagnostics(file_path=...)` |
| "Errors across this set of files" | `lsp_index_files(files=[...])` → `lsp_workspace_diagnostics()` |
| "Refactor: rename `getX` to `fetchX` everywhere" | `lsp_rename(..., new_name="fetchX", dry_run=true)`, review, then `dry_run=false` |
| "Type of variable `cfg` at line 42:8" | `lsp_hover(file_path, 42, 8)` |
| "Inferred types in a function body" | `lsp_inlay_hints(file_path, start_line, …, end_line, …)` |
| "Every read/write of `total` in this file" | `lsp_document_highlights(file_path, line, column)` |
| "Smallest enclosing block / statement / expr" | `lsp_selection_range(file_path, line, column)` |
| "Complete information about this symbol" | `lsp_smart_search(..., include=["hover","definition","references","implementations"])` |

## One more rule

If a tool returns nothing, **before falling back to grep**, check:
- Is the cursor on the identifier (not on a space, dot, or bracket)?
- Did you pass an absolute path?
- Is the language server actually installed? (`lsp_server_status` will tell you.)
- For workspace-wide queries: are you assuming files are opened that aren't?

Only fall back to text search when the LSP genuinely cannot answer (e.g., searching docstrings, config files, or doing a regex over comments).
