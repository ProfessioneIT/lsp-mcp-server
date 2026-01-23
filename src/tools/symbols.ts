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

import type { DocumentSymbol, SymbolInformation } from 'vscode-languageserver-protocol';
import type { DocumentSymbolsInput, WorkspaceSymbolsInput } from '../schemas/tool-schemas.js';
import type { DocumentSymbolsResponse, WorkspaceSymbolsResponse, SymbolResult, WorkspaceSymbolResult } from '../types.js';
import { prepareFile, getSymbolKindName, matchesSymbolKind } from './utils.js';
import { getToolContext } from './context.js';
import { fromLspRange } from '../utils/position.js';
import { uriToPath } from '../utils/uri.js';

/**
 * Check if symbol is DocumentSymbol (has children and range).
 */
function isDocumentSymbol(symbol: DocumentSymbol | SymbolInformation): symbol is DocumentSymbol {
  return 'range' in symbol && 'selectionRange' in symbol;
}

/**
 * Convert DocumentSymbol to SymbolResult recursively.
 */
function documentSymbolToResult(symbol: DocumentSymbol, content: string): SymbolResult {
  const { start, end } = fromLspRange(symbol.range, content);
  const selectionRange = fromLspRange(symbol.selectionRange, content);

  const result: SymbolResult = {
    name: symbol.name,
    kind: getSymbolKindName(symbol.kind),
    range: { start, end },
    selection_range: selectionRange,
  };

  if (symbol.children && symbol.children.length > 0) {
    result.children = symbol.children.map(child => documentSymbolToResult(child, content));
  }

  return result;
}

/**
 * Convert SymbolInformation to SymbolResult.
 */
function symbolInfoToResult(symbol: SymbolInformation, content: string): SymbolResult {
  const { start, end } = fromLspRange(symbol.location.range, content);

  return {
    name: symbol.name,
    kind: getSymbolKindName(symbol.kind),
    range: { start, end },
  };
}

/**
 * Handle lsp_document_symbols tool call.
 */
export async function handleDocumentSymbols(
  input: DocumentSymbolsInput
): Promise<DocumentSymbolsResponse> {
  const { file_path } = input;

  const { client, uri, content } = await prepareFile(file_path);

  // Call LSP
  const result = await client.documentSymbols(uri);

  if (!result || result.length === 0) {
    return { symbols: [] };
  }

  // Convert to our format
  const symbols: SymbolResult[] = result.map(symbol => {
    if (isDocumentSymbol(symbol)) {
      return documentSymbolToResult(symbol, content);
    }
    return symbolInfoToResult(symbol, content);
  });

  return { symbols };
}

/**
 * Handle lsp_workspace_symbols tool call.
 * Queries ALL active language servers and merges results for polyglot projects.
 */
export async function handleWorkspaceSymbols(
  input: WorkspaceSymbolsInput
): Promise<WorkspaceSymbolsResponse> {
  const { query, kinds, limit } = input;

  const ctx = getToolContext();

  // Get all active servers
  const servers = ctx.connectionManager.listActiveServers();
  if (servers.length === 0) {
    return {
      symbols: [],
      total_count: 0,
      returned_count: 0,
      has_more: false,
    };
  }

  // Query all active servers in parallel
  const allResults = await Promise.all(
    servers
      .filter(server => server.client && server.status === 'running')
      .map(async (server) => {
        try {
          return await server.client!.workspaceSymbols(query);
        } catch {
          // Ignore errors from individual servers
          return null;
        }
      })
  );

  // Merge results from all servers
  const allSymbols: WorkspaceSymbolResult[] = [];
  const seenSymbols = new Set<string>(); // Deduplicate by path:line:name

  for (const result of allResults) {
    if (!result || result.length === 0) {
      continue;
    }

    for (const symbol of result) {
      // Filter by kind if specified
      if (!matchesSymbolKind(symbol.kind, kinds)) {
        continue;
      }

      // Get location
      const location = symbol.location;
      const path = uriToPath(location.uri);
      const line = 'range' in location ? location.range.start.line + 1 : 1;
      const column = 'range' in location ? location.range.start.character + 1 : 1;

      // Deduplicate
      const key = `${path}:${line}:${symbol.name}`;
      if (seenSymbols.has(key)) {
        continue;
      }
      seenSymbols.add(key);

      const symbolResult: WorkspaceSymbolResult = {
        name: symbol.name,
        kind: getSymbolKindName(symbol.kind),
        path,
        line,
        column,
      };

      if (symbol.containerName) {
        symbolResult.container_name = symbol.containerName;
      }

      allSymbols.push(symbolResult);
    }
  }

  // Sort by relevance (exact matches first, then prefix matches, then others)
  allSymbols.sort((a, b) => {
    const aExact = a.name.toLowerCase() === query.toLowerCase();
    const bExact = b.name.toLowerCase() === query.toLowerCase();
    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;

    const aPrefix = a.name.toLowerCase().startsWith(query.toLowerCase());
    const bPrefix = b.name.toLowerCase().startsWith(query.toLowerCase());
    if (aPrefix && !bPrefix) return -1;
    if (!aPrefix && bPrefix) return 1;

    return a.name.localeCompare(b.name);
  });

  // Apply limit
  const limited = allSymbols.slice(0, limit);

  return {
    symbols: limited,
    total_count: allSymbols.length,
    returned_count: limited.length,
    has_more: limited.length < allSymbols.length,
  };
}
