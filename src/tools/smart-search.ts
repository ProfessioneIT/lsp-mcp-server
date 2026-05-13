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
import type { SmartSearchInput, FindSymbolInput } from '../schemas/tool-schemas.js';
import type {
  SmartSearchResponse,
  FindSymbolResponse,
  LocationResult,
} from '../types.js';
import { prepareFile, toPosition, convertLocations } from './utils.js';
import { getToolContext } from './context.js';
import { fromLspRange, getLineContent } from '../utils/position.js';
import { uriToPath } from '../utils/uri.js';
import { getSymbolKindName } from './utils.js';

/**
 * Recursively flatten a hierarchical DocumentSymbol tree into a flat list,
 * preserving container_name for nested symbols.
 */
function flattenDocumentSymbols(
  symbols: (DocumentSymbol | SymbolInformation)[],
  containerName?: string,
): Array<{ name: string; kind: number; line: number; column: number; container?: string }> {
  const out: Array<{ name: string; kind: number; line: number; column: number; container?: string }> = [];
  for (const s of symbols) {
    if ('selectionRange' in s) {
      // DocumentSymbol — hierarchical, has children
      const doc = s as DocumentSymbol;
      const entry: { name: string; kind: number; line: number; column: number; container?: string } = {
        name: doc.name,
        kind: doc.kind,
        line: doc.selectionRange.start.line + 1,
        column: doc.selectionRange.start.character + 1,
      };
      if (containerName) entry.container = containerName;
      out.push(entry);
      if (doc.children && doc.children.length > 0) {
        const newContainer = containerName ? `${containerName}.${doc.name}` : doc.name;
        out.push(...flattenDocumentSymbols(doc.children, newContainer));
      }
    } else {
      // SymbolInformation — flat
      const info = s as SymbolInformation;
      const entry: { name: string; kind: number; line: number; column: number; container?: string } = {
        name: info.name,
        kind: info.kind,
        line: info.location.range.start.line + 1,
        column: info.location.range.start.character + 1,
      };
      if (info.containerName) entry.container = info.containerName;
      out.push(entry);
    }
  }
  return out;
}

/**
 * Handle lsp_smart_search tool call.
 * Combines multiple LSP operations in a single call for comprehensive symbol information.
 */
