/**
 * Copyright (c) 2026 Ivan Iraci <ivan.iraci@professioneit.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

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
  DidSaveTextDocumentNotification,
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
  CodeActionRequest,
  DocumentFormattingRequest,
  CallHierarchyPrepareRequest,
  CallHierarchyIncomingCallsRequest,
  CallHierarchyOutgoingCallsRequest,
  TypeHierarchyPrepareRequest,
  TypeHierarchySupertypesRequest,
  TypeHierarchySubtypesRequest,
  DocumentHighlightRequest,
  InlayHintRequest,
  SelectionRangeRequest,
  FoldingRangeRequest,
  DidDeleteFilesNotification,
  WorkDoneProgressCreateRequest,
  type TextDocumentPositionParams,
  type ReferenceParams,
  type DocumentSymbolParams,
  type WorkspaceSymbolParams,
  type CompletionParams,
  type RenameParams,
  type CodeActionParams,
  type DocumentFormattingParams,
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
  type CodeAction,
  type Command,
  type CodeActionKind,
  type CallHierarchyItem,
  type CallHierarchyIncomingCall,
  type CallHierarchyOutgoingCall,
  type TypeHierarchyItem,
  type TextEdit,
  type FormattingOptions,
  type DocumentHighlight,
  type InlayHint,
  type InlayHintParams,
  type SelectionRange,
  type SelectionRangeParams,
  type FoldingRange,
  type FoldingRangeParams,
} from 'vscode-languageserver-protocol';

import type { LSPClient as ILSPClient, LSPServerConfig } from '../types.js';
import { LSPError, LSPErrorCode } from '../types.js';
import { logger } from '../utils/logger.js';
import { pathToUri } from '../utils/uri.js';
import { getWorkspaceSettings } from '../config/workspace-settings.js';
import {
  WorkspaceConfigurationBridge,
  type WorkspaceConfigurationConnection,
} from './workspace-configuration.js';

// Minimal structural type for the JSON-RPC connection, kept local so the
// heterogeneous request wrapper does not expose vscode-jsonrpc generics across
// the codebase.
interface MessageConnection extends WorkspaceConfigurationConnection {
  listen(): void;
  dispose(): void;
  sendRequest(type: unknown, params: unknown, token?: unknown): Promise<unknown>;
  sendNotification(type: unknown, params?: unknown): void;
  onNotification(type: unknown, handler: (params: unknown) => void): void;
  onNotification(handler: (method: string, params: unknown) => void): void;
  onRequest(type: unknown, handler: (params: never) => unknown): unknown;
  onUnhandledProgress(handler: (params: { token: string | number; value: unknown }) => void): unknown;
}

// IMPORTANT: import the JSON-RPC connection primitives from vscode-languageserver-protocol,
// NOT directly from vscode-jsonrpc. They must originate from the SAME vscode-jsonrpc instance
// that defines the request types (InitializeRequest, etc.). vscode-jsonrpc identifies a
// request's parameter structure via singleton objects (ParameterStructures.byName) compared by
// reference. If the connection and the request types come from two different vscode-jsonrpc
// copies (which npm installs when version ranges diverge), those singletons differ by identity
// and `initialize` fails with "Unknown parameter structure byName". Sourcing both from the
// protocol package guarantees a single instance. (We deliberately do NOT declare a direct
// vscode-jsonrpc dependency in package.json for the same reason.)
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  CancellationTokenSource,
} from 'vscode-languageserver-protocol/node';

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
  /** Work-done progress tokens the server has open, with the time each started */
  private activeProgress = new Map<string | number, number>();
  /** When diagnostics were last published for each URI */
  private diagnosticsPublishedAt = new Map<string, number>();

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
        cwd: this._workspaceRoot,
        shell: false,
      });
    } catch (_error) {
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
    this.registerProgressTracking(this.connection);

    const workspaceSettings = getWorkspaceSettings(
      this.config.workspaceConfigurations,
      rootUri,
    );
    const workspaceConfigurationBridge = workspaceSettings
      ? new WorkspaceConfigurationBridge(rootUri, workspaceSettings)
      : undefined;
    workspaceConfigurationBridge?.register(this.connection);

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
        window: {
          workDoneProgress: true,
        },
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
          codeAction: {
            dynamicRegistration: false,
            codeActionLiteralSupport: {
              codeActionKind: {
                valueSet: [
                  'quickfix',
                  'refactor',
                  'refactor.extract',
                  'refactor.inline',
                  'refactor.rewrite',
                  'source',
                  'source.organizeImports',
                  'source.fixAll',
                ],
              },
            },
            resolveSupport: {
              properties: ['edit'],
            },
          },
          callHierarchy: {
            dynamicRegistration: false,
          },
          typeHierarchy: {
            dynamicRegistration: false,
          },
          formatting: {
            dynamicRegistration: false,
          },
          documentHighlight: {
            dynamicRegistration: false,
          },
          inlayHint: {
            dynamicRegistration: false,
          },
          selectionRange: {
            dynamicRegistration: false,
          },
          foldingRange: {
            dynamicRegistration: false,
            rangeLimit: 5000,
            lineFoldingOnly: false,
          },
        },
        workspace: {
          workspaceFolders: true,
          fileOperations: {
            didDelete: true,
          },
          ...(workspaceConfigurationBridge
            ? {
                configuration: true,
              }
            : {}),
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
      const result = await this.initializeOrFail(initParams);

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
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (error instanceof LSPError && error.code === LSPErrorCode.SERVER_TIMEOUT) {
        throw new LSPError(
          LSPErrorCode.SERVER_TIMEOUT,
          `Language server did not answer initialize within ${this.timeout}ms: ${this.config.id}`,
          'Check the server command and arguments; some servers need a flag such as --stdio to use stdio.',
          { server_id: this.config.id }
        );
      }
      throw new LSPError(
        LSPErrorCode.SERVER_START_FAILED,
        `Failed to initialize language server: ${this.config.id}: ${errorMessage}`,
        'Check that the language server is installed correctly and supports the LSP protocol.',
        { server_id: this.config.id, original_error: errorMessage }
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

  didSave(uri: string): void {
    this.ensureConnection();
    this.connection!.sendNotification(DidSaveTextDocumentNotification.type, {
      textDocument: { uri } as TextDocumentIdentifier,
    });
  }

  /**
   * Wait until the server publishes diagnostics for `uri` at or after `since`.
   * Returns false if none arrive within `maxMs`.
   */
  async waitForDiagnostics(uri: string, since: number, maxMs: number): Promise<boolean> {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      if ((this.diagnosticsPublishedAt.get(uri) ?? 0) >= since) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return false;
  }

  didDeleteFiles(uris: string[]): void {
    // Only servers that registered interest in deletions get the notification
    if (uris.length === 0 || !this._capabilities.workspace?.fileOperations?.didDelete) {
      return;
    }
    this.ensureConnection();
    this.connection!.sendNotification(DidDeleteFilesNotification.type, {
      files: uris.map((uri) => ({ uri })),
    });
    for (const uri of uris) {
      this.diagnosticsCache.delete(uri);
    }
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
    // prepareRename is optional. Per LSP spec, renameProvider === true means
    // rename is supported WITHOUT prepareRename. Only send prepareRename when the
    // server advertises an object with prepareProvider; otherwise the server may
    // answer MethodNotFound (-32601) and abort the rename (e.g. pylsp/rope).
    const renameProvider = this._capabilities.renameProvider;
    if (
      typeof renameProvider !== 'object' ||
      renameProvider === null ||
      !renameProvider.prepareProvider
    ) {
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
  // Code Actions
  // ============================================================================

  async codeActions(
    uri: string,
    range: Range,
    diagnostics: Diagnostic[],
    kinds?: string[]
  ): Promise<(CodeAction | Command)[] | null> {
    this.ensureCapability('codeActionProvider', 'codeAction');
    const params: CodeActionParams = {
      textDocument: { uri },
      range,
      context: {
        diagnostics,
        only: kinds as CodeActionKind[],
      },
    };
    return this.sendRequest(CodeActionRequest.type, params);
  }

  // ============================================================================
  // Call Hierarchy
  // ============================================================================

  async prepareCallHierarchy(
    uri: string,
    position: Position
  ): Promise<CallHierarchyItem[] | null> {
    this.ensureCapability('callHierarchyProvider', 'callHierarchy');
    const params: TextDocumentPositionParams = {
      textDocument: { uri },
      position,
    };
    return this.sendRequest(CallHierarchyPrepareRequest.type, params);
  }

  async callHierarchyIncomingCalls(
    item: CallHierarchyItem
  ): Promise<CallHierarchyIncomingCall[] | null> {
    this.ensureCapability('callHierarchyProvider', 'callHierarchy');
    return this.sendRequest(CallHierarchyIncomingCallsRequest.type, { item });
  }

  async callHierarchyOutgoingCalls(
    item: CallHierarchyItem
  ): Promise<CallHierarchyOutgoingCall[] | null> {
    this.ensureCapability('callHierarchyProvider', 'callHierarchy');
    return this.sendRequest(CallHierarchyOutgoingCallsRequest.type, { item });
  }

  // ============================================================================
  // Type Hierarchy
  // ============================================================================

  async prepareTypeHierarchy(
    uri: string,
    position: Position
  ): Promise<TypeHierarchyItem[] | null> {
    this.ensureCapability('typeHierarchyProvider', 'typeHierarchy');
    const params: TextDocumentPositionParams = {
      textDocument: { uri },
      position,
    };
    return this.sendRequest(TypeHierarchyPrepareRequest.type, params);
  }

  async typeHierarchySupertypes(
    item: TypeHierarchyItem
  ): Promise<TypeHierarchyItem[] | null> {
    this.ensureCapability('typeHierarchyProvider', 'typeHierarchy');
    return this.sendRequest(TypeHierarchySupertypesRequest.type, { item });
  }

  async typeHierarchySubtypes(
    item: TypeHierarchyItem
  ): Promise<TypeHierarchyItem[] | null> {
    this.ensureCapability('typeHierarchyProvider', 'typeHierarchy');
    return this.sendRequest(TypeHierarchySubtypesRequest.type, { item });
  }

  // ============================================================================
  // Document Formatting
  // ============================================================================

  async formatDocument(
    uri: string,
    options: FormattingOptions
  ): Promise<TextEdit[] | null> {
    this.ensureCapability('documentFormattingProvider', 'formatting');
    const params: DocumentFormattingParams = {
      textDocument: { uri },
      options,
    };
    return this.sendRequest(DocumentFormattingRequest.type, params);
  }

  // ============================================================================
  // Document Highlights / Inlay Hints / Selection Range / Folding Ranges
  // ============================================================================

  async documentHighlight(
    uri: string,
    position: Position,
  ): Promise<DocumentHighlight[] | null> {
    this.ensureCapability('documentHighlightProvider', 'documentHighlight');
    const params: TextDocumentPositionParams = {
      textDocument: { uri },
      position,
    };
    return this.sendRequest(DocumentHighlightRequest.type, params);
  }

  async inlayHints(uri: string, range: Range): Promise<InlayHint[] | null> {
    this.ensureCapability('inlayHintProvider', 'inlayHint');
    const params: InlayHintParams = {
      textDocument: { uri },
      range,
    };
    return this.sendRequest(InlayHintRequest.type, params);
  }

  async selectionRange(
    uri: string,
    positions: Position[],
  ): Promise<SelectionRange[] | null> {
    this.ensureCapability('selectionRangeProvider', 'selectionRange');
    const params: SelectionRangeParams = {
      textDocument: { uri },
      positions,
    };
    return this.sendRequest(SelectionRangeRequest.type, params);
  }

  async foldingRanges(uri: string): Promise<FoldingRange[] | null> {
    this.ensureCapability('foldingRangeProvider', 'foldingRange');
    const params: FoldingRangeParams = {
      textDocument: { uri },
    };
    return this.sendRequest(FoldingRangeRequest.type, params);
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
        this.diagnosticsPublishedAt.set(p.uri, Date.now());
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
    return this.sendRequestWithTimeout<R>(type, params);
  }

  /**
   * Send a request with the configured timeout. Unlike sendRequest, this does
   * not require the server to be initialized, so initialize itself can use it.
   */
  private async sendRequestWithTimeout<R>(
    type: { method: string },
    params: unknown
  ): Promise<R> {
    if (!this.connection) {
      throw new LSPError(
        LSPErrorCode.SERVER_NOT_READY,
        'Language server connection is not open',
        'Start the server first.',
        { server_id: this.config.id }
      );
    }

    const id = this._nextRequestId++;
    const tokenSource = new CancellationTokenSource();
    this.pendingRequests.set(id, tokenSource);

    let timeoutId: NodeJS.Timeout | undefined;

    try {
      // Create a promise that rejects on timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
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
      // Clear timeout to prevent timer leak
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
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

  /**
   * Send the initialize request, failing on timeout or if the server process
   * exits first, instead of waiting forever for a server that never answers.
   */
  private async initializeOrFail(initParams: InitializeParams): Promise<InitializeResult> {
    const proc = this.process;
    let onExit: ((code: number | null) => void) | undefined;
    const exited = new Promise<never>((_, reject) => {
      onExit = (code) => reject(new Error(`Language server exited during initialization (exit code ${code})`));
      proc?.once('exit', onExit);
    });
    exited.catch(() => {});

    try {
      return await Promise.race([
        this.sendRequestWithTimeout<InitializeResult>(InitializeRequest.type, initParams),
        exited,
      ]);
    } finally {
      if (onExit) {
        proc?.off('exit', onExit);
      }
    }
  }

  /**
   * Track work-done progress the server reports (e.g. project loading or
   * indexing), so callers can wait for work triggered by opening a document.
   */
  private registerProgressTracking(connection: MessageConnection): void {
    connection.onRequest(WorkDoneProgressCreateRequest.type, (params: { token: string | number }) => {
      this.activeProgress.set(params.token, Date.now());
      return null;
    });

    connection.onUnhandledProgress(({ token, value }) => {
      const kind = (value as { kind?: string } | undefined)?.kind;
      if (kind === 'begin' && !this.activeProgress.has(token)) {
        this.activeProgress.set(token, Date.now());
      } else if (kind === 'end') {
        this.activeProgress.delete(token);
      }
    });
  }

  /**
   * Wait until work the server started at or after `since` has finished.
   *
   * Always waits at least `windowMs` after `since`, so progress the server
   * starts shortly after a didOpen is seen, and never longer than `maxMs`.
   * Progress that began before `since` (e.g. long-running background
   * indexing) is ignored.
   */
  async waitForServerWork(since: number, windowMs: number, maxMs: number): Promise<void> {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      const busy = [...this.activeProgress.values()].some((startedAt) => startedAt >= since);
      if (!busy && Date.now() - since >= windowMs) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    logger.debug(`Stopped waiting for server work after ${maxMs}ms: ${this.config.id}`);
  }

  private cleanup(): void {
    // Cancel pending requests, unless the process is already gone: cancelling
    // then makes vscode-jsonrpc log "Connection is closed" errors.
    const processAlive = this.process !== null && this.process.exitCode === null && this.process.signalCode === null;
    if (processAlive) {
      for (const tokenSource of this.pendingRequests.values()) {
        tokenSource.cancel();
      }
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
