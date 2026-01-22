import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { Config, LSPServerConfig } from './types.js';
import { DEFAULT_CONFIG } from './constants.js';

// ============================================================================
// Default Server Configurations
// ============================================================================

/**
 * Built-in language server configurations.
 * These provide sensible defaults for common language servers.
 */
const DEFAULT_SERVERS: LSPServerConfig[] = [
  {
    id: 'typescript',
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
    languageIds: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
    command: 'typescript-language-server',
    args: ['--stdio'],
    rootPatterns: ['package.json', 'tsconfig.json', 'jsconfig.json'],
  },
  {
    id: 'python',
    extensions: ['.py', '.pyi'],
    languageIds: ['python'],
    command: 'pylsp',
    args: [],
    rootPatterns: ['pyproject.toml', 'setup.py', 'requirements.txt', '.git'],
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
    args: [],
    rootPatterns: ['go.mod', 'go.sum'],
  },
  {
    id: 'java',
    extensions: ['.java'],
    languageIds: ['java'],
    command: 'jdtls',
    args: [],
    rootPatterns: ['pom.xml', 'build.gradle', '.project'],
  },
];

// ============================================================================
// Configuration Loading
// ============================================================================

/**
 * Configuration file locations (in order of priority).
 */
function getConfigPaths(): string[] {
  const home = os.homedir();
  const xdgConfig = process.env.XDG_CONFIG_HOME ?? path.join(home, '.config');

  return [
    // Current directory
    path.join(process.cwd(), '.lsp-mcp.json'),
    path.join(process.cwd(), 'lsp-mcp.json'),
    // XDG config directory
    path.join(xdgConfig, 'lsp-mcp', 'config.json'),
    // Home directory
    path.join(home, '.lsp-mcp.json'),
  ];
}

/**
 * Try to read a JSON file.
 */
async function tryReadJson(filePath: string): Promise<unknown | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Merge server configurations.
 * User servers override built-in servers with the same ID.
 */
function mergeServers(
  builtIn: LSPServerConfig[],
  user: LSPServerConfig[]
): LSPServerConfig[] {
  const merged = new Map<string, LSPServerConfig>();

  // Add built-in servers
  for (const server of builtIn) {
    merged.set(server.id, server);
  }

  // Override/add user servers
  for (const server of user) {
    merged.set(server.id, server);
  }

  return Array.from(merged.values());
}

/**
 * Validate a server configuration.
 */
function validateServerConfig(server: unknown): server is LSPServerConfig {
  if (!server || typeof server !== 'object') {
    return false;
  }

  const s = server as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    Array.isArray(s.extensions) &&
    s.extensions.every((e) => typeof e === 'string') &&
    Array.isArray(s.languageIds) &&
    s.languageIds.every((l) => typeof l === 'string') &&
    typeof s.command === 'string' &&
    Array.isArray(s.args) &&
    s.args.every((a) => typeof a === 'string')
  );
}

/**
 * Load configuration from file or environment.
 */
export async function loadConfig(): Promise<Config> {
  const config: Config = {
    ...DEFAULT_CONFIG,
    servers: [...DEFAULT_SERVERS],
  };

  // Try to load config file
  const configPaths = getConfigPaths();
  let userConfig: Record<string, unknown> | null = null;

  for (const configPath of configPaths) {
    const loaded = await tryReadJson(configPath);
    if (loaded && typeof loaded === 'object') {
      userConfig = loaded as Record<string, unknown>;
      break;
    }
  }

  // Apply user configuration
  if (userConfig) {
    // Merge servers
    if (Array.isArray(userConfig.servers)) {
      const validServers = userConfig.servers.filter(validateServerConfig);
      config.servers = mergeServers(DEFAULT_SERVERS, validServers);
    }

    // Apply other settings
    if (typeof userConfig.requestTimeout === 'number') {
      config.requestTimeout = userConfig.requestTimeout;
    }

    if (typeof userConfig.autoStart === 'boolean') {
      config.autoStart = userConfig.autoStart;
    }

    if (typeof userConfig.logLevel === 'string') {
      const level = userConfig.logLevel as string;
      if (['debug', 'info', 'warn', 'error'].includes(level)) {
        config.logLevel = level as Config['logLevel'];
      }
    }

    if (typeof userConfig.idleTimeout === 'number') {
      config.idleTimeout = userConfig.idleTimeout;
    }
  }

  // Environment variable overrides
  if (process.env.LSP_MCP_LOG_LEVEL) {
    const level = process.env.LSP_MCP_LOG_LEVEL;
    if (['debug', 'info', 'warn', 'error'].includes(level)) {
      config.logLevel = level as Config['logLevel'];
    }
  }

  if (process.env.LSP_MCP_REQUEST_TIMEOUT) {
    const timeout = parseInt(process.env.LSP_MCP_REQUEST_TIMEOUT, 10);
    if (!isNaN(timeout) && timeout > 0) {
      config.requestTimeout = timeout;
    }
  }

  return config;
}

/**
 * Get server config by ID.
 */
export function getServerConfig(
  config: Config,
  serverId: string
): LSPServerConfig | undefined {
  return config.servers.find((s) => s.id === serverId);
}

/**
 * Find server config by file extension.
 */
export function findServerByExtension(
  config: Config,
  extension: string
): LSPServerConfig | undefined {
  return config.servers.find((s) => s.extensions.includes(extension));
}

/**
 * Find server config by language ID.
 */
export function findServerByLanguageId(
  config: Config,
  languageId: string
): LSPServerConfig | undefined {
  return config.servers.find((s) => s.languageIds.includes(languageId));
}
