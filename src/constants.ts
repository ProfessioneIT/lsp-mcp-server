import type { Config, LSPServerConfig } from './types.js';

// ============================================================================
// Default Server Configurations
// ============================================================================

export const DEFAULT_SERVERS: LSPServerConfig[] = [
  {
    id: 'typescript',
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
    languageIds: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
    command: 'typescript-language-server',
    args: ['--stdio'],
    rootPatterns: ['tsconfig.json', 'jsconfig.json', 'package.json'],
  },
  {
    id: 'python',
    extensions: ['.py', '.pyi'],
    languageIds: ['python'],
    command: 'pylsp',
    args: [],
    rootPatterns: ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'Pipfile'],
  },
  {
    id: 'rust',
    extensions: ['.rs'],
    languageIds: ['rust'],
    command: 'rust-analyzer',
    args: [],
    rootPatterns: ['Cargo.toml'],
  },
  {
    id: 'go',
    extensions: ['.go'],
    languageIds: ['go'],
    command: 'gopls',
    args: ['serve'],
    rootPatterns: ['go.mod', 'go.work'],
  },
];

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_CONFIG: Config = {
  servers: DEFAULT_SERVERS,
  requestTimeout: 30000, // 30 seconds
  autoStart: true,
  logLevel: 'info',
  idleTimeout: 1800000, // 30 minutes
};

// ============================================================================
// Installation Commands (for error messages)
// ============================================================================

export const INSTALL_COMMANDS: Record<string, string> = {
  typescript: 'npm install -g typescript-language-server typescript',
  python: 'pip install python-lsp-server',
  rust: 'rustup component add rust-analyzer',
  go: 'go install golang.org/x/tools/gopls@latest',
};

// ============================================================================
// Binary File Detection
// ============================================================================

/** File extensions that are always considered binary */
export const BINARY_EXTENSIONS = new Set([
  // Images
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp', '.tiff', '.psd',
  // Archives
  '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2', '.xz', '.zst',
  // Compiled
  '.exe', '.dll', '.so', '.dylib', '.class', '.pyc', '.pyo', '.o', '.a', '.lib', '.obj', '.wasm',
  // Media
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv', '.flac', '.ogg', '.webm',
  // Documents
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods',
  // Data
  '.sqlite', '.db', '.sqlite3', '.mdb',
  // Fonts
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  // Other
  '.bin', '.dat', '.iso', '.img', '.dmg',
]);

/** Number of bytes to read for binary detection */
export const BINARY_CHECK_BYTES = 8192;

// ============================================================================
// Workspace Root Detection
// ============================================================================

/** Default root markers for workspace detection */
export const DEFAULT_ROOT_MARKERS = [
  // Version control
  '.git',
  '.hg',
  '.svn',
  // JavaScript/TypeScript
  'package.json',
  'tsconfig.json',
  'jsconfig.json',
  // Python
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'requirements.txt',
  'Pipfile',
  // Rust
  'Cargo.toml',
  // Go
  'go.mod',
  'go.work',
  // Java/Kotlin
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  // .NET
  '*.sln',
  '*.csproj',
  // Ruby
  'Gemfile',
  // PHP
  'composer.json',
];

// ============================================================================
// LSP Constants
// ============================================================================

/** Maximum number of restart attempts for a crashed server */
export const MAX_RESTART_ATTEMPTS = 3;

/** Time window for restart attempts (ms) */
export const RESTART_WINDOW_MS = 300000; // 5 minutes

/** Base delay for exponential backoff (ms) */
export const RESTART_BASE_DELAY_MS = 1000;

/** Maximum results for find references */
export const MAX_REFERENCES = 500;

/** Default limit for find references */
export const DEFAULT_REFERENCES_LIMIT = 100;

/** Maximum results for workspace symbols */
export const MAX_WORKSPACE_SYMBOLS = 100;

/** Default limit for workspace symbols */
export const DEFAULT_WORKSPACE_SYMBOLS_LIMIT = 50;

/** Maximum completions to return */
export const MAX_COMPLETIONS = 50;

/** Default completions limit */
export const DEFAULT_COMPLETIONS_LIMIT = 20;

// ============================================================================
// Symbol Kind Names (for human-readable output)
// ============================================================================

export const SYMBOL_KIND_NAMES: Record<number, string> = {
  1: 'File',
  2: 'Module',
  3: 'Namespace',
  4: 'Package',
  5: 'Class',
  6: 'Method',
  7: 'Property',
  8: 'Field',
  9: 'Constructor',
  10: 'Enum',
  11: 'Interface',
  12: 'Function',
  13: 'Variable',
  14: 'Constant',
  15: 'String',
  16: 'Number',
  17: 'Boolean',
  18: 'Array',
  19: 'Object',
  20: 'Key',
  21: 'Null',
  22: 'EnumMember',
  23: 'Struct',
  24: 'Event',
  25: 'Operator',
  26: 'TypeParameter',
};

// ============================================================================
// Completion Item Kind Names
// ============================================================================

export const COMPLETION_KIND_NAMES: Record<number, string> = {
  1: 'Text',
  2: 'Method',
  3: 'Function',
  4: 'Constructor',
  5: 'Field',
  6: 'Variable',
  7: 'Class',
  8: 'Interface',
  9: 'Module',
  10: 'Property',
  11: 'Unit',
  12: 'Value',
  13: 'Enum',
  14: 'Keyword',
  15: 'Snippet',
  16: 'Color',
  17: 'File',
  18: 'Reference',
  19: 'Folder',
  20: 'EnumMember',
  21: 'Constant',
  22: 'Struct',
  23: 'Event',
  24: 'Operator',
  25: 'TypeParameter',
};

// ============================================================================
// Diagnostic Severity Names
// ============================================================================

export const DIAGNOSTIC_SEVERITY_NAMES: Record<number, 'error' | 'warning' | 'info' | 'hint'> = {
  1: 'error',
  2: 'warning',
  3: 'info',
  4: 'hint',
};

// ============================================================================
// Environment Variables
// ============================================================================

export const ENV = {
  CONFIG_PATH: 'LSP_CONFIG_PATH',
  WORKSPACE_ROOT: 'LSP_WORKSPACE_ROOT',
  LOG_LEVEL: 'LSP_LOG_LEVEL',
} as const;
