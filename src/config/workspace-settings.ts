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

import * as path from 'node:path';
import type {
  WorkspaceConfigurationMap,
  WorkspaceSettings,
} from '../types.js';
import { normalizePath } from '../utils/uri.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate the JSON shape used for exact-root workspace settings.
 */
export function isWorkspaceConfigurationMap(
  value: unknown,
): value is WorkspaceConfigurationMap {
  if (!isRecord(value)) {
    return false;
  }

  const normalizedRoots = new Set<string>();
  for (const [workspaceRoot, settings] of Object.entries(value)) {
    if (!path.isAbsolute(workspaceRoot) || !isRecord(settings)) {
      return false;
    }

    const normalizedRoot = normalizePath(workspaceRoot);
    if (normalizedRoots.has(normalizedRoot)) {
      return false;
    }
    normalizedRoots.add(normalizedRoot);
  }

  return true;
}

/**
 * Select settings only when the normalized server root exactly matches a
 * configured root. Descendant matching is intentionally not used here because
 * each language-server process is owned by one exact workspace root.
 */
export function getWorkspaceSettings(
  configurations: WorkspaceConfigurationMap | undefined,
  workspaceRoot: string,
): WorkspaceSettings | undefined {
  if (!configurations) {
    return undefined;
  }

  const normalizedWorkspaceRoot = normalizePath(workspaceRoot);
  let matchingSettings: WorkspaceSettings | undefined;
  for (const [configuredRoot, settings] of Object.entries(configurations)) {
    if (normalizePath(configuredRoot) === normalizedWorkspaceRoot) {
      if (matchingSettings !== undefined) {
        return undefined;
      }
      matchingSettings = settings;
    }
  }

  return matchingSettings;
}

/**
 * Resolve an LSP configuration section from a workspace settings object.
 * Literal keys take precedence over dotted traversal so both common client
 * storage layouts can be represented without language-specific code.
 */
export function resolveWorkspaceSection(
  settings: WorkspaceSettings,
  section: string | undefined,
): unknown {
  if (!section) {
    return settings;
  }

  if (Object.prototype.hasOwnProperty.call(settings, section)) {
    return settings[section] ?? null;
  }

  let current: unknown = settings;
  for (const part of section.split('.')) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, part)) {
      return null;
    }
    current = current[part];
  }

  return current ?? null;
}