export async function handleSmartSearch(
  input: SmartSearchInput
): Promise<SmartSearchResponse> {
  const { file_path, line, column, include, references_limit } = input;

  const { client, uri, content } = await prepareFile(file_path);
  const position = toPosition(line, column, content);

  const result: SmartSearchResponse = {};

  // Get hover info to extract symbol name and type info
  if (include.includes('hover')) {
    try {
      const hoverResult = await client.hover(uri, position);
      if (hoverResult) {
        let contents = '';
        if (typeof hoverResult.contents === 'string') {
          contents = hoverResult.contents;
        } else if (Array.isArray(hoverResult.contents)) {
          contents = hoverResult.contents
            .map(c => typeof c === 'string' ? c : (c as { value: string }).value)
            .join('\n\n');
        } else if ('value' in hoverResult.contents) {
          contents = (hoverResult.contents as { value: string }).value;
        }

        result.hover = { contents };

        if (hoverResult.range) {
          const { start, end } = fromLspRange(hoverResult.range, content);
          result.hover.range = { start, end };

          // Extract symbol name from the range
          const lines = content.split('\n');
          const symbolLine = lines[hoverResult.range.start.line];
          if (symbolLine) {
            result.symbol_name = symbolLine.substring(
              hoverResult.range.start.character,
              hoverResult.range.end.character
            );
          }
        }
      }
    } catch {
      // Ignore hover errors, continue with other operations
    }
  }

  // Get definition
  if (include.includes('definition')) {
    try {
      const defResult = await client.definition(uri, position);
      const definitions = await convertLocations(defResult);
      if (definitions.length > 0 && definitions[0]) {
        result.definition = definitions[0];
      }
    } catch {
      // Ignore definition errors
    }
  }

  // Get references
  if (include.includes('references')) {
    try {
      const refsResult = await client.references(uri, position, true);
      if (refsResult && refsResult.length > 0) {
        const allRefs: LocationResult[] = [];
        for (const ref of refsResult) {
          const filePath = uriToPath(ref.uri);
          const { start, end } = fromLspRange(ref.range, content);
          // Try to get context line
          let contextLine = '';
          try {
            const ctx = getToolContext();
            const refContent = ctx.documentManager.getContent(ref.uri);
            if (refContent) {
              contextLine = getLineContent(refContent, start.line)?.trim() ?? '';
            }
          } catch {
            // Ignore context errors
          }

          allRefs.push({
            path: filePath,
            line: start.line,
            column: start.column,
            end_line: end.line,
            end_column: end.column,
            context: contextLine,
          });
        }

        result.references = {
          items: allRefs.slice(0, references_limit),
          total_count: allRefs.length,
          has_more: allRefs.length > references_limit,
        };
      }
    } catch {
      // Ignore reference errors
    }
  }

  // Get implementations
  if (include.includes('implementations')) {
    try {
      const implResult = await client.implementation(uri, position);
      const implementations = await convertLocations(implResult);
      if (implementations.length > 0) {
        result.implementations = {
          items: implementations.slice(0, references_limit),
          total_count: implementations.length,
          has_more: implementations.length > references_limit,
        };
      }
    } catch {
      // Ignore implementation errors
    }
  }

  // Get incoming calls
  if (include.includes('incoming_calls')) {
    try {
      const items = await client.prepareCallHierarchy(uri, position);
      if (items && items.length > 0) {
        const item = items[0]!;
        const incomingCalls = await client.callHierarchyIncomingCalls(item);
        if (incomingCalls && incomingCalls.length > 0) {
          result.incoming_calls = incomingCalls.map(call => ({
            from: {
              name: call.from.name,
              kind: getSymbolKindName(call.from.kind),
              path: uriToPath(call.from.uri),
              line: call.from.range.start.line + 1,
              column: call.from.range.start.character + 1,
              range: {
                start: { line: call.from.range.start.line + 1, column: call.from.range.start.character + 1 },
                end: { line: call.from.range.end.line + 1, column: call.from.range.end.character + 1 },
              },
              selection_range: {
                start: { line: call.from.selectionRange.start.line + 1, column: call.from.selectionRange.start.character + 1 },
                end: { line: call.from.selectionRange.end.line + 1, column: call.from.selectionRange.end.character + 1 },
              },
            },
            from_ranges: call.fromRanges.map(r => ({
              start: { line: r.start.line + 1, column: r.start.character + 1 },
              end: { line: r.end.line + 1, column: r.end.character + 1 },
            })),
          }));
        }
      }
    } catch {
      // Ignore call hierarchy errors
    }
  }

  // Get outgoing calls
  if (include.includes('outgoing_calls')) {
    try {
      const items = await client.prepareCallHierarchy(uri, position);
      if (items && items.length > 0) {
        const item = items[0]!;
        const outgoingCalls = await client.callHierarchyOutgoingCalls(item);
        if (outgoingCalls && outgoingCalls.length > 0) {
          result.outgoing_calls = outgoingCalls.map(call => ({
            to: {
              name: call.to.name,
              kind: getSymbolKindName(call.to.kind),
              path: uriToPath(call.to.uri),
              line: call.to.range.start.line + 1,
              column: call.to.range.start.character + 1,
              range: {
                start: { line: call.to.range.start.line + 1, column: call.to.range.start.character + 1 },
                end: { line: call.to.range.end.line + 1, column: call.to.range.end.character + 1 },
              },
              selection_range: {
                start: { line: call.to.selectionRange.start.line + 1, column: call.to.selectionRange.start.character + 1 },
                end: { line: call.to.selectionRange.end.line + 1, column: call.to.selectionRange.end.character + 1 },
              },
            },
            from_ranges: call.fromRanges.map(r => ({
              start: { line: r.start.line + 1, column: r.start.character + 1 },
              end: { line: r.end.line + 1, column: r.end.character + 1 },
            })),
          }));
        }
      }
    } catch {
      // Ignore call hierarchy errors
    }
  }

  return result;
}

/**
 * Extract location info from a workspace symbol (handles both SymbolInformation and WorkspaceSymbol).
 */
function getSymbolLocation(symbol: { location?: { uri: string; range?: { start?: { line: number; character: number } } } }): { uri: string; line: number; column: number } | null {
  if (!symbol.location) return null;
  const loc = symbol.location;
  if (!loc.uri) return null;

  return {
    uri: loc.uri,
    line: (loc.range?.start?.line ?? 0) + 1,
    column: (loc.range?.start?.character ?? 0) + 1,
  };
}

/**
 * Handle lsp_find_symbol tool call.
 * Finds a symbol by name and returns comprehensive information.
 */
export async function handleFindSymbol(
  input: FindSymbolInput
): Promise<FindSymbolResponse> {
  const { name, file_path, kind, include, references_limit } = input;

  // File-scoped path: resolve from this file's document symbols instead of
  // the workspace index. This is faster and unambiguous when the caller
  // already knows the file.
  if (file_path) {
    return findSymbolInFile({
      name,
      file_path,
      ...(kind && { kind }),
      include,
      references_limit,
    });
  }

  return findSymbolInWorkspace({
    name,
    ...(kind && { kind }),
    include,
    references_limit,
  });
}

