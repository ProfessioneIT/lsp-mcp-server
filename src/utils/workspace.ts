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
import { DEFAULT_ROOT_MARKERS, ENV } from '../constants.js';
import { getDirectory, isDirectory, normalizePath } from './uri.js';

/**
 * Workspace root detection utilities.
 *
 * Finds the project root by walking up from a file path
 * and looking for root marker files.
 */

/**
 * Check if a directory contains any of the marker files.
 *
 * @param dirPath - Directory to check
 * @param markers - Marker file patterns to look for
 * @returns true if directory contains a marker
 */
async function hasMarker(dirPath: string, markers: string[]): Promise<boolean> {
  try {
    const entries = await fs.promises.readdir(dirPath);

    for (const marker of markers) {
      // Handle glob patterns like "*.sln"
      if (marker.startsWith('*')) {
        const extension = marker.slice(1);
        if (entries.some(entry => entry.endsWith(extension))) {
          return true;
        }
      } else {
        if (entries.includes(marker)) {
          return true;
        }
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Find the workspace root by walking up from a file path.
 *
 * @param filePath - Starting file path
 * @param markers - Root marker patterns (defaults to DEFAULT_ROOT_MARKERS)
 * @returns Workspace root path, or the file's directory if no root found
 */
export async function findWorkspaceRoot(
  filePath: string,
  markers: string[] = DEFAULT_ROOT_MARKERS
): Promise<string> {
  // Check environment variable override
  const envRoot = process.env[ENV.WORKSPACE_ROOT];
  if (envRoot) {
    const resolved = normalizePath(envRoot);
    if (await isDirectory(resolved)) {
      return resolved;
    }
  }

  // Normalize the starting path
  const normalizedPath = normalizePath(filePath);

  // Get the starting directory
  let currentDir: string;
  if (await isDirectory(normalizedPath)) {
    currentDir = normalizedPath;
  } else {
    currentDir = getDirectory(normalizedPath);
  }

  // Walk up the directory tree
  const root = path.parse(currentDir).root;
  let bestMatch: string | null = null;

  while (currentDir !== root) {
    if (await hasMarker(currentDir, markers)) {
      // Found a marker - this could be the root
      // Keep walking up to find the outermost project root
      bestMatch = currentDir;
    }

    // Move up one directory
    const parent = path.dirname(currentDir);
    if (parent === currentDir) {
      // Reached the root
      break;
    }
    currentDir = parent;
  }

  // Return the found root or fall back to the file's directory
  return bestMatch ?? getDirectory(normalizedPath);
}

/**
 * Find the workspace root using specific markers for a language server.
 *
 * @param filePath - Starting file path
 * @param rootPatterns - Language-specific root patterns
 * @returns Workspace root path
 */
export async function findWorkspaceRootForLanguage(
  filePath: string,
  rootPatterns?: string[]
): Promise<string> {
  if (rootPatterns && rootPatterns.length > 0) {
    // First try language-specific patterns
    const normalizedPath = normalizePath(filePath);
    let currentDir = await isDirectory(normalizedPath)
      ? normalizedPath
      : getDirectory(normalizedPath);

    const root = path.parse(currentDir).root;

    while (currentDir !== root) {
      if (await hasMarker(currentDir, rootPatterns)) {
        return currentDir;
      }

      const parent = path.dirname(currentDir);
      if (parent === currentDir) {
        break;
      }
      currentDir = parent;
    }
  }

  // Fall back to default detection
  return findWorkspaceRoot(filePath);
}

/**
 * Find the innermost workspace root (closest to the file).
 *
 * Unlike findWorkspaceRoot which finds the outermost root,
 * this finds the closest project root to the file.
 * Useful for monorepos where you want the sub-project root.
 *
 * @param filePath - Starting file path
 * @param markers - Root marker patterns
 * @returns Innermost workspace root path
 */
export async function findInnermostRoot(
  filePath: string,
  markers: string[] = DEFAULT_ROOT_MARKERS
): Promise<string> {
  // Check environment variable override
  const envRoot = process.env[ENV.WORKSPACE_ROOT];
  if (envRoot) {
    const resolved = normalizePath(envRoot);
    if (await isDirectory(resolved)) {
      return resolved;
    }
  }

  // Normalize the starting path
  const normalizedPath = normalizePath(filePath);

  // Get the starting directory
  let currentDir: string;
  if (await isDirectory(normalizedPath)) {
    currentDir = normalizedPath;
  } else {
    currentDir = getDirectory(normalizedPath);
  }

  // Walk up the directory tree until we find a marker
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    if (await hasMarker(currentDir, markers)) {
      return currentDir;
    }

    const parent = path.dirname(currentDir);
    if (parent === currentDir) {
      break;
    }
    currentDir = parent;
  }

  // No root found, return the file's directory
  return getDirectory(normalizedPath);
}

/**
 * Create a unique key for a server instance based on language and workspace root.
 *
 * @param serverId - Server/language ID
 * @param workspaceRoot - Workspace root path
 * @returns Unique key string
 */
export function createServerKey(serverId: string, workspaceRoot: string): string {
  return `${serverId}:${normalizePath(workspaceRoot)}`;
}

/**
 * Parse a server key back into its components.
 *
 * @param key - Server key
 * @returns Object with serverId and workspaceRoot
 */
export function parseServerKey(key: string): { serverId: string; workspaceRoot: string } {
  const colonIndex = key.indexOf(':');
  if (colonIndex === -1) {
    throw new Error(`Invalid server key: ${key}`);
  }

  return {
    serverId: key.slice(0, colonIndex),
    workspaceRoot: key.slice(colonIndex + 1),
  };
}

/**
 * Check if a file belongs to a workspace.
 *
 * @param filePath - File path to check
 * @param workspaceRoot - Workspace root path
 * @returns true if the file is within the workspace
 */
export function isFileInWorkspace(filePath: string, workspaceRoot: string): boolean {
  const normalizedFile = normalizePath(filePath);
  const normalizedRoot = normalizePath(workspaceRoot);

  return normalizedFile.startsWith(normalizedRoot + path.sep) ||
         normalizedFile === normalizedRoot;
}

/**
 * Get all potential workspace roots between a file and a limit directory.
 *
 * @param filePath - Starting file path
 * @param markers - Root marker patterns
 * @param limitDir - Stop searching at this directory (optional)
 * @returns Array of workspace root paths (innermost to outermost)
 */
export async function findAllWorkspaceRoots(
  filePath: string,
  markers: string[] = DEFAULT_ROOT_MARKERS,
  limitDir?: string
): Promise<string[]> {
  const roots: string[] = [];

  const normalizedPath = normalizePath(filePath);
  let currentDir = await isDirectory(normalizedPath)
    ? normalizedPath
    : getDirectory(normalizedPath);

  const root = path.parse(currentDir).root;
  const limit = limitDir ? normalizePath(limitDir) : root;

  while (currentDir !== root && currentDir.length >= limit.length) {
    if (await hasMarker(currentDir, markers)) {
      roots.push(currentDir);
    }

    const parent = path.dirname(currentDir);
    if (parent === currentDir) {
      break;
    }
    currentDir = parent;
  }

  return roots;
}
