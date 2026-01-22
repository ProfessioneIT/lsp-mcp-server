import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import {
  InitializeRequest,
  InitializeParams,
  InitializedNotification,
  ShutdownRequest,
  ExitNotification,
  DidOpenTextDocumentNotification,
  DidChangeTextDocumentNotification,
  DidCloseTextDocumentNotification,
  DefinitionRequest,
  TypeDefinitionRequest,
  ReferencesRequest,
  ImplementationRequest,
  HoverRequest,
  SignatureHelpRequest,
  DocumentSymbolRequest,
  WorkspaceSymbolRequest,
  CompletionRequest,
  PrepareRenameRequest,
  RenameRequest,
  PublishDiagnosticsNotification,
  type TextDocumentPositionParams,
  type ReferenceParams,
  type DocumentSymbolParams,
  type WorkspaceSymbolParams,
  type CompletionParams,
  type RenameParams,
  type ServerCapabilities,
  type InitializeResult,
  type TextDocumentItem,
  type TextDocumentContentChangeEvent,
  type Position,
  type Location,
  type LocationLink,
  type Hover,
  type SignatureHelp,
  type DocumentSymbol,
  type SymbolInformation,
  type WorkspaceSymbol,
  type CompletionList,
  type CompletionItem,
  type WorkspaceEdit,
  type Diagnostic,
  type Range,
  type TextDocumentIdentifier,
  type VersionedTextDocumentIdentifier,
} from 'vscode-languageserver-protocol';

import type { LSPClient as ILSPClient, LSPServerConfig } from '../types.js';
import { LSPError, LSPErrorCode } from '../types.js';
import { logger } from '../utils/logger.js';
import { pathToUri } from '../utils/uri.js';

// We'll use dynamic imports for vscode-jsonrpc since it has module resolution issues
// This will be resolved when npm install is run
type MessageConnection = {
  listen(): void;
  dispose(): void;
  sendRequest(type: unknown, params: unknown, token?: unknown): Promise<unknown>;
  sendNotification(type: unknown, params?: unknown): void;
  onNotification(type: unknown, handler: (params: unknown) => void): void;
  onNotification(handler: (method: string, params: unknown) => void): void;
};

// Import jsonrpc types and functions
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  CancellationTokenSource,
} from 'vscode-jsonrpc/node.js';

type DiagnosticsHandler = (uri: string, diagnostics: Diagnostic[]) => void;
type ErrorHandler = (error: Error) => void;
type ExitHandler = (code: number | null) => void;

/**
 * LSP Client implementation that wraps communication with a language server.
 */
export class LSPClientImpl implements ILSPClient {
  private process: ChildProcess | null = null;
  private connection: MessageConnection | null = null;
  private _capabilities: ServerCapabilities = {};
  private _isInitialized = false;
  private _workspaceRoot: string = '';
  private pendingRequests = new Map<number | string, CancellationTokenSource>();
  private diagnosticsCache = new Map<string, Diagnostic[]>();
  private diagnosticsHandlers: DiagnosticsHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private exitHandlers: ExitHandler[] = [];
  private _nextRequestId = 1;

  constructor(
    private readonly config: LSPServerConfig,
    private readonly timeout: number = 30000
  ) {}

  get capabilities(): ServerCapabilities {
    return this._capabilities;
  }

  get isInitialized(): boolean {
    return this._isInitialized;
  }

  get workspaceRoot(): string {
    return this._workspaceRoot;
  }

  get serverId(): string {
    return this.config.id;
  }

