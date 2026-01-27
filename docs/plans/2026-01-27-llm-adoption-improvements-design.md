# LLM Adoption Improvements for LSP-MCP Server

**Date:** 2026-01-27
**Status:** Proposed
**Goal:** Increase the likelihood that LLMs use LSP tools during initial codebase analysis and routine coding tasks

## Problem Statement

Current LSP tools require knowing a specific file path + line + column position. During initial codebase analysis (e.g., `/init` in Claude Code), LLMs don't have this information yet—so they fall back to grep/glob/read.

The tools are **navigation** and **inspection** focused, but **discovery** is missing.

### How LLMs Choose Tools

1. **Description matching intent** - Scan descriptions for keywords matching the current task
2. **Can I call it now?** - If required parameters aren't known, skip the tool
3. **Will the output help?** - Or will more calls be needed to actually use the result?

### Current Gap

| Phase      | LLM Need                  | Current LSP Support             |
|------------|---------------------------|---------------------------------|
| Discovery  | "What's in this project?" | None - requires grep/glob       |
| Navigation | "Take me to X"            | Requires position (chicken-egg) |
| Inspection | "Tell me about this"      | Good support                    |

---

## Proposed Changes

### A. New Discovery Tools

#### `lsp_workspace_diagnostics`

**Priority:** High
**Purpose:** All errors and warnings across the entire project, not just one file.

**Input:**
```typescript
{
  severity_filter?: "error" | "warning" | "all",  // default: "all"
  limit?: number,                                  // default: 50
  group_by?: "file" | "severity" | "code"         // default: "file"
}
```

**Output:**
```json
{
  "total_count": 12,
  "by_severity": { "error": 3, "warning": 9 },
  "items": [
    {
      "file": "/src/auth.ts",
      "line": 42,
      "column": 10,
      "severity": "error",
      "message": "Property 'name' does not exist on type 'User'",
      "code": "ts(2339)"
    }
  ]
}
```

**Why it helps:** Currently `lsp_diagnostics` requires a file path. During `/init`, you don't know which files have problems.

---

#### `lsp_find_symbol`

**Priority:** High
**Purpose:** Find a symbol by name alone—no file or position needed. Returns full context.

**Input:**
```typescript
{
  name: string,                    // symbol name (exact or fuzzy)
  kind?: string,                   // optional: "function", "class", "interface", etc.
  include?: string[],              // what to return: "definition", "references", "hover", "callers"
  references_limit?: number        // default: 20
}
```

**Output:**
```json
{
  "symbol_name": "parseConfig",
  "kind": "Function",
  "hover": {
    "contents": "(raw: string) => Config",
    "documentation": "Parses a raw configuration string..."
  },
  "definition": {
    "path": "/src/config.ts",
    "line": 15,
    "column": 17,
    "context": "export function parseConfig(raw: string): Config {"
  },
  "references": {
    "items": [...],
    "total_count": 8,
    "has_more": false
  }
}
```

**Why it helps:** "Where is `handleRequest` defined?" becomes one call instead of grep → read → smart_search.

**Implementation:** Internally calls `workspace_symbols` to resolve name → position, then `smart_search`.

---

#### `lsp_file_exports`

**Priority:** Medium
**Purpose:** What does this file expose to other modules?

**Input:**
```typescript
{
  file_path: string
}
```

**Output:**
```json
{
  "file": "/src/services/auth.ts",
  "exports": [
    {
      "name": "authenticate",
      "kind": "Function",
      "line": 15,
      "signature": "(token: string) => Promise<User | null>"
    },
    {
      "name": "AuthConfig",
      "kind": "Interface",
      "line": 5
    }
  ],
  "default_export": {
    "name": "AuthService",
    "kind": "Class",
    "line": 45
  }
}
```

**Why it helps:** Shows what a file exposes without reading its implementation details.

**Implementation:** Filter `document_symbols` to exported symbols only.

---

#### `lsp_file_imports`

**Priority:** Medium
**Purpose:** What does this file depend on?

**Input:**
```typescript
{
  file_path: string,
  resolve?: boolean   // resolve to actual file paths, default: true
}
```

