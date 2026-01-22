import type {
  ServerCapabilities,
  InitializeResult,
  TextDocumentItem,
  TextDocumentContentChangeEvent,
  Position,
  Location,
  LocationLink,
  Hover,
  SignatureHelp,
  DocumentSymbol,
  SymbolInformation,
  WorkspaceSymbol,
  CompletionList,
  CompletionItem,
  WorkspaceEdit,
  Diagnostic,
  Range,
} from 'vscode-languageserver-protocol';

// Re-export LSP types we use
export type {
  ServerCapabilities,
  InitializeResult,
  TextDocumentItem,
  TextDocumentContentChangeEvent,
  Position,
  Location,
  LocationLink,
  Hover,
  SignatureHelp,
  DocumentSymbol,
  SymbolInformation,
  WorkspaceSymbol,
  CompletionList,
  CompletionItem,
  WorkspaceEdit,
  Diagnostic,
  Range,
};

// ============================================================================
// Configuration Types
// ============================================================================

export interface LSPServerConfig {
  /** Server identifier (e.g., "typescript", "python", "rust") */
  id: string;

  /** File extensions this server handles */
  extensions: string[];

  /** Language IDs (as per LSP spec) */
  languageIds: string[];

  /** Command to start the language server */
  command: string;

  /** Command arguments */
  args: string[];

  /** Environment variables */
  env?: Record<string, string>;

  /** Initialization options to pass to the server */
  initializationOptions?: Record<string, unknown>;

  /** Patterns to identify project root (e.g., ["package.json", "tsconfig.json"]) */
  rootPatterns?: string[];
}

export interface Config {
  /** Configured language servers */
  servers: LSPServerConfig[];

  /** Default timeout for LSP requests (ms) */
  requestTimeout: number;

  /** Whether to auto-start servers on first request */
  autoStart: boolean;

  /** Log level */
  logLevel: 'debug' | 'info' | 'warn' | 'error';

  /** Idle timeout before shutting down unused servers (ms) */
  idleTimeout: number;
}

// ============================================================================
// LSP Client Types
// ============================================================================

export interface LSPClient {
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
  readonly serverId: string;

  // Events
  onDiagnostics(handler: (uri: string, diagnostics: Diagnostic[]) => void): void;
  onError(handler: (error: Error) => void): void;
  onExit(handler: (code: number | null) => void): void;
}

// ============================================================================
// Connection Manager Types
// ============================================================================

export interface ServerInstance {
  id: string;
  workspaceRoot: string;
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'crashed';
  client: LSPClient | null;
  pid: number | null;
  startTime: number | null;
  restartCount: number;
  lastError: string | null;
}

export interface ConnectionManager {
  /** Get or create client for a file (detects language and workspace root) */
  getClientForFile(filePath: string): Promise<LSPClient>;

  /** Get client by explicit parameters */
  getClient(languageId: string, workspaceRoot: string): Promise<LSPClient>;

  /** Manually start a specific server */
  startServer(serverId: string, workspaceRoot: string): Promise<LSPClient>;

  /** Stop a server */
  stopServer(serverId: string, workspaceRoot?: string): Promise<void>;

  /** Stop all servers */
  shutdownAll(): Promise<void>;

  /** List active servers with their workspace roots */
  listActiveServers(): ServerInstance[];

  /** Detect workspace root for a file path */
  detectWorkspaceRoot(filePath: string, serverId?: string): string;
}

// ============================================================================
// Document Manager Types
// ============================================================================

export interface DocumentState {
  uri: string;
  content: string;
  version: number;
  languageId: string;
  openWithClients: Set<string>; // Set of client IDs
}

export interface DocumentManager {
  /** Open a document (reads from disk, sends didOpen) */
  openDocument(uri: string, client: LSPClient): Promise<void>;

  /** Ensure document is open (idempotent, thread-safe) */
  ensureOpen(uri: string, client: LSPClient): Promise<void>;

  /** Close a document */
  closeDocument(uri: string, client: LSPClient): Promise<void>;

  /** Update document content (for unsaved changes) */
  updateContent(uri: string, content: string, client: LSPClient): Promise<void>;

  /** Get current content */
  getContent(uri: string): string | undefined;

  /** Check if document is open with a specific client */
  isOpen(uri: string, client: LSPClient): boolean;

  /** Get current version for a URI */
  getVersion(uri: string): number;
}

// ============================================================================
// Diagnostics Cache Types
// ============================================================================

export interface DiagnosticsCache {
  /** Called when publishDiagnostics notification is received */
  update(uri: string, diagnostics: Diagnostic[]): void;

  /** Get cached diagnostics for a URI */
  get(uri: string): Diagnostic[];