  /**
   * Initialize the language server.
   */
  async initialize(rootUri: string): Promise<InitializeResult> {
    if (this._isInitialized) {
      throw new LSPError(
        LSPErrorCode.SERVER_START_FAILED,
        'Server is already initialized',
        'Create a new client instance for a new initialization.'
      );
    }

    this._workspaceRoot = rootUri;

    // Spawn the language server process
    try {
      this.process = spawn(this.config.command, this.config.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...this.config.env },
        shell: false,
      });
    } catch (error) {
      throw new LSPError(
        LSPErrorCode.SERVER_NOT_FOUND,
        `Failed to start language server: ${this.config.command}`,
        `Install it with: ${this.getInstallCommand()}`,
        { server_id: this.config.id, install_command: this.getInstallCommand() }
      );
    }

    if (!this.process.stdin || !this.process.stdout) {
      throw new LSPError(
        LSPErrorCode.SERVER_START_FAILED,
        'Failed to establish stdio connection with language server',
        'Check that the language server supports stdio transport.'
      );
    }

    // Set up JSON-RPC connection
    const reader = new StreamMessageReader(this.process.stdout);
    const writer = new StreamMessageWriter(this.process.stdin);
    this.connection = createMessageConnection(reader, writer) as MessageConnection;

    // Handle process events
    this.process.on('error', (error) => {
      logger.error(`Language server process error: ${this.config.id}`, error);
      this.notifyError(error);
    });

    this.process.on('exit', (code) => {
      logger.info(`Language server exited: ${this.config.id}`, { code });
      this._isInitialized = false;
      this.notifyExit(code);
    });

    // Handle stderr for logging
    if (this.process.stderr) {
      this.process.stderr.on('data', (data: Buffer) => {
        logger.debug(`[${this.config.id}] stderr: ${data.toString()}`);
      });
    }

    // Set up notification handlers
    this.setupNotificationHandlers();

    // Start the connection
    this.connection.listen();

    // Send initialize request
    const initParams: InitializeParams = {
      processId: process.pid,
      rootUri: pathToUri(rootUri),
      capabilities: {
        textDocument: {
          synchronization: {
            dynamicRegistration: false,
            willSave: false,
            willSaveWaitUntil: false,
            didSave: true,
          },
          completion: {
            dynamicRegistration: false,
            completionItem: {
              snippetSupport: true,
              documentationFormat: ['markdown', 'plaintext'],
            },
          },
          hover: {
            dynamicRegistration: false,
            contentFormat: ['markdown', 'plaintext'],
          },
          signatureHelp: {
            dynamicRegistration: false,
            signatureInformation: {
              documentationFormat: ['markdown', 'plaintext'],
            },
          },
          definition: { dynamicRegistration: false },
          typeDefinition: { dynamicRegistration: false },
          implementation: { dynamicRegistration: false },
          references: { dynamicRegistration: false },
          documentSymbol: {
            dynamicRegistration: false,
            hierarchicalDocumentSymbolSupport: true,
          },
          rename: {
            dynamicRegistration: false,
            prepareSupport: true,
          },
          publishDiagnostics: {
            relatedInformation: true,
          },
        },
        workspace: {
          workspaceFolders: true,
          symbol: {
            dynamicRegistration: false,
          },
        },
      },
      initializationOptions: this.config.initializationOptions,
      workspaceFolders: [
        {
          uri: pathToUri(rootUri),
          name: rootUri.split('/').pop() ?? 'workspace',
        },
      ],
    };

    try {
      const result = await this.connection.sendRequest(
        InitializeRequest.type,
        initParams
      ) as InitializeResult;

      this._capabilities = result.capabilities;
      this._isInitialized = true;

      // Send initialized notification
      this.connection.sendNotification(InitializedNotification.type, {});

      logger.info(`Language server initialized: ${this.config.id}`, {
        rootUri,
        capabilities: Object.keys(result.capabilities),
      });

      return result;
    } catch (error) {
      this.cleanup();
      throw new LSPError(
        LSPErrorCode.SERVER_START_FAILED,
        `Failed to initialize language server: ${this.config.id}`,
        'Check that the language server is installed correctly and supports the LSP protocol.',
        { server_id: this.config.id }
      );
    }
  }

  /**
   * Shutdown the language server gracefully.
   */
  async shutdown(): Promise<void> {
    if (!this.connection || !this._isInitialized) {
      return;
    }

    try {
      await this.connection.sendRequest(ShutdownRequest.type, undefined);
      this._isInitialized = false;
    } catch (error) {
      logger.warn(`Error during shutdown: ${this.config.id}`, error);
    }
  }

  /**
   * Exit the language server process.
   */
  exit(): void {
    if (this.connection) {
      try {
        this.connection.sendNotification(ExitNotification.type);
      } catch {
        // Ignore errors during exit
      }
    }
    this.cleanup();
  }

  // ============================================================================
  // Document Sync
  // ============================================================================

  didOpen(document: TextDocumentItem): void {
    this.ensureConnection();
    this.connection!.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: document,
    });
  }

  didChange(
    uri: string,
    version: number,
    changes: TextDocumentContentChangeEvent[]
  ): void {
    this.ensureConnection();
    const params = {
      textDocument: { uri, version } as VersionedTextDocumentIdentifier,
      contentChanges: changes,
    };
    this.connection!.sendNotification(DidChangeTextDocumentNotification.type, params);
  }

  didClose(uri: string): void {
    this.ensureConnection();
    this.connection!.sendNotification(DidCloseTextDocumentNotification.type, {
      textDocument: { uri } as TextDocumentIdentifier,
    });
    // Clear cached diagnostics for this document
    this.diagnosticsCache.delete(uri);
  }

  // ============================================================================
  // Language Features
  // ============================================================================

  async definition(
    uri: string,
    position: Position
  ): Promise<Location | Location[] | LocationLink[] | null> {
    this.ensureCapability('definitionProvider', 'definition');
    const params: TextDocumentPositionParams = {
      textDocument: { uri },
      position,
    };
    return this.sendRequest(DefinitionRequest.type, params);
  }

  async typeDefinition(
    uri: string,
    position: Position
  ): Promise<Location | Location[] | LocationLink[] | null> {
    this.ensureCapability('typeDefinitionProvider', 'typeDefinition');
    const params: TextDocumentPositionParams = {
      textDocument: { uri },
      position,
    };
    return this.sendRequest(TypeDefinitionRequest.type, params);
  }

  async references(
    uri: string,
    position: Position,
    includeDeclaration: boolean
  ): Promise<Location[] | null> {
    this.ensureCapability('referencesProvider', 'references');
    const params: ReferenceParams = {
      textDocument: { uri },
      position,
      context: { includeDeclaration },
    };
    return this.sendRequest(ReferencesRequest.type, params);
  }

  async implementation(
    uri: string,
    position: Position
  ): Promise<Location | Location[] | LocationLink[] | null> {
    this.ensureCapability('implementationProvider', 'implementation');
    const params: TextDocumentPositionParams = {
      textDocument: { uri },
      position,
    };
    return this.sendRequest(ImplementationRequest.type, params);
  }

  async hover(uri: string, position: Position): Promise<Hover | null> {
    this.ensureCapability('hoverProvider', 'hover');
    const params: TextDocumentPositionParams = {
      textDocument: { uri },
      position,
    };
    return this.sendRequest(HoverRequest.type, params);
  }

  async signatureHelp(
    uri: string,
    position: Position
  ): Promise<SignatureHelp | null> {
    this.ensureCapability('signatureHelpProvider', 'signatureHelp');
    const params: TextDocumentPositionParams = {
      textDocument: { uri },
      position,
    };
    return this.sendRequest(SignatureHelpRequest.type, params);
  }

  async documentSymbols(
    uri: string
  ): Promise<DocumentSymbol[] | SymbolInformation[] | null> {
    this.ensureCapability('documentSymbolProvider', 'documentSymbol');
    const params: DocumentSymbolParams = {
      textDocument: { uri },
    };
    return this.sendRequest(DocumentSymbolRequest.type, params);
  }

  async workspaceSymbols(
    query: string
  ): Promise<SymbolInformation[] | WorkspaceSymbol[] | null> {
    this.ensureCapability('workspaceSymbolProvider', 'workspaceSymbol');
    const params: WorkspaceSymbolParams = { query };
    return this.sendRequest(WorkspaceSymbolRequest.type, params);
  }

  async completion(
    uri: string,
    position: Position
  ): Promise<CompletionList | CompletionItem[] | null> {
    this.ensureCapability('completionProvider', 'completion');
    const params: CompletionParams = {
      textDocument: { uri },
      position,
    };
    return this.sendRequest(CompletionRequest.type, params);
  }

  async prepareRename(
    uri: string,
    position: Position
  ): Promise<Range | { range: Range; placeholder: string } | null> {
    // prepareRename is optional - check if supported
    if (!this._capabilities.renameProvider ||
        (typeof this._capabilities.renameProvider === 'object' &&
         !this._capabilities.renameProvider.prepareProvider)) {
      // Not supported, return null to indicate rename should proceed without prepare
      return null;
    }

    const params: TextDocumentPositionParams = {
      textDocument: { uri },
      position,
    };
    return this.sendRequest(PrepareRenameRequest.type, params);
  }

  async rename(
    uri: string,
    position: Position,
    newName: string
  ): Promise<WorkspaceEdit | null> {
    this.ensureCapability('renameProvider', 'rename');
    const params: RenameParams = {
      textDocument: { uri },
      position,
      newName,
    };
    return this.sendRequest(RenameRequest.type, params);
  }

  // ============================================================================
  // Request Management
  // ============================================================================

  cancelRequest(id: number | string): void {
    const tokenSource = this.pendingRequests.get(id);
    if (tokenSource) {
      tokenSource.cancel();
      this.pendingRequests.delete(id);
    }
  }

  // ============================================================================
  // Diagnostics
  // ============================================================================

  getCachedDiagnostics(uri: string): Diagnostic[] {
    return this.diagnosticsCache.get(uri) ?? [];
  }

  // ============================================================================
  // Event Handlers
  // ============================================================================

  onDiagnostics(handler: DiagnosticsHandler): void {
    this.diagnosticsHandlers.push(handler);
  }

  onError(handler: ErrorHandler): void {
    this.errorHandlers.push(handler);
  }

  onExit(handler: ExitHandler): void {
    this.exitHandlers.push(handler);
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private setupNotificationHandlers(): void {
    if (!this.connection) return;

    // Handle diagnostics notifications
    this.connection.onNotification(
      PublishDiagnosticsNotification.type,
      (params: unknown) => {
        const p = params as { uri: string; diagnostics: Diagnostic[] };
        this.diagnosticsCache.set(p.uri, p.diagnostics);
        for (const handler of this.diagnosticsHandlers) {
          try {
            handler(p.uri, p.diagnostics);
          } catch (error) {
            logger.error('Error in diagnostics handler', error);
          }
        }
      }
    );

    // Handle other notifications that might come from the server
    this.connection.onNotification((method: string, params: unknown) => {
      logger.debug(`Received notification: ${method}`, params);
    });
  }

  private async sendRequest<R>(
    type: { method: string },
    params: unknown
  ): Promise<R> {
    this.ensureConnection();

    const id = this._nextRequestId++;
    const tokenSource = new CancellationTokenSource();
    this.pendingRequests.set(id, tokenSource);

    try {
      // Create a promise that rejects on timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new LSPError(
            LSPErrorCode.SERVER_TIMEOUT,
            `Request timed out after ${this.timeout}ms`,
            'The language server is not responding. Try again or restart the server.',
            { server_id: this.config.id }
          ));
        }, this.timeout);
      });

      // Race the request against the timeout
      const result = await Promise.race([
        this.connection!.sendRequest(type, params, tokenSource.token),
        timeoutPromise,
      ]);

      return result as R;
    } finally {
      this.pendingRequests.delete(id);
    }
  }

  private ensureConnection(): void {
    if (!this.connection || !this._isInitialized) {
      throw new LSPError(
        LSPErrorCode.SERVER_NOT_READY,
        'Language server is not initialized',
        'Wait for the server to initialize or call startServer first.',
        { server_id: this.config.id }
      );
    }
  }

  private ensureCapability(capability: keyof ServerCapabilities, feature: string): void {
    this.ensureConnection();

    const cap = this._capabilities[capability];
    if (!cap) {
      throw new LSPError(
        LSPErrorCode.CAPABILITY_NOT_SUPPORTED,
        `Language server does not support ${feature}`,
        `The ${this.config.id} language server does not provide ${feature} capability.`,
        { server_id: this.config.id }
      );
    }
  }

  private notifyError(error: Error): void {
    for (const handler of this.errorHandlers) {
      try {
        handler(error);
      } catch (e) {
        logger.error('Error in error handler', e);
      }
    }
  }

  private notifyExit(code: number | null): void {
    for (const handler of this.exitHandlers) {
      try {
        handler(code);
      } catch (e) {
        logger.error('Error in exit handler', e);
      }
    }
  }

  private cleanup(): void {
    // Cancel all pending requests
    for (const tokenSource of this.pendingRequests.values()) {
      tokenSource.cancel();
    }
    this.pendingRequests.clear();

    // Dispose connection
    if (this.connection) {
      this.connection.dispose();
      this.connection = null;
    }

    // Kill process if still running
    if (this.process && !this.process.killed) {
      this.process.kill();
      this.process = null;
    }

    this._isInitialized = false;
  }

  private getInstallCommand(): string {
    const commands: Record<string, string> = {
      typescript: 'npm install -g typescript-language-server typescript',
      python: 'pip install python-lsp-server',
      rust: 'rustup component add rust-analyzer',
      go: 'go install golang.org/x/tools/gopls@latest',
    };
    return commands[this.config.id] ?? `Install ${this.config.command}`;
  }

  /**
   * Get the process ID of the language server.
   */
  getPid(): number | null {
    return this.process?.pid ?? null;
  }
}

/**
 * Create a new LSP client instance.
 */
export function createLSPClient(
  config: LSPServerConfig,
  timeout?: number
): ILSPClient {
  return new LSPClientImpl(config, timeout);
}