**Output:**
```json
{
  "file": "/src/services/auth.ts",
  "imports": [
    {
      "module": "./database",
      "resolved_path": "/src/services/database.ts",
      "symbols": ["query", "transaction"],
      "line": 1
    },
    {
      "module": "jsonwebtoken",
      "resolved_path": null,
      "symbols": ["verify", "sign"],
      "line": 3
    }
  ]
}
```

**Why it helps:** Shows dependencies without parsing. The `resolved_path` tells where relative imports actually point.

---

### B. Module Analysis Tools

#### `lsp_related_files`

**Priority:** Medium
**Purpose:** Given a file, what other files are closely connected to it?

**Input:**
```typescript
{
  file_path: string,
  relationship?: "imports" | "imported_by" | "all"  // default: "all"
}
```

**Output:**
```json
{
  "file": "/src/services/auth.ts",
  "imports": [
    "/src/services/database.ts",
    "/src/types/index.ts"
  ],
  "imported_by": [
    "/src/index.ts",
    "/src/routes/login.ts",
    "/src/middleware/requireAuth.ts"
  ]
}
```

**Why it helps:** Shows blast radius before modifying a file.

---

#### `lsp_dependency_graph`

**Priority:** Low
**Purpose:** Map relationships between files/modules in the workspace.

**Input:**
```typescript
{
  root_path?: string,              // scope to directory
  depth?: number,                  // limit traversal depth
  direction?: "imports" | "imported_by" | "both"
}
```

**Output:**
```json
{
  "nodes": [
    { "path": "/src/index.ts", "kind": "entry" },
    { "path": "/src/services/auth.ts", "kind": "module" }
  ],
  "edges": [
    { "from": "/src/index.ts", "to": "/src/services/auth.ts" }
  ],
  "entry_points": ["/src/index.ts"],
  "leaf_nodes": ["/src/types/index.ts"]
}
```

**Why it helps:** Concrete, verifiable project structure. Entry points emerge from the graph.

---

### C. UX Improvements

#### C.1 Tool Descriptions Rewritten for LLM Intent

Current descriptions are technically accurate but don't match how an LLM thinks about tasks.

| Tool | Current | Proposed |
|------|---------|----------|
| `lsp_goto_definition` | "Navigate to the definition of a symbol at the given position" | "Find where a function, class, or variable is defined. More accurate than grep—handles aliases, re-exports, and overloads correctly." |
| `lsp_find_references` | "Find all references to the symbol at the given position" | "Find every usage of a symbol across the codebase. Use before renaming or deleting to understand impact. More complete than grep—finds semantic matches, not just text." |
| `lsp_hover` | "Get hover information (type info, documentation)" | "Get the type signature and documentation for any symbol. Use to understand what a function accepts/returns without reading its implementation." |
| `lsp_workspace_symbols` | "Search for symbols across the entire workspace by name" | "Find any function, class, interface, or type by name—no file path needed. Start here when exploring a codebase or locating where something is defined." |
| `lsp_document_symbols` | "Get all symbols defined in a document" | "Get a structured outline of a file: all functions, classes, variables with their types. Faster and more accurate than reading and parsing the file yourself." |
| `lsp_call_hierarchy` | "Get the call hierarchy for a function/method..." | "Trace function calls: who calls this function (incoming) and what it calls (outgoing). Essential for understanding code flow and impact before refactoring." |
| `lsp_smart_search` | "Comprehensive symbol search combining multiple LSP operations" | "Get comprehensive information about a symbol in one call: type info, definition location, all references, and call hierarchy. Use when you need full context about something." |
| `lsp_diagnostics` | "Get cached diagnostics (errors, warnings) for a file" | "Get compiler errors and warnings for a file. Use after making changes to check for type errors, missing imports, or other issues." |

**Principles:**
- Lead with *when to use*, not *what it does*
- Mention advantages over grep/read
- Use LLM-friendly language ("understand impact", "without reading")

---

#### C.2 Transparent Server Auto-Start

**Current:** LLMs may need to call `lsp_start_server` before using other tools.

**Proposed:** Every tool auto-starts the appropriate server if not running. The server_id is inferred from the file extension.

**Implementation:** `prepareFile()` already connects—ensure it's fully automatic with no user intervention needed.

**Benefit:** Removes "should I bother with LSP?" hesitation.

