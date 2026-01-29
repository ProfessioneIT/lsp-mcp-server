# lsp-mcp-server

An MCP (Model Context Protocol) server that bridges Claude Code to Language Server Protocol (LSP) servers, enabling semantic code intelligence capabilities.

## Overview

**lsp-mcp-server** acts as a bridge between Claude Code and language servers, providing powerful code intelligence features:

- **Go to Definition** - Navigate to where symbols are defined
- **Find References** - Find all usages of a symbol across the workspace
- **Hover Information** - Get type information and documentation
- **Code Completion** - Get intelligent code suggestions
- **Diagnostics** - Access errors, warnings, and hints from the language server
- **Symbol Search** - Search for symbols in documents or across the workspace
- **Rename** - Safely rename symbols across the entire codebase
- **Code Actions** - Apply quick fixes, refactorings, and organize imports
- **Call Hierarchy** - See who calls a function and what it calls
- **Type Hierarchy** - Explore class inheritance and interface implementations
- **Format Document** - Format code using the language server's formatter
- **Smart Search** - Comprehensive symbol analysis in a single call
- **File Analysis** - Explore imports, exports, and file relationships

```
┌─────────────┐      ┌──────────────────┐      ┌───────────────────┐
│ Claude Code │────▶│  lsp-mcp-server  │────▶│ Language Servers  │
│   (MCP)     │◀────│   (this tool)    │◀────│ (TypeScript, etc) │
└─────────────┘      └──────────────────┘      └───────────────────┘
      stdio              stdio/JSON-RPC            stdio
```

## Features

- **24 MCP Tools** for comprehensive code intelligence
- **8 Languages Supported** out of the box:
  - TypeScript / JavaScript
  - Python
  - Rust
  - Go
  - C / C++
  - Ruby
  - PHP
  - Elixir
- **Multi-root Workspace** - Proper monorepo support with per-workspace server instances
- **Push-based Diagnostics** - Real-time error/warning caching from language servers
- **Human-friendly Positions** - All line/column numbers are 1-indexed
- **Safe Rename** - Preview changes before applying with dry-run mode
- **Automatic Server Management** - Servers start on-demand and restart on crash
- **Configurable** - Customize language servers, timeouts, and more
- **Security Features** - File size limits, workspace boundary validation, absolute path enforcement

## Installation

### Prerequisites

- **Node.js** 18.0.0 or higher
- **Language servers** for the languages you want to use:

```bash
# TypeScript/JavaScript
npm install -g typescript-language-server typescript

# Python
pip install python-lsp-server

# Rust
rustup component add rust-analyzer

# Go
go install golang.org/x/tools/gopls@latest

# C/C++
# Ubuntu/Debian:
sudo apt install clangd
# macOS:
brew install llvm

# Ruby
gem install solargraph

# PHP
npm install -g intelephense

# Elixir
mix escript.install hex elixir_ls
# Or download pre-built releases from:
# https://github.com/elixir-lsp/elixir-ls/releases
```

### Install lsp-mcp-server

```bash
# Clone the repository
git clone <repository-url>
cd lsp-mcp-server

# Install dependencies
npm install

# Build
npm run build

# Verify installation
node dist/index.js --help
```

### Global Installation (Optional)

```bash
# Link globally for easy access
npm link

# Now you can run from anywhere
lsp-mcp-server
```

## Configuration with Claude Code

### 1. Add to Claude Code MCP Settings

Create or edit the `.mcp.json` file in your home directory:

**Location:** `~/.mcp.json` (user-level) or `.mcp.json` in your project root (project-level)

```json
{
  "mcpServers": {
    "lsp": {
      "command": "node",
      "args": ["/absolute/path/to/lsp-mcp-server/dist/index.js"],
      "env": {
        "LSP_LOG_LEVEL": "info"
      }
    }
  }
}
```

**Or if installed globally via npm link:**

```json
{
  "mcpServers": {
    "lsp": {
      "command": "lsp-mcp-server"
    }
  }
}
```

### 2. Restart Claude Code

After updating the configuration, restart Claude Code to load the new MCP server.

### 3. Verify Installation

In Claude Code, ask:

> "Use lsp_server_status to check available language servers"

You should see a response showing the server is running.

### 4. Enforce LSP Tool Usage (Recommended)