  /** Clear diagnostics for a URI (on document close) */
  clear(uri: string): void;

  /** Clear all diagnostics (on server restart) */
  clearAll(): void;
}

// ============================================================================
// Error Types
// ============================================================================

export enum LSPErrorCode {
  // Server lifecycle errors
  SERVER_NOT_FOUND = 'SERVER_NOT_FOUND',
  SERVER_START_FAILED = 'SERVER_START_FAILED',
  SERVER_CRASHED = 'SERVER_CRASHED',
  SERVER_TIMEOUT = 'SERVER_TIMEOUT',
  SERVER_NOT_READY = 'SERVER_NOT_READY',

  // Request errors
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  FILE_NOT_READABLE = 'FILE_NOT_READABLE',
  INVALID_POSITION = 'INVALID_POSITION',
  UNSUPPORTED_LANGUAGE = 'UNSUPPORTED_LANGUAGE',
  CAPABILITY_NOT_SUPPORTED = 'CAPABILITY_NOT_SUPPORTED',
  RENAME_NOT_ALLOWED = 'RENAME_NOT_ALLOWED',

  // Protocol errors
  INVALID_RESPONSE = 'INVALID_RESPONSE',
  REQUEST_CANCELLED = 'REQUEST_CANCELLED',
}

export interface LSPErrorDetails {
  server_id?: string;
  file_path?: string;
  position?: { line: number; column: number };
  install_command?: string;
  original_error?: string;
}

export class LSPError extends Error {
  constructor(
    public readonly code: LSPErrorCode,
    message: string,
    public readonly suggestion: string,
    public readonly details?: LSPErrorDetails
  ) {
    super(message);
    this.name = 'LSPError';
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        suggestion: this.suggestion,
        details: this.details,
      },
    };
  }
}

// ============================================================================
// Tool Response Types
// ============================================================================

export interface LocationResult {
  path: string;
  line: number;
  column: number;
  end_line: number;
  end_column: number;
  context: string;
}

export interface DefinitionResponse {
  definitions: LocationResult[];
}

export interface ReferencesResponse {
  references: LocationResult[];
  total_count: number;
  returned_count: number;
  offset: number;
  has_more: boolean;
}

export interface ImplementationsResponse {
  implementations: LocationResult[];
  total_count: number;
  returned_count: number;
  has_more: boolean;
}

export interface HoverResponse {
  contents: string;
  range?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
}

export interface SignatureHelpResponse {
  signatures: Array<{
    label: string;
    documentation?: string;
    parameters?: Array<{
      label: string;
      documentation?: string;
    }>;
  }>;
  active_signature: number;
  active_parameter: number;
}

export interface SymbolResult {
  name: string;
  kind: string;
  range: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  selection_range?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  children?: SymbolResult[];
}

export interface DocumentSymbolsResponse {
  symbols: SymbolResult[];
}

export interface WorkspaceSymbolResult {
  name: string;
  kind: string;
  path: string;
  line: number;
  column: number;
  container_name?: string;
}

export interface WorkspaceSymbolsResponse {
  symbols: WorkspaceSymbolResult[];
  total_count: number;
  returned_count: number;
  has_more: boolean;
}

export interface DiagnosticResult {
  range: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  severity: 'error' | 'warning' | 'info' | 'hint';
  code?: string | number;
  source?: string;
  message: string;
  context: string;
}

export interface DiagnosticsResponse {
  diagnostics: DiagnosticResult[];
  summary: {
    errors: number;
    warnings: number;
    info: number;
    hints: number;
  };
  note: string;
}

export interface CompletionResult {
  label: string;
  kind: string;
  detail?: string;
  documentation?: string;
  insert_text?: string;
  sort_text?: string;
}

export interface CompletionsResponse {
  completions: CompletionResult[];
  is_incomplete: boolean;
}

export interface RenameEdit {
  range: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  new_text: string;
  context: string;
}

export interface RenameResponse {
  changes: Record<string, RenameEdit[]>;
  files_affected: number;
  edits_count: number;
  applied: boolean;
  original_name?: string;
}

export interface ServerStatusResult {
  id: string;
  status: string;
  pid?: number;
  workspace_root?: string;
  capabilities?: string[];
  uptime_seconds?: number;
  documents_open?: number;
  restart_count?: number;
  last_error?: string | null;
}

export interface ServerStatusResponse {
  servers: ServerStatusResult[];
}

export interface StartServerResponse {
  status: string;
  server_id: string;
  workspace_root: string;
  capabilities: string[];
}

export interface StopServerResponse {
  status: string;
  server_id: string;
  workspace_root?: string;
  was_running: boolean;
}
