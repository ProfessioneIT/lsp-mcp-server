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
- **And more...**

```
┌─────────────┐     ┌──────────────────┐     ┌───────────────────┐
│ Claude Code │────▶│  lsp-mcp-server  │────▶│ Language Servers  │
│   (MCP)     │◀────│   (this tool)    │◀────│ (TypeScript, etc) │
└─────────────┘     └──────────────────┘     └───────────────────┘
      stdio              stdio/JSON-RPC            stdio
```

## Features

- **14 MCP Tools** for comprehensive code intelligence
- **Multi-language Support** - TypeScript, Python, Rust, Go out of the box
- **Multi-root Workspace** - Proper monorepo support with per-workspace server instances
- **Push-based Diagnostics** - Real-time error/warning caching from language servers
- **Human-friendly Positions** - All line/column numbers are 1-indexed
- **Safe Rename** - Preview changes before applying with dry-run mode
- **Automatic Server Management** - Servers start on-demand and restart on crash
- **Configurable** - Customize language servers, timeouts, and more

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

Add the server to your Claude Code MCP configuration file:

**Location:** `~/.config/claude-code/mcp_settings.json` (Linux/macOS) or `%APPDATA%\claude-code\mcp_settings.json` (Windows)

```json
{
  "mcpServers": {
    "lsp": {
      "command": "node",
      "args": ["/absolute/path/to/lsp-mcp-server/dist/index.js"],
      "env": {
        "LSP_MCP_LOG_LEVEL": "info"
      }
    }
  }
}
```

**Or if installed globally:**

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

## Configuration

### Configuration File

Create a configuration file at one of these locations (in order of priority):

1. `./.lsp-mcp.json` (current directory)
2. `./lsp-mcp.json` (current directory)
3. `~/.config/lsp-mcp/config.json` (XDG config)
4. `~/.lsp-mcp.json` (home directory)

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
| `LSP_MCP_LOG_LEVEL` | Override log level (debug, info, warn, error) |
| `LSP_MCP_REQUEST_TIMEOUT` | Override request timeout in milliseconds |
| `LSP_CONFIG_PATH` | Path to configuration file |
| `LSP_WORKSPACE_ROOT` | Override workspace root detection |

## Usage Examples with Claude Code

### Basic Navigation

> "I'm looking at /project/src/services/auth.ts. Can you tell me what the `validateToken` function at line 45 does? Use lsp_hover to get its documentation."

> "Go to the definition of `UserRepository` used at line 23, column 15 in /project/src/controllers/user.ts"

### Finding Usages

> "Find all places where the `handleError` function is called in my codebase. It's defined at line 10 in /project/src/utils/error.ts"

> "I want to refactor the `Config` interface. First, find all its implementations using lsp_find_implementations"

### Code Quality

> "Check /project/src/index.ts for any TypeScript errors using lsp_diagnostics"

> "Show me all errors and warnings in /project/src/components/Form.tsx"

### Safe Refactoring

> "I want to rename the `getData` function to `fetchData`. It's at line 50 in /project/src/api.ts. First do a dry run to see what would change."

> "The dry run looks good. Now apply the rename by setting dry_run to false."

### Code Exploration

> "List all the symbols in /project/src/models/User.ts to understand its structure"

> "Search the workspace for all classes that contain 'Controller' in their name"

### Completions

> "What methods are available on the object at line 30, column 5 in /project/src/app.ts? Use lsp_completions"

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
1. Check `LSP_MCP_LOG_LEVEL=debug` for detailed logs
2. Verify the language server is properly installed
3. Check if the workspace has valid configuration (e.g., tsconfig.json for TypeScript)

### Position Errors

**Issue:** "Invalid position" errors

**Remember:** All positions are 1-indexed (first line is 1, first column is 1), not 0-indexed.

### Timeout Errors

**Issue:** Requests timing out

**Solution:** Increase the timeout:
```bash
export LSP_MCP_REQUEST_TIMEOUT=60000  # 60 seconds
```

Or in configuration:
```json
{
  "requestTimeout": 60000
}
```

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

Server instances are keyed by `(languageId, workspaceRoot)` pairs. This means:

- Each workspace gets its own language server instance
- Monorepos work correctly with multiple tsconfig.json files
- Server settings are isolated per workspace

### Diagnostics Caching

Unlike other LSP features that are request-based, diagnostics are push-based:

1. Language servers send `publishDiagnostics` notifications
2. lsp-mcp-server caches these in memory
3. `lsp_diagnostics` tool reads from the cache

This means diagnostics are available immediately after files are opened, without an explicit request.

### Automatic Server Lifecycle

- Servers start automatically when needed (if `autoStart: true`)
- Crashed servers restart with exponential backoff (max 3 attempts in 5 minutes)
- Idle servers shut down after the configured timeout

## License

MIT

## Contributing

Contributions are welcome! Please read the contributing guidelines before submitting pull requests.