To make Claude Code consistently prefer LSP tools over alternatives like `Grep` and `Glob` for code navigation, add instructions to your global `~/.claude/CLAUDE.md` file:

```markdown
## LSP Server - REQUIRED FIRST STEP

**BEFORE any code analysis, navigation, or codebase exploration, you MUST:**

1. Run `lsp_server_status` to check running servers
2. If the relevant language server is NOT running → run `lsp_start_server` immediately
3. ONLY AFTER the LSP server is running, proceed with analysis

This is a hard requirement, not a preference. Do NOT skip this step.

## LSP Tool Requirements

When LSP MCP tools are available, you MUST use them instead of alternatives:

| Task | REQUIRED Tool | FORBIDDEN Alternatives |
|------|---------------|----------------------|
| Find where X is defined | `lsp_goto_definition` | Grep, Read, Glob |
| Find where X is used | `lsp_find_references` | Grep |
| Find symbol by name | `lsp_workspace_symbols` or `lsp_find_symbol` | Glob, Grep |
| Understand file structure | `lsp_document_symbols` | Read entire file |
| Get type information | `lsp_hover` | Reading source code |
| Find implementations | `lsp_find_implementations` | Grep |
| Understand module API | `lsp_file_exports` | Read entire file |
| Check for errors | `lsp_diagnostics` | Running compiler manually |
| See file dependencies | `lsp_file_imports` or `lsp_related_files` | Grep for imports |

## Prohibited Patterns

When LSP is available, NEVER do these:

- NEVER use `Grep` to find function/class/symbol definitions
- NEVER use `Grep` to find where a symbol is referenced
- NEVER use `Glob` to find files containing a symbol name
- NEVER use `Read` to scan through a file looking for definitions
- NEVER use `Bash` with grep/rg/find for code navigation

These tools are still appropriate for:
- Searching for text/strings (not code symbols)
- Reading configuration files
- Reading documentation files
- File operations unrelated to code navigation

## LSP Tool Quick Reference

```
lsp_server_status          # Check what's running
lsp_start_server           # Start a language server
lsp_goto_definition        # Jump to where symbol is defined
lsp_goto_type_definition   # Jump to type definition
lsp_find_references        # Find all usages of a symbol
lsp_find_implementations   # Find concrete implementations
lsp_workspace_symbols      # Search symbols across project
lsp_document_symbols       # Get outline of a file
lsp_hover                  # Get type/docs for symbol
lsp_signature_help         # Get function parameter hints
lsp_completions            # Get code completions
lsp_diagnostics            # Get errors/warnings for a file
lsp_workspace_diagnostics  # Get errors/warnings across project
lsp_file_exports           # Get public API of a module
lsp_file_imports           # Get imports/dependencies of a file
lsp_related_files          # Find connected files (imports/imported by)
lsp_rename                 # Rename symbol across codebase
lsp_code_actions           # Get/apply quick fixes and refactorings
lsp_call_hierarchy         # See callers and callees
lsp_type_hierarchy         # See type inheritance
lsp_format_document        # Format code
lsp_smart_search           # Combined: definition + refs + hover
lsp_find_symbol            # Find symbol by name with full context
```
```

This ensures Claude Code will:
- Always start the LSP server before analyzing code
- Use semantic LSP tools instead of text-based search for code navigation
- Fall back to Grep/Glob only for non-code searches (strings, config files, docs)

## Available Tools

### Navigation Tools

#### `lsp_goto_definition`
Navigate to the definition of a symbol.

```
Input:
  - file_path: Absolute path to the source file
  - line: Line number (1-indexed)
  - column: Column number (1-indexed)

Output:
  - definitions: Array of locations with path, line, column, and context
```

**Example prompt:** "Go to the definition of the function at line 42, column 10 in /project/src/utils.ts"

