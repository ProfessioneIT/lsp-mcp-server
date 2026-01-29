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
import { BINARY_EXTENSIONS, BINARY_CHECK_BYTES, MAX_FILE_SIZE_BYTES } from '../constants.js';
import { LSPError, LSPErrorCode } from '../types.js';

/**
 * URI and file path utilities for LSP communication.
 *
 * LSP uses file:// URIs for document identification.
 * This module handles conversion and normalization.
 */

/**
 * Convert a file path to a file:// URI.
 *
 * @param filePath - Absolute file path
 * @returns file:// URI
 */
export function pathToUri(filePath: string): string {
  // Normalize the path
  const normalized = path.resolve(filePath);

  // On Windows, handle drive letters
  if (process.platform === 'win32') {
    // Convert backslashes to forward slashes and encode
    const encoded = encodeURIComponent(normalized.replace(/\\/g, '/')).replace(/%2F/g, '/').replace(/%3A/g, ':');
    return `file:///${encoded}`;
  }

  // On Unix-like systems
  const encoded = encodeURIComponent(normalized).replace(/%2F/g, '/');
  return `file://${encoded}`;
}

/**
 * Convert a file:// URI to a file path.
 *
 * @param uri - file:// URI
 * @returns Absolute file path
 */
export function uriToPath(uri: string): string {
  if (!uri.startsWith('file://')) {
    throw new Error(`Invalid file URI: ${uri}`);
  }

  let filePath = uri.slice(7); // Remove 'file://'

  // On Windows, handle the leading slash before drive letter
  if (process.platform === 'win32' && filePath.startsWith('/')) {
    filePath = filePath.slice(1);
  }

  // Decode URI components
  filePath = decodeURIComponent(filePath);

  // Normalize the path
  return path.normalize(filePath);
}

/**
 * Normalize a file path by resolving symlinks and normalizing the path.
 *
 * @param filePath - File path to normalize
 * @returns Normalized absolute path
 */
export function normalizePath(filePath: string): string {
  try {
    // Try to resolve symlinks
    return fs.realpathSync(filePath);
  } catch {
    // If file doesn't exist, just normalize the path
    return path.resolve(filePath);
  }
}

/**
 * Get the file extension from a path (lowercase, with dot).
 *
 * @param filePath - File path
 * @returns Extension including dot (e.g., ".ts") or empty string
 */
