import type {
  ConnectionManager as IConnectionManager,
  LSPClient,
  LSPServerConfig,
  ServerInstance,
  Config,
} from '../types.js';
import { LSPError, LSPErrorCode } from '../types.js';
import { LSPClientImpl, createLSPClient } from './lsp-client.js';
import { logger } from '../utils/logger.js';
import { getExtension, normalizePath } from '../utils/uri.js';
import { findWorkspaceRootForLanguage, createServerKey, parseServerKey } from '../utils/workspace.js';
import {
  MAX_RESTART_ATTEMPTS,
  RESTART_WINDOW_MS,
  RESTART_BASE_DELAY_MS,
  DEFAULT_CONFIG,
} from '../constants.js';

interface RestartInfo {
  count: number;
  timestamps: number[];
}

/**
 * Manages multiple LSP client instances, routing requests to the appropriate
 * server based on file language and workspace root.
 */
export class ConnectionManagerImpl implements IConnectionManager {
  private servers = new Map<string, ServerInstance>();
  private restartInfo = new Map<string, RestartInfo>();
  private idleTimers = new Map<string, NodeJS.Timeout>();
  private initLocks = new Map<string, Promise<LSPClient>>();

  constructor(private readonly config: Config = DEFAULT_CONFIG) {}

  /**
   * Get or create a client for a file path.
   */
  async getClientForFile(filePath: string): Promise<LSPClient> {
    const normalizedPath = normalizePath(filePath);
    const ext = getExtension(normalizedPath);

    // Find the server config for this file extension
    const serverConfig = this.config.servers.find(s =>
      s.extensions.includes(ext)
    );

    if (!serverConfig) {
      throw new LSPError(
        LSPErrorCode.UNSUPPORTED_LANGUAGE,
        `No language server configured for ${ext} files`,
        'Add a server configuration for this file type or check the file extension.',
        { file_path: normalizedPath }
      );
    }

    // Detect workspace root
    const workspaceRoot = await findWorkspaceRootForLanguage(
      normalizedPath,
      serverConfig.rootPatterns
    );

    return this.getClient(serverConfig.id, workspaceRoot);
  }

  /**
   * Get or create a client by explicit language and workspace root.
   */
  async getClient(serverId: string, workspaceRoot: string): Promise<LSPClient> {
    const normalizedRoot = normalizePath(workspaceRoot);
    const key = createServerKey(serverId, normalizedRoot);

    // Check if there's already an initialization in progress
    const existingLock = this.initLocks.get(key);
    if (existingLock) {
      return existingLock;
    }

    // Check if server is already running
    const existing = this.servers.get(key);
    if (existing?.client && existing.status === 'running') {
      this.resetIdleTimer(key);
      return existing.client;
    }

    // Start the server
    const initPromise = this.startServerInternal(serverId, normalizedRoot, key);
    this.initLocks.set(key, initPromise);

    try {
      return await initPromise;
    } finally {
      this.initLocks.delete(key);
    }
  }

  /**
   * Manually start a language server.
   */
  async startServer(serverId: string, workspaceRoot: string): Promise<LSPClient> {
    return this.getClient(serverId, workspaceRoot);
  }

  /**
   * Stop a language server.
   */
  async stopServer(serverId: string, workspaceRoot?: string): Promise<void> {
    if (workspaceRoot) {
      // Stop specific instance
      const key = createServerKey(serverId, normalizePath(workspaceRoot));
      await this.stopServerByKey(key);
    } else {
      // Stop all instances of this server type
      const keysToStop: string[] = [];
      for (const key of this.servers.keys()) {
        const { serverId: id } = parseServerKey(key);
        if (id === serverId) {
          keysToStop.push(key);
        }
      }
      await Promise.all(keysToStop.map(key => this.stopServerByKey(key)));
    }
  }

  /**
   * Stop all language servers.
   */
  async shutdownAll(): Promise<void> {
    const keys = [...this.servers.keys()];
    await Promise.all(keys.map(key => this.stopServerByKey(key)));
  }

  /**
   * List all active servers.
   */
  listActiveServers(): ServerInstance[] {
    return [...this.servers.values()];
  }