#### `lsp_goto_type_definition`
Navigate to the type definition of a symbol (useful for finding the interface/class that defines a variable's type).

```
Input:
  - file_path: Absolute path to the source file
  - line: Line number (1-indexed)
  - column: Column number (1-indexed)

Output:
  - definitions: Array of type definition locations
```

**Example prompt:** "Find the type definition for the variable at line 15, column 5 in /project/src/app.ts"

### Reference Tools

#### `lsp_find_references`
Find all references to a symbol across the workspace.

```
Input:
  - file_path: Absolute path to the source file
  - line: Line number (1-indexed)
  - column: Column number (1-indexed)
  - include_declaration: Whether to include the declaration (default: true)
  - limit: Maximum results (default: 100, max: 500)
  - offset: Skip results for pagination (default: 0)

Output:
  - references: Array of locations
  - total_count: Total number of references found
  - has_more: Whether there are more results
```

**Example prompt:** "Find all references to the 'UserService' class in /project/src/services/user.ts at line 5"

#### `lsp_find_implementations`
Find all implementations of an interface or abstract method.

```
Input:
  - file_path: Absolute path to the source file
  - line: Line number (1-indexed)
  - column: Column number (1-indexed)
  - limit: Maximum results (default: 50, max: 100)

Output:
  - implementations: Array of implementation locations
  - total_count: Total implementations found
  - has_more: Whether there are more results
```

**Example prompt:** "Find all implementations of the interface at line 10 in /project/src/types.ts"

### Information Tools

#### `lsp_hover`
Get hover information (type info, documentation) for a symbol.

```
Input:
  - file_path: Absolute path to the source file
  - line: Line number (1-indexed)
  - column: Column number (1-indexed)

Output:
  - contents: Markdown-formatted type information and documentation
  - range: The range of the hovered symbol (optional)
```

**Example prompt:** "What is the type of the variable at line 25, column 8 in /project/src/main.ts?"

#### `lsp_signature_help`
Get function/method signature information when inside a call expression.

```
Input:
  - file_path: Absolute path to the source file
  - line: Line number (1-indexed)
  - column: Column number (1-indexed)

Output:
  - signatures: Array of function signatures with parameters
  - active_signature: Index of the active signature
  - active_parameter: Index of the active parameter
```

**Example prompt:** "What are the parameters for the function call at line 30 in /project/src/api.ts?"

### Symbol Tools

#### `lsp_document_symbols`
Get all symbols (functions, classes, variables, etc.) defined in a document.

```
Input:
  - file_path: Absolute path to the source file

Output:
  - symbols: Hierarchical array of symbols with name, kind, range, and children
```

**Example prompt:** "List all symbols in /project/src/components/Button.tsx"

#### `lsp_workspace_symbols`
Search for symbols across the entire workspace by name.

```
Input:
  - query: Search query (supports fuzzy matching)
  - kinds: Filter by symbol kinds (optional): Class, Function, Interface, Variable, etc.
  - limit: Maximum results (default: 50, max: 100)

Output:
  - symbols: Array of matching symbols with path and location
  - total_count: Total matches found
  - has_more: Whether there are more results
```

**Example prompt:** "Search for all classes containing 'Service' in the workspace"

#### `lsp_find_symbol`
Find a symbol by name and get comprehensive information about it - no file path needed.

```
Input:
  - name: Symbol name to search for (supports fuzzy matching)
  - kind: Filter to specific symbol kind (optional): Class, Function, Interface, etc.
  - include: Array of what to include: 'hover', 'definition', 'references', 'implementations', 'incoming_calls', 'outgoing_calls' (default: ['hover', 'definition', 'references'])
  - references_limit: Maximum references to return (default: 20)

Output:
  - query: The symbol that was searched for
  - match: The best matching symbol found
  - matches_found: Number of total matches
  - definition: Where the symbol is defined
  - hover: Type information and documentation
  - references: All usages of the symbol
  - implementations: Implementations (for interfaces)
  - incoming_calls: Functions that call this
  - outgoing_calls: Functions this calls
```

**Example prompt:** "Find the UserService class and show me all its references"

### File Analysis Tools

#### `lsp_file_exports`
Get the public API surface of a file - all exported functions, classes, interfaces, and variables.

```
Input:
  - file_path: Absolute path to the source file
  - include_signatures: Include type signatures from hover (default: true, slower but more informative)

Output:
  - file: The file path
  - exports: Array of exported items with name, kind, line, column, and signature
  - note: Additional information
```

**Example prompt:** "What does /project/src/utils/index.ts export?"

#### `lsp_file_imports`
Get all imports and dependencies of a file.

```
Input:
  - file_path: Absolute path to the source file

Output:
  - file: The file path
  - imports: Array of imports with module, line, symbols, is_type_only, is_dynamic
  - note: Additional information
```

**Example prompt:** "What modules does /project/src/api/client.ts import?"

#### `lsp_related_files`
Find files connected to a given file - what it imports and what imports it.

```
Input:
  - file_path: Absolute path to the source file
  - relationship: Which relationships to include: 'imports', 'imported_by', or 'all' (default: 'all')

Output:
  - file: The file path
  - imports: Array of files this file imports
  - imported_by: Array of files that import this file
  - note: Additional information
```

**Example prompt:** "What files depend on /project/src/services/auth.ts?"

### Diagnostic Tools

#### `lsp_diagnostics`
Get cached diagnostics (errors, warnings) for a file.

```
Input:
  - file_path: Absolute path to the source file
  - severity_filter: Filter by severity - 'all', 'error', 'warning', 'info', 'hint' (default: 'all')

Output:
  - diagnostics: Array of diagnostics with range, severity, message, and code
  - summary: Count of errors, warnings, info, and hints
  - note: Information about diagnostic caching
```

**Example prompt:** "Show me all errors in /project/src/index.ts"

#### `lsp_workspace_diagnostics`
Get diagnostics across all open files in the workspace.

```
Input:
  - severity_filter: Filter by severity - 'all', 'error', 'warning', 'info', 'hint' (default: 'all')
  - limit: Maximum diagnostics to return (default: 50, max: 200)
  - group_by: How to group results - 'file' or 'severity' (default: 'file')

Output:
  - items: Array of diagnostics with file, line, column, severity, message, and context
  - total_count: Total diagnostics found
  - returned_count: Number returned (may be limited)
  - files_affected: Number of files with diagnostics
  - summary: Count of errors, warnings, info, and hints
  - note: Information about diagnostic caching
```

**Example prompt:** "Show me all errors across the entire project"

### Completion Tools

#### `lsp_completions`
Get code completion suggestions at a position.

```
Input:
  - file_path: Absolute path to the source file
  - line: Line number (1-indexed)
  - column: Column number (1-indexed)
  - limit: Maximum suggestions (default: 20, max: 50)

Output:
  - completions: Array of completion items with label, kind, detail, and documentation
  - is_incomplete: Whether the list is incomplete
```

**Example prompt:** "What completions are available at line 15, column 10 in /project/src/app.ts?"

### Refactoring Tools

#### `lsp_rename`
Rename a symbol across the workspace.

```
Input:
  - file_path: Absolute path to the source file
  - line: Line number (1-indexed)
  - column: Column number (1-indexed)
  - new_name: The new name for the symbol
  - dry_run: Preview changes without applying (default: true)

Output:
  - changes: Map of file paths to arrays of edits
  - files_affected: Number of files that would be modified
  - edits_count: Total number of edits
  - applied: Whether changes were applied
  - original_name: The original symbol name (if available)
```

**Example prompt:** "Rename the function 'getUserData' to 'fetchUserData' at line 20 in /project/src/api.ts (dry run first)"

#### `lsp_code_actions`
Get available code actions (refactorings, quick fixes) at a position or range, and optionally apply them.

```
Input:
  - file_path: Absolute path to the source file
  - start_line: Start line number (1-indexed)
  - start_column: Start column number (1-indexed)
  - end_line: End line number (optional, defaults to start line)
  - end_column: End column number (optional, defaults to start column)
  - kinds: Filter by action kinds (optional): quickfix, refactor, refactor.extract, refactor.inline, source.organizeImports, etc.
  - apply: If true, apply the action at action_index (default: false)
  - action_index: Index of action to apply when apply=true (default: 0)

Output:
  - actions: Array of available code actions with title, kind, and edits
  - total_count: Number of available actions
  - applied: The action that was applied (if apply=true and successful)
```

**Example prompt:** "What refactoring options are available for the function at line 50 in /project/src/utils.ts?"

**Example prompt:** "Apply the first quick fix for the error at line 15 in /project/src/api.ts"

#### `lsp_format_document`
Format a document using the language server's formatting capabilities.

```
Input:
  - file_path: Absolute path to the source file
  - tab_size: Spaces per tab (default: 2)
  - insert_spaces: Use spaces instead of tabs (default: true)
  - apply: Apply formatting to file (default: false)

Output:
  - edits: Array of formatting edits with range and new_text
  - edits_count: Number of edits
  - applied: Whether edits were applied
```

**Example prompt:** "Format /project/src/messy-file.ts using the language server"

### Hierarchy Tools

#### `lsp_call_hierarchy`
Get the call hierarchy for a function - who calls it and what it calls.

```
Input:
  - file_path: Absolute path to the source file
  - line: Line number (1-indexed)
  - column: Column number (1-indexed)
  - direction: 'incoming' (callers), 'outgoing' (callees), or 'both' (default: 'both')

Output:
  - item: The call hierarchy item at the position
  - incoming_calls: Array of functions that call this function
  - outgoing_calls: Array of functions this function calls
```

**Example prompt:** "Show me all functions that call handleRequest at line 100 in /project/src/server.ts"

#### `lsp_type_hierarchy`
Get the type hierarchy for a class or interface - supertypes and subtypes.

```
Input:
  - file_path: Absolute path to the source file
  - line: Line number (1-indexed)
  - column: Column number (1-indexed)
  - direction: 'supertypes' (parents), 'subtypes' (children), or 'both' (default: 'both')

Output:
  - item: The type hierarchy item at the position
  - supertypes: Array of parent types/interfaces
  - subtypes: Array of child types/implementations
```

**Example prompt:** "What classes implement the Repository interface at line 5 in /project/src/types.ts?"

### Combined Tools

#### `lsp_smart_search`
Comprehensive symbol search combining multiple LSP operations in one call.

```
Input:
  - file_path: Absolute path to the source file
  - line: Line number (1-indexed)
  - column: Column number (1-indexed)
  - include: Array of what to include: 'hover', 'definition', 'references', 'implementations', 'incoming_calls', 'outgoing_calls' (default: ['hover', 'definition', 'references'])
  - references_limit: Maximum references to return (default: 20)

Output:
  - symbol_name: Name of the symbol
  - hover: Type information and documentation
  - definition: Where the symbol is defined
  - references: All usages of the symbol
  - implementations: Implementations (for interfaces)
  - incoming_calls: Functions that call this
  - outgoing_calls: Functions this calls
```

**Example prompt:** "Give me a complete analysis of the processData function at line 75 in /project/src/processor.ts - definition, all references, and what calls it"

### Server Management Tools

#### `lsp_server_status`
Get status of running language servers.

```
Input:
  - server_id: Specific server to check (optional, omit for all servers)

Output:
  - servers: Array of server status objects with id, status, capabilities, uptime, etc.
```

**Example prompt:** "Show the status of all language servers"

#### `lsp_start_server`
Manually start a language server for a specific workspace.

```
Input:
  - server_id: Server ID from configuration (e.g., 'typescript', 'python')
  - workspace_root: Absolute path to the workspace/project root

Output:
  - status: 'started'
  - server_id: The server that was started
  - workspace_root: The workspace root
  - capabilities: List of supported capabilities
```

**Example prompt:** "Start the TypeScript language server for /home/user/my-project"

#### `lsp_stop_server`
Stop a running language server.

```
Input:
  - server_id: Server ID to stop
  - workspace_root: Workspace root (optional, omit to stop all instances)

Output:
  - status: 'stopped'
  - server_id: The server that was stopped
  - was_running: Whether the server was actually running
```

**Example prompt:** "Stop the Python language server"

## Supported Languages

The following languages are supported out of the box:

| Language | Server | Command | File Extensions | Root Patterns |
|----------|--------|---------|-----------------|---------------|
| **TypeScript/JavaScript** | typescript-language-server | `typescript-language-server --stdio` | `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs` | `tsconfig.json`, `jsconfig.json`, `package.json` |
| **Python** | pylsp | `pylsp` | `.py`, `.pyi` | `pyproject.toml`, `setup.py`, `requirements.txt`, `Pipfile` |
| **Rust** | rust-analyzer | `rust-analyzer` | `.rs` | `Cargo.toml` |
| **Go** | gopls | `gopls serve` | `.go` | `go.mod`, `go.work` |
| **C/C++** | clangd | `clangd --background-index` | `.c`, `.h`, `.cpp`, `.hpp`, `.cc`, `.cxx` | `compile_commands.json`, `CMakeLists.txt`, `Makefile` |
| **Ruby** | solargraph | `solargraph stdio` | `.rb`, `.rake`, `.gemspec` | `Gemfile`, `.ruby-version`, `Rakefile` |
| **PHP** | intelephense | `intelephense --stdio` | `.php`, `.phtml` | `composer.json`, `index.php` |
| **Elixir** | elixir-ls | `elixir-ls` | `.ex`, `.exs`, `.heex`, `.leex` | `mix.exs`, `.formatter.exs` |

You can add additional languages by providing a custom configuration (see [Configuration](#configuration)).

## Configuration

### Configuration File

Create a configuration file at one of these locations (in order of priority):

1. `./.lsp-mcp.json` (current directory)
2. `./lsp-mcp.json` (current directory)
3. `~/.config/lsp-mcp/config.json` (XDG config)
4. `~/.lsp-mcp.json` (home directory)

Or set `LSP_CONFIG_PATH` environment variable to specify a custom path.

**Example configuration:**

```json
{
  "servers": [
    {
      "id": "typescript",
      "extensions": [".ts", ".tsx", ".js", ".jsx"],
      "languageIds": ["typescript", "typescriptreact", "javascript", "javascriptreact"],
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "rootPatterns": ["tsconfig.json", "package.json"]
    },
    {
      "id": "python",
      "extensions": [".py"],
      "languageIds": ["python"],
      "command": "pylsp",
      "args": [],
      "rootPatterns": ["pyproject.toml", "setup.py", "requirements.txt"]
    }
  ],
  "requestTimeout": 30000,
  "autoStart": true,
  "logLevel": "info",
  "idleTimeout": 1800000
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `servers` | array | Built-in defaults | Language server configurations |
| `requestTimeout` | number | 30000 | Request timeout in milliseconds |
| `autoStart` | boolean | true | Auto-start servers on first request |
| `logLevel` | string | "info" | Log level: debug, info, warn, error |
| `idleTimeout` | number | 1800000 | Idle timeout before stopping servers (30 min) |

### Server Configuration

Each server in the `servers` array has:

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `id` | string | Yes | Unique identifier for the server |
| `extensions` | string[] | Yes | File extensions this server handles |
| `languageIds` | string[] | Yes | LSP language identifiers |
| `command` | string | Yes | Command to start the server |
| `args` | string[] | Yes | Command arguments |
| `env` | object | No | Environment variables |
| `initializationOptions` | object | No | LSP initialization options |
| `rootPatterns` | string[] | No | Files/dirs that indicate project root |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `LSP_LOG_LEVEL` | Override log level (debug, info, warn, error) |
| `LSP_CONFIG_PATH` | Path to configuration file |
| `LSP_WORKSPACE_ROOT` | Override workspace root detection |

## Security Features

lsp-mcp-server includes several security measures:

- **Absolute Path Enforcement** - All file paths must be absolute to prevent path traversal attacks
- **Workspace Boundary Validation** - File modifications (rename, format, code actions) are restricted to within the workspace root
- **File Size Limits** - Files larger than 10 MB are rejected to prevent memory exhaustion
- **No Shell Execution** - Language servers are spawned with `shell: false` to prevent command injection

## Usage Examples with Claude Code

### Basic Navigation

> "I'm looking at /project/src/services/auth.ts. Can you tell me what the `validateToken` function at line 45 does? Use lsp_hover to get its documentation."

> "Go to the definition of `UserRepository` used at line 23, column 15 in /project/src/controllers/user.ts"

### Finding Usages

> "Find all places where the `handleError` function is called in my codebase. It's defined at line 10 in /project/src/utils/error.ts"

> "I want to refactor the `Config` interface. First, find all its implementations using lsp_find_implementations"

### Code Quality

> "Check /project/src/index.ts for any TypeScript errors using lsp_diagnostics"

> "Show me all errors and warnings across the entire project using lsp_workspace_diagnostics"

### Safe Refactoring

> "I want to rename the `getData` function to `fetchData`. It's at line 50 in /project/src/api.ts. First do a dry run to see what would change."

> "The dry run looks good. Now apply the rename by setting dry_run to false."

### Code Exploration

> "List all the symbols in /project/src/models/User.ts to understand its structure"

> "Search the workspace for all classes that contain 'Controller' in their name"

> "Find the UserService class and tell me everything about it - definition, references, and what calls it"

### File Analysis

> "What does /project/src/utils/index.ts export?"

> "What files depend on /project/src/services/auth.ts? Use lsp_related_files"

> "Show me all the imports in /project/src/api/client.ts"

### Completions

> "What methods are available on the object at line 30, column 5 in /project/src/app.ts? Use lsp_completions"

### Code Actions and Refactoring

> "What refactoring options are available for the code selection from line 20 to 35 in /project/src/utils.ts?"

> "Organize imports in /project/src/components/App.tsx using lsp_code_actions with kinds filter for source.organizeImports"

> "Apply the first quick fix for the error at line 15 in /project/src/api.ts"

### Understanding Code Flow

> "Show me the call hierarchy for the processOrder function at line 50 in /project/src/orders.ts - I want to see what calls it"

> "What does the authenticate function call? Use lsp_call_hierarchy with outgoing direction"

> "Show me the type hierarchy for the BaseRepository class - what are its subtypes?"

### Comprehensive Analysis

> "Give me a complete analysis of the UserService class at line 10 in /project/src/services/user.ts - I want definition, all references, implementations, and call hierarchy. Use lsp_smart_search"

### Formatting

> "Format /project/src/unformatted.ts using the language server (preview first, don't apply)"

## Troubleshooting

### Language Server Not Found

**Error:** `Failed to start language server: typescript-language-server`

**Solution:** Install the language server:
```bash
npm install -g typescript-language-server typescript
```

### No Diagnostics Showing

**Issue:** `lsp_diagnostics` returns empty results

**Explanation:** Diagnostics are push-based. The language server sends them when files are opened or changed.

**Solution:**
1. Open the file using another tool first
2. Wait a moment for the server to analyze
3. Try again

### Server Crashes Repeatedly

**Issue:** Server keeps crashing and restarting

**Solution:**
1. Check `LSP_LOG_LEVEL=debug` for detailed logs
2. Verify the language server is properly installed
3. Check if the workspace has valid configuration (e.g., tsconfig.json for TypeScript)

### Position Errors

**Issue:** "Invalid position" errors

**Remember:** All positions are 1-indexed (first line is 1, first column is 1), not 0-indexed.

### Path Errors

**Issue:** "File path must be absolute" errors

**Remember:** All file paths must be absolute (e.g., `/home/user/project/src/file.ts`, not `src/file.ts`).

### Timeout Errors

**Issue:** Requests timing out

**Solution:** Increase the timeout:
```bash
export LSP_REQUEST_TIMEOUT=60000  # 60 seconds
```

Or in configuration:
```json
{
  "requestTimeout": 60000
}
```

### File Too Large

**Issue:** "File too large" errors

**Explanation:** Files larger than 10 MB are rejected to prevent memory issues.

**Solution:** Work with smaller files or split large files into modules.

## Development

### Building

```bash
npm run build        # Compile TypeScript
npm run dev          # Watch mode
npm run typecheck    # Type-check only
```

### Testing

```bash
npm test             # Run unit tests
npm run test:watch   # Watch mode
```

### Interactive Testing

Use the MCP Inspector for interactive testing:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

### Linting

```bash
npm run lint         # Check for issues
npm run lint:fix     # Auto-fix issues
```

## Architecture

### Multi-root Workspace Support

Server instances are keyed by `(serverId, workspaceRoot)` pairs. This means:

- Each workspace gets its own language server instance
- Monorepos work correctly with multiple tsconfig.json files
- Server settings are isolated per workspace

### Diagnostics Caching

Unlike other LSP features that are request-based, diagnostics are push-based:

1. Language servers send `publishDiagnostics` notifications
2. lsp-mcp-server caches these in memory
3. `lsp_diagnostics` and `lsp_workspace_diagnostics` tools read from the cache

This means diagnostics are available immediately after files are opened, without an explicit request.

### Automatic Server Lifecycle

- Servers start automatically when needed (if `autoStart: true`)
- Crashed servers restart with exponential backoff (max 3 attempts in 5 minutes)
- Idle servers shut down after the configured timeout

## Version

Current version: **1.1.1**

## License

MIT

## Contributing

Contributions are welcome! Please read the contributing guidelines before submitting pull requests.