---

#### C.3 Richer Default Output

**Current:** Location results are minimal:
```json
{ "path": "/src/utils.ts", "line": 42, "column": 10 }
```

**Proposed:** Include context by default:
```json
{
  "path": "/src/utils.ts",
  "line": 42,
  "column": 10,
  "context": "export function parseConfig(raw: string): Config {",
  "symbol_name": "parseConfig",
  "symbol_kind": "Function"
}
```

**Apply to:** `lsp_goto_definition`, `lsp_goto_type_definition`, `lsp_find_references`, `lsp_find_implementations`

**Benefit:** Reduces follow-up Read calls.

---

#### C.4 Accept Symbol Names as Alternative to Positions

**Current:** Tools require `file_path` + `line` + `column`.

**Proposed:** Alternative input signature:
```typescript
// Current (still supported)
{ file_path: "/src/foo.ts", line: 10, column: 5 }

// New alternative
{ symbol: "parseConfig" }
// or with disambiguation
{ symbol: "parseConfig", file_path: "/src/foo.ts" }
```

**Apply to:** `lsp_smart_search`, `lsp_find_references`, `lsp_call_hierarchy`

**Implementation:** Internally resolve name → position via `workspace_symbols`.

---

#### C.5 Batch Operations

**Proposed:** `lsp_batch` tool for multiple queries in one call.

```typescript
{
  name: "lsp_batch",
  description: "Execute multiple LSP queries in a single call. Use when analyzing several symbols or files at once.",
  inputSchema: {
    operations: [
      { tool: "hover", file_path: "...", line: 10, column: 5 },
      { tool: "document_symbols", file_path: "..." }
    ]
  }
}
```

**Priority:** Low - efficiency gain, not critical path.

---

## Implementation Roadmap

### Phase 1: Quick Wins (High Impact, Low Effort)

1. Rewrite all tool descriptions with LLM-oriented language
2. Ensure auto-start is truly transparent
3. Add context lines to location results in existing tools

### Phase 2: Discovery Tools

4. `lsp_workspace_diagnostics` - straightforward aggregation
5. `lsp_find_symbol` - combines workspace_symbols + smart_search

### Phase 3: Module Analysis

6. `lsp_file_exports` - filter document_symbols by export modifier
7. `lsp_file_imports` - expose language server's import tracking
8. `lsp_related_files` - bidirectional file relationship query

### Phase 4: Power Features

9. Accept symbol names as position alternative
10. `lsp_batch` for parallel queries
11. `lsp_dependency_graph` - full graph construction

---

## Language Server Support Notes

Not all language servers expose import/export data uniformly:

| Language Server      | Exports | Imports | Notes                     |
|----------------------|---------|---------|---------------------------|
| TypeScript           | Full    | Full    | Best support via tsserver |
| Python (pylsp)       | Partial | Partial | Depends on plugins        |
| Rust (rust-analyzer) | Full    | Full    | Excellent support         |
| Go (gopls)           | Full    | Full    | Good support              |

**Graceful degradation:** Return clear error messages when features aren't supported:
```json
{
  "error": "Import analysis not supported for Python. Consider using grep for import statements."
}
```

---

## Expected Outcomes

**Before:** LLM uses LSP tools only when explicitly instructed or after locating code via grep/read.

**After:**
- During `/init`: LLM reaches for `lsp_workspace_symbols` and `lsp_find_symbol` to explore
- During analysis: `lsp_file_exports` and `lsp_related_files` replace parsing files manually
- During modification: `lsp_find_references` and `lsp_call_hierarchy` used for impact analysis
- Error checking: `lsp_workspace_diagnostics` becomes the go-to for "what's broken?"

---

## New Tool Count

| Category        | New Tools                                                                                  |
|-----------------|--------------------------------------------------------------------------------------------|
| Discovery       | 4 (`lsp_workspace_diagnostics`, `lsp_find_symbol`, `lsp_file_exports`, `lsp_file_imports`) |
| Module Analysis | 2 (`lsp_related_files`, `lsp_dependency_graph`)                                            |
| Utility         | 1 (`lsp_batch`)                                                                            |
| **Total**       | **7 new tools** (bringing total from 19 to 26)                                             |
