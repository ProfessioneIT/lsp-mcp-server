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

import type { Location, LocationLink } from 'vscode-languageserver-protocol';
import type { LocationResult, LSPClient } from '../types.js';
import { uriToPath, readFile, pathToUri, ensureAbsolute } from '../utils/uri.js';
import { fromLspRange, getLineContent, toLspPosition } from '../utils/position.js';
import { SYMBOL_KIND_NAMES, COMPLETION_KIND_NAMES, DIAGNOSTIC_SEVERITY_NAMES } from '../constants.js';
import { getToolContext } from './context.js';

/**
 * Prepare a file for LSP operations by ensuring it's open with the appropriate server.
 */
export async function prepareFile(filePath: string): Promise<{
  client: LSPClient;
  uri: string;
  content: string;
}> {
  const ctx = getToolContext();
  const absolutePath = ensureAbsolute(filePath);
  const uri = pathToUri(absolutePath);

  // Get the client for this file
  const client = await ctx.connectionManager.getClientForFile(absolutePath);

  // Ensure document is open
  await ctx.documentManager.ensureOpen(uri, client);

  // Get content for position conversion
  const content = ctx.documentManager.getContent(uri) ?? await readFile(absolutePath);

  return { client, uri, content };
}

/**
 * Extract symbol name from file content given a range.
 */
function extractSymbolName(content: string, range: { start: { line: number; character: number }; end: { line: number; character: number } }): string | undefined {
  if (!content) return undefined;

  const lines = content.split('\n');
  const startLine = lines[range.start.line];
  if (!startLine) return undefined;

  // For single-line ranges, extract the text
  if (range.start.line === range.end.line) {
    const symbol = startLine.substring(range.start.character, range.end.character);
    // Only return if it looks like a valid identifier
    if (symbol && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(symbol)) {
      return symbol;
    }
  }

  return undefined;
}

/**
 * Convert an LSP Location to our LocationResult format.
 */
export async function locationToResult(
  location: Location,
  content?: string
): Promise<LocationResult> {
  const filePath = uriToPath(location.uri);

  // Get content if not provided
  let fileContent = content;
  if (!fileContent) {
    try {
      fileContent = await readFile(filePath);
    } catch {
      fileContent = '';
    }
  }

  const { start, end } = fromLspRange(location.range, fileContent);
  const contextLine = getLineContent(fileContent, start.line) ?? '';
  const symbolName = extractSymbolName(fileContent, location.range);

  const result: LocationResult = {
    path: filePath,
    line: start.line,
    column: start.column,
    end_line: end.line,
    end_column: end.column,
    context: contextLine.trim(),
  };

  if (symbolName) {
    result.symbol_name = symbolName;
  }

  return result;
}

/**
 * Convert an LSP LocationLink to our LocationResult format.
 */
export async function locationLinkToResult(
  link: LocationLink
): Promise<LocationResult> {
  const filePath = uriToPath(link.targetUri);

  let fileContent: string;
  try {
    fileContent = await readFile(filePath);
  } catch {
    fileContent = '';
  }

  const range = link.targetSelectionRange ?? link.targetRange;
  const { start, end } = fromLspRange(range, fileContent);
  const contextLine = getLineContent(fileContent, start.line) ?? '';

  // Extract symbol name from the selection range (more precise than target range)
  const selectionRange = link.targetSelectionRange ?? link.targetRange;
  const symbolName = extractSymbolName(fileContent, selectionRange);

  const result: LocationResult = {
    path: filePath,
    line: start.line,
    column: start.column,
    end_line: end.line,
    end_column: end.column,
    context: contextLine.trim(),
  };

  if (symbolName) {
    result.symbol_name = symbolName;
  }

  return result;
}

/**
 * Convert LSP locations (which can be Location, Location[], or LocationLink[]) to LocationResult[].
 */
export async function convertLocations(
  result: Location | Location[] | LocationLink[] | null
): Promise<LocationResult[]> {
  if (!result) {
    return [];
  }

  const locations = Array.isArray(result) ? result : [result];

  const converted: LocationResult[] = [];
  for (const loc of locations) {
    if ('targetUri' in loc) {
      converted.push(await locationLinkToResult(loc as LocationLink));
    } else {
      converted.push(await locationToResult(loc as Location));
    }
  }

  return converted;
}

/**
 * Get human-readable symbol kind name.
 */
export function getSymbolKindName(kind: number): string {
  return SYMBOL_KIND_NAMES[kind] ?? 'Unknown';
}

/**
 * Get human-readable completion kind name.
 */
export function getCompletionKindName(kind: number | undefined): string {
  return kind ? (COMPLETION_KIND_NAMES[kind] ?? 'Text') : 'Text';
}

/**
 * Get human-readable diagnostic severity name.
 */
export function getDiagnosticSeverityName(severity: number | undefined): 'error' | 'warning' | 'info' | 'hint' {
  return severity ? (DIAGNOSTIC_SEVERITY_NAMES[severity] ?? 'hint') : 'hint';
}

/**
 * Convert 1-indexed position to LSP position for a file.
 */
export function toPosition(line: number, column: number, content: string) {
  return toLspPosition(line, column, content);
}

/**
 * Filter symbol kinds based on requested kinds.
 */
export function matchesSymbolKind(symbolKind: number, requestedKinds?: string[]): boolean {
  if (!requestedKinds || requestedKinds.length === 0) {
    return true;
  }

  const kindName = getSymbolKindName(symbolKind);
  return requestedKinds.includes(kindName);
}
