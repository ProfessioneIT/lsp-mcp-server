import type { DocumentSymbol, SymbolInformation, WorkspaceSymbol } from 'vscode-languageserver-protocol';
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
 */
export async function handleWorkspaceSymbols(
  input: WorkspaceSymbolsInput
): Promise<WorkspaceSymbolsResponse> {
  const { query, kinds, limit } = input;

  const ctx = getToolContext();

  // Get a client - we'll use the first available one since workspace symbols
  // searches across the whole workspace
  const servers = ctx.connectionManager.listActiveServers();
  if (servers.length === 0) {
    return {
      symbols: [],
      total_count: 0,
      returned_count: 0,
      has_more: false,
    };
  }

  const server = servers[0];
  if (!server || !server.client) {
    return {
      symbols: [],
      total_count: 0,
      returned_count: 0,
      has_more: false,
    };
  }

  // Call LSP
  const result = await server.client.workspaceSymbols(query);

  if (!result || result.length === 0) {
    return {
      symbols: [],
      total_count: 0,
      returned_count: 0,
      has_more: false,
    };
  }

  // Convert and filter
  const allSymbols: WorkspaceSymbolResult[] = [];

  for (const symbol of result) {
    // Filter by kind if specified
    if (!matchesSymbolKind(symbol.kind, kinds)) {
      continue;
    }

    // Get location - SymbolInformation always has location with range
    const location = symbol.location;
    const symbolResult: WorkspaceSymbolResult = {
      name: symbol.name,
      kind: getSymbolKindName(symbol.kind),
      path: uriToPath(location.uri),
      line: 'range' in location ? location.range.start.line + 1 : 1,
      column: 'range' in location ? location.range.start.character + 1 : 1,
    };

    if (symbol.containerName) {
      symbolResult.container_name = symbol.containerName;
    }

    allSymbols.push(symbolResult);
  }

  // Apply limit
  const limited = allSymbols.slice(0, limit);

  return {
    symbols: limited,
    total_count: allSymbols.length,
    returned_count: limited.length,
    has_more: limited.length < allSymbols.length,
  };
}