export function getExtension(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

/**
 * Check if a file is likely binary based on extension.
 *
 * @param filePath - File path to check
 * @returns true if the file extension indicates a binary file
 */
export function isBinaryExtension(filePath: string): boolean {
  const ext = getExtension(filePath);
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Check if a file is binary by looking for null bytes.
 *
 * @param filePath - File path to check
 * @returns true if the file appears to be binary
 */
export async function isBinaryFile(filePath: string): Promise<boolean> {
  // First check extension
  if (isBinaryExtension(filePath)) {
    return true;
  }

  try {
    // Read first chunk of file
    const fd = await fs.promises.open(filePath, 'r');
    try {
      const buffer = new Uint8Array(BINARY_CHECK_BYTES);
      const { bytesRead } = await fd.read(buffer, 0, BINARY_CHECK_BYTES, 0);

      // Check for null bytes
      for (let i = 0; i < bytesRead; i++) {
        if (buffer[i] === 0) {
          return true;
        }
      }

      return false;
    } finally {
      await fd.close();
    }
  } catch {
    // If we can't read the file, assume it's not binary
    // (the actual file read will fail with a better error)
    return false;
  }
}

/**
 * Check if a file exists and is readable.
 *
 * @param filePath - File path to check
 * @returns true if file exists and is readable
 */
export async function isReadable(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a path is a file (not a directory).
 *
 * @param filePath - Path to check
 * @returns true if path is a file
 */
export async function isFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Check if a path is a directory.
 *
 * @param dirPath - Path to check
 * @returns true if path is a directory
 */
export async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Read a file's content as UTF-8 text.
 *
 * @param filePath - Path to the file
 * @returns File content as string
 * @throws LSPError if file cannot be read
 */
export async function readFile(filePath: string): Promise<string> {
  // Check if file exists
  if (!(await isReadable(filePath))) {
    throw new LSPError(
      LSPErrorCode.FILE_NOT_FOUND,
      `File not found: ${filePath}`,
      'Check that the file path is correct and the file exists.',
      { file_path: filePath }
    );
  }

  // Check if it's a directory
  if (await isDirectory(filePath)) {
    throw new LSPError(
      LSPErrorCode.FILE_NOT_READABLE,
      `Path is a directory, not a file: ${filePath}`,
      'Provide a path to a file, not a directory.',
      { file_path: filePath }
    );
  }

  // Check file size
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.size > MAX_FILE_SIZE_BYTES) {
      const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
      const maxMB = (MAX_FILE_SIZE_BYTES / (1024 * 1024)).toFixed(0);
      throw new LSPError(
        LSPErrorCode.FILE_NOT_READABLE,
        `File too large: ${filePath} (${sizeMB} MB)`,
        `Maximum supported file size is ${maxMB} MB.`,
        { file_path: filePath }
      );
    }
  } catch (error) {
    if (error instanceof LSPError) {
      throw error;
    }
    // Continue if stat fails - readFile will fail with a better error
  }

  // Check if binary
  if (await isBinaryFile(filePath)) {
    throw new LSPError(
      LSPErrorCode.FILE_NOT_READABLE,
      `Cannot read binary file: ${filePath}`,
      'This tool only works with text source files.',
      { file_path: filePath }
    );
  }

  try {
    return await fs.promises.readFile(filePath, 'utf-8');
  } catch (_error) {
    throw new LSPError(
      LSPErrorCode.FILE_NOT_READABLE,
      `Cannot read file: ${filePath}`,
      'Check file permissions and ensure the file is accessible.',
      { file_path: filePath }
    );
  }
}

/**
 * Get the directory containing a file.
 *
 * @param filePath - File path
 * @returns Directory path
 */
export function getDirectory(filePath: string): string {
  return path.dirname(filePath);
}

/**
 * Join path segments.
 *
 * @param segments - Path segments to join
 * @returns Joined path
 */
export function joinPath(...segments: string[]): string {
  return path.join(...segments);
}

/**
 * Check if a path is absolute.
 *
 * @param filePath - Path to check
 * @returns true if path is absolute
 */
export function isAbsolute(filePath: string): boolean {
  return path.isAbsolute(filePath);
}

/**
 * Ensure a path is absolute, resolving relative paths against cwd.
 *
 * @param filePath - Path to make absolute
 * @returns Absolute path
 */
export function ensureAbsolute(filePath: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(filePath);
}

/**
 * Get the relative path from one location to another.
 *
 * @param from - Starting path
 * @param to - Target path
 * @returns Relative path from 'from' to 'to'
 */
export function relativePath(from: string, to: string): string {
  return path.relative(from, to);
}

/**
 * Check if a path is within a directory (accounting for symlinks).
 *
 * @param filePath - Path to check
 * @param dirPath - Directory path
 * @returns true if filePath is within dirPath
 */
export function isWithinDirectory(filePath: string, dirPath: string): boolean {
  const normalizedFile = normalizePath(filePath);
  const normalizedDir = normalizePath(dirPath);

  // Ensure directory path ends with separator for accurate check
  const dirWithSep = normalizedDir.endsWith(path.sep)
    ? normalizedDir
    : normalizedDir + path.sep;

  return normalizedFile.startsWith(dirWithSep) || normalizedFile === normalizedDir;
}

/**
 * Validate that a file path is within a workspace root before writing.
 * Throws LSPError if the path is outside the workspace.
 *
 * @param filePath - File path to validate
 * @param workspaceRoot - Workspace root path
 * @throws LSPError if path is outside workspace
 */
export function validatePathWithinWorkspace(filePath: string, workspaceRoot: string): void {
  if (!isWithinDirectory(filePath, workspaceRoot)) {
    throw new LSPError(
      LSPErrorCode.FILE_NOT_READABLE,
      `File path "${filePath}" is outside workspace "${workspaceRoot}"`,
      'File modifications are only allowed within the workspace root.',
      { file_path: filePath }
    );
  }
}