async function findSymbolInFile(input: {
  name: string;
  file_path: string;
  kind?: string;
  include: FindSymbolInput['include'];
  references_limit: number;
}): Promise<FindSymbolResponse> {
  const { name, file_path, kind, include, references_limit } = input;

  const { client, uri } = await prepareFile(file_path);
  const docSymbols = await client.documentSymbols(uri);

  if (!docSymbols || docSymbols.length === 0) {
    return { query: name, matches_found: 0, symbol_name: name };
  }

  const flat = flattenDocumentSymbols(docSymbols);

  const lower = name.toLowerCase();
  let candidates = flat.filter((s) => s.name.toLowerCase().includes(lower));

  if (kind) {
    const byKind = candidates.filter((s) => getSymbolKindName(s.kind) === kind);
    if (byKind.length > 0) candidates = byKind;
  }

  if (candidates.length === 0) {
    return { query: name, matches_found: 0, symbol_name: name };
  }

  candidates.sort((a, b) => {
    const aExact = a.name === name ? 0 : 1;
    const bExact = b.name === name ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    return a.name.length - b.name.length;
  });

  const best = candidates[0]!;
  const result: FindSymbolResponse = {
    query: name,
    matches_found: candidates.length,
    match: {
      name: best.name,
      kind: getSymbolKindName(best.kind),
      path: file_path,
      line: best.line,
      column: best.column,
      container_name: best.container,
    },
    symbol_name: best.name,
  };

  try {
    const smartResult = await handleSmartSearch({
      file_path,
      line: best.line,
      column: best.column,
      include,
      references_limit,
    });
    if (smartResult.definition) result.definition = smartResult.definition;
    if (smartResult.references) result.references = smartResult.references;
    if (smartResult.hover) result.hover = smartResult.hover;
    if (smartResult.implementations) result.implementations = smartResult.implementations;
    if (smartResult.incoming_calls) result.incoming_calls = smartResult.incoming_calls;
    if (smartResult.outgoing_calls) result.outgoing_calls = smartResult.outgoing_calls;
  } catch {
    // If smart search fails, we still have the basic match info
  }

  return result;
}

async function findSymbolInWorkspace(input: {
  name: string;
  kind?: string;
  include: FindSymbolInput['include'];
  references_limit: number;
}): Promise<FindSymbolResponse> {
  const { name, kind, include, references_limit } = input;
  const ctx = getToolContext();

  // Get the first available client to search for symbols
  const servers = ctx.connectionManager.listActiveServers();
  if (servers.length === 0) {
    return {
      query: name,
      matches_found: 0,
      symbol_name: name,
    };
  }

  // Find a running server to query
  let client = null;
  for (const server of servers) {
    if (server.status === 'running' && server.client) {
      client = server.client;
      break;
    }
  }

  if (!client) {
    return {
      query: name,
      matches_found: 0,
      symbol_name: name,
    };
  }

  // Search for symbols matching the name
  const symbols = await client.workspaceSymbols(name);
  if (!symbols || symbols.length === 0) {
    return {
      query: name,
      matches_found: 0,
      symbol_name: name,
    };
  }

  // Filter by kind if specified
  let filtered = symbols;
  if (kind) {
    filtered = symbols.filter(s => {
      const symbolKind = getSymbolKindName(s.kind);
      return symbolKind === kind;
    });
    if (filtered.length === 0) {
      // Fall back to all matches if kind filter removes everything
      filtered = symbols;
    }
  }

  // Sort to prioritize exact matches
  filtered.sort((a, b) => {
    const aExact = a.name === name ? 0 : 1;
    const bExact = b.name === name ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    // Then by name length (shorter = more likely intended)
    return a.name.length - b.name.length;
  });

  // Get the best match
  const bestMatch = filtered[0]!;
  const location = getSymbolLocation(bestMatch as { location?: { uri: string; range?: { start?: { line: number; character: number } } } });

  if (!location) {
    return {
      query: name,
      matches_found: filtered.length,
      match: {
        name: bestMatch.name,
        kind: getSymbolKindName(bestMatch.kind),
        path: '',
        line: 1,
        column: 1,
        container_name: bestMatch.containerName,
      },
      symbol_name: bestMatch.name,
    };
  }

  const filePath = uriToPath(location.uri);

  const result: FindSymbolResponse = {
    query: name,
    matches_found: filtered.length,
    match: {
      name: bestMatch.name,
      kind: getSymbolKindName(bestMatch.kind),
      path: filePath,
      line: location.line,
      column: location.column,
      container_name: bestMatch.containerName,
    },
    symbol_name: bestMatch.name,
  };

  // Now get detailed information using smart search logic
  try {
    const smartResult = await handleSmartSearch({
      file_path: filePath,
      line: location.line,
      column: location.column,
      include,
      references_limit,
    });

    // Merge smart search results
    if (smartResult.definition) result.definition = smartResult.definition;
    if (smartResult.references) result.references = smartResult.references;
    if (smartResult.hover) result.hover = smartResult.hover;
    if (smartResult.implementations) result.implementations = smartResult.implementations;
    if (smartResult.incoming_calls) result.incoming_calls = smartResult.incoming_calls;
    if (smartResult.outgoing_calls) result.outgoing_calls = smartResult.outgoing_calls;
  } catch {
    // If smart search fails, we still have the basic match info
  }

  return result;
}