  /**
   * Detect workspace root for a file path.
   */
  detectWorkspaceRoot(filePath: string, serverId?: string): string {
    const normalizedPath = normalizePath(filePath);
    const ext = getExtension(normalizedPath);

    // Find server config (currently unused, but reserved for future root pattern detection)
    let _serverConfig: LSPServerConfig | undefined;

    if (serverId) {
      _serverConfig = this.config.servers.find(s => s.id === serverId);
    } else {
      _serverConfig = this.config.servers.find(s => s.extensions.includes(ext));
    }

    // This is sync, but we return a promise-based version from the interface
    // For now, just return the file's directory as a fallback
    // The actual detection happens in getClientForFile
    // TODO: Use _serverConfig.rootPatterns for better workspace detection
    return normalizedPath;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async startServerInternal(
    serverId: string,
    workspaceRoot: string,
    key: string
  ): Promise<LSPClient> {
    const serverConfig = this.config.servers.find(s => s.id === serverId);
    if (!serverConfig) {
      throw new LSPError(
        LSPErrorCode.SERVER_NOT_FOUND,
        `No server configuration found for: ${serverId}`,
        'Add a server configuration for this language in the config file.',
        { server_id: serverId }
      );
    }

    // Create server instance record
    const instance: ServerInstance = {
      id: serverId,
      workspaceRoot,
      status: 'starting',
      client: null,
      pid: null,
      startTime: null,
      restartCount: 0,
      lastError: null,
    };
    this.servers.set(key, instance);

    try {
      // Create and initialize client
      const client = createLSPClient(serverConfig, this.config.requestTimeout);
      await client.initialize(workspaceRoot);

      // Update instance
      instance.status = 'running';
      instance.client = client;
      instance.pid = (client as LSPClientImpl).getPid();
      instance.startTime = Date.now();

      // Set up event handlers
      this.setupClientHandlers(key, client, serverConfig);

      // Start idle timer
      this.resetIdleTimer(key);

      logger.info(`Started language server: ${serverId}`, {
        workspaceRoot,
        pid: instance.pid,
      });

      return client;
    } catch (error) {
      instance.status = 'crashed';
      instance.lastError = error instanceof Error ? error.message : String(error);

      // Try to restart if appropriate
      if (this.shouldRestart(key)) {
        logger.warn(`Attempting to restart server: ${serverId}`, { error });
        return this.restartServer(key, serverConfig, workspaceRoot);
      }

      throw error;
    }
  }

  private setupClientHandlers(
    key: string,
    client: LSPClient,
    config: LSPServerConfig
  ): void {
    // Handle server exit
    client.onExit((code) => {
      const instance = this.servers.get(key);
      if (instance) {
        instance.status = code === 0 ? 'stopped' : 'crashed';

        if (code !== 0 && this.shouldRestart(key)) {
          logger.warn(`Server crashed, restarting: ${config.id}`, { code });
          this.restartServer(key, config, instance.workspaceRoot).catch(err => {
            logger.error(`Failed to restart server: ${config.id}`, err);
          });
        }
      }
    });

    // Handle server errors
    client.onError((error) => {
      const instance = this.servers.get(key);
      if (instance) {
        instance.lastError = error.message;
      }
      logger.error(`Server error: ${config.id}`, error);
    });
  }

  private shouldRestart(key: string): boolean {
    const now = Date.now();
    let info = this.restartInfo.get(key);

    if (!info) {
      info = { count: 0, timestamps: [] };
      this.restartInfo.set(key, info);
    }

    // Remove old timestamps outside the window
    info.timestamps = info.timestamps.filter(
      t => now - t < RESTART_WINDOW_MS
    );

    // Check if we've exceeded max restarts
    return info.timestamps.length < MAX_RESTART_ATTEMPTS;
  }

  private async restartServer(
    key: string,
    config: LSPServerConfig,
    workspaceRoot: string
  ): Promise<LSPClient> {
    // Record restart attempt
    const info = this.restartInfo.get(key) ?? { count: 0, timestamps: [] };
    info.count++;
    info.timestamps.push(Date.now());
    this.restartInfo.set(key, info);

    // Update instance
    const instance = this.servers.get(key);
    if (instance) {
      instance.restartCount = info.count;
    }

    // Exponential backoff delay
    const delay = RESTART_BASE_DELAY_MS * Math.pow(2, info.timestamps.length - 1);
    await new Promise(resolve => setTimeout(resolve, delay));

    // Clean up old client
    if (instance?.client) {
      try {
        instance.client.exit();
      } catch {
        // Ignore cleanup errors
      }
    }

    // Start new server
    return this.startServerInternal(config.id, workspaceRoot, key);
  }

  private async stopServerByKey(key: string): Promise<void> {
    const instance = this.servers.get(key);
    if (!instance) return;

    // Clear idle timer
    const timer = this.idleTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(key);
    }

    instance.status = 'stopping';

    if (instance.client) {
      try {
        await instance.client.shutdown();
        instance.client.exit();
      } catch (error) {
        logger.warn(`Error stopping server: ${instance.id}`, error);
        // Force kill if graceful shutdown fails
        instance.client.exit();
      }
    }

    instance.status = 'stopped';
    instance.client = null;
    this.servers.delete(key);

    logger.info(`Stopped language server: ${instance.id}`, {
      workspaceRoot: instance.workspaceRoot,
    });
  }

  private resetIdleTimer(key: string): void {
    // Clear existing timer
    const existingTimer = this.idleTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer
    const timer = setTimeout(() => {
      logger.info(`Idle timeout, stopping server`, { key });
      this.stopServerByKey(key).catch(err => {
        logger.error(`Error stopping idle server`, err);
      });
    }, this.config.idleTimeout);

    this.idleTimers.set(key, timer);
  }
}

/**
 * Create a connection manager instance.
 */
export function createConnectionManager(config?: Config): IConnectionManager {
  return new ConnectionManagerImpl(config);
}
