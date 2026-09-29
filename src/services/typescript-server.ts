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

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LSPServerConfig } from '../types.js';
import { DEFAULT_SERVERS } from '../constants.js';
import { logger } from '../utils/logger.js';

/** First TypeScript major version that ships a native language server instead of tsserver */
export const NATIVE_TYPESCRIPT_MIN_MAJOR = 7;

/**
 * Find the TypeScript package a workspace uses, walking up the node_modules
 * directories like Node's module resolution (so hoisted installs in monorepos
 * are found too).
 */
export function findWorkspaceTypeScript(
  workspaceRoot: string
): { version: string; packageDir: string } | null {
  let dir = path.resolve(workspaceRoot);
  for (;;) {
    const packageDir = path.join(dir, 'node_modules', 'typescript');
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf-8')) as { version?: unknown };
      if (typeof pkg.version === 'string') {
        return { version: pkg.version, packageDir };
      }
    } catch {
      // Not installed here; keep walking up
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

/**
 * Pick the concrete server configuration for a workspace.
 *
 * TypeScript 7 no longer ships tsserver, which typescript-language-server
 * requires; instead `tsc --lsp --stdio` runs its own language server. For the
 * built-in `typescript` server, a workspace whose TypeScript is 7 or newer
 * therefore gets that server. Server configurations supplied by the user are
 * never changed.
 */
export function resolveServerConfig(config: LSPServerConfig, workspaceRoot: string): LSPServerConfig {
  if (config.id !== 'typescript' || !DEFAULT_SERVERS.includes(config)) {
    return config;
  }

  const typescript = findWorkspaceTypeScript(workspaceRoot);
  if (!typescript) {
    return config;
  }

  const major = Number.parseInt(typescript.version, 10);
  if (!(major >= NATIVE_TYPESCRIPT_MIN_MAJOR)) {
    return config;
  }

  const tscScript = path.join(typescript.packageDir, 'bin', 'tsc');
  if (!fs.existsSync(tscScript)) {
    return config;
  }

  logger.info(`Using the TypeScript ${typescript.version} native language server`, { workspaceRoot });
  // Run the package's tsc script with this Node, so PATH and the exec bit do not matter
  return { ...config, command: process.execPath, args: [tscScript, '--lsp', '--stdio'] };
}
