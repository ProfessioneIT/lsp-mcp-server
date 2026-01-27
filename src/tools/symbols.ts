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
import type { DocumentSymbolsInput, WorkspaceSymbolsInput, FileExportsInput, FileImportsInput, RelatedFilesInput } from '../schemas/tool-schemas.js';
import type { DocumentSymbolsResponse, WorkspaceSymbolsResponse, SymbolResult, WorkspaceSymbolResult, FileExportsResponse, FileExportItem, FileImportsResponse, FileImportItem, RelatedFilesResponse } from '../types.js';
import { prepareFile, getSymbolKindName, matchesSymbolKind, toPosition } from './utils.js';
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

/**
 * Extract signature from hover contents.
 */
function extractSignature(hover: { contents: string | { value: string } | Array<string | { value: string }> } | null): string | undefined {
  if (!hover) return undefined;

  let text: string;
  if (typeof hover.contents === 'string') {
    text = hover.contents;
  } else if (Array.isArray(hover.contents)) {
    text = hover.contents
      .map(c => typeof c === 'string' ? c : c.value)
      .join('\n');
  } else if ('value' in hover.contents) {
    text = hover.contents.value;
  } else {
    return undefined;
  }

  // Remove markdown code fences
  text = text.replace(/```[\w]*\n?/g, '').trim();

  // Take first line (usually the signature)
  const firstLine = text.split('\n')[0]?.trim();
  return firstLine || undefined;
}

/**
 * Handle lsp_file_exports tool call.
 * Returns top-level symbols (the file's API surface) with optional type signatures.
 */
export async function handleFileExports(
  input: FileExportsInput
): Promise<FileExportsResponse> {
  const { file_path, include_signatures } = input;

  const { client, uri, content } = await prepareFile(file_path);

  // Get document symbols
  const result = await client.documentSymbols(uri);

  if (!result || result.length === 0) {
    return {
      file: file_path,
      exports: [],
      note: 'No symbols found in file.',
    };
  }

  // Get top-level symbols only
  const exports: FileExportItem[] = [];

  for (const symbol of result) {
    const isDoc = isDocumentSymbol(symbol);
    const range = isDoc ? symbol.selectionRange : symbol.location.range;
    const { start } = fromLspRange(range, content);

    const item: FileExportItem = {
      name: symbol.name,
      kind: getSymbolKindName(symbol.kind),
      line: start.line,
      column: start.column,
    };

    // Get signature via hover if requested
    if (include_signatures) {
      try {
        const position = toPosition(start.line, start.column, content);
        const hover = await client.hover(uri, position);
        const sig = extractSignature(hover);
        if (sig) {
          item.signature = sig;
        }
      } catch {
        // Ignore hover errors
      }
    }

    exports.push(item);
  }

  return {
    file: file_path,
    exports,
    note: 'Returns top-level symbols. For true export detection, check if symbols are prefixed with "export" in the source.',
  };
}

/**
 * Extract imports from file content using regex patterns.
 * Supports ES modules (import), CommonJS (require), and TypeScript type imports.
 */
function extractImportsFromContent(content: string): FileImportItem[] {
  const imports: FileImportItem[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1;

    // ES module: import { x, y } from 'module'
    // ES module: import x from 'module'
    // ES module: import * as x from 'module'
    // ES module: import 'module'
    const esImportMatch = line.match(/^\s*import\s+(?:type\s+)?(?:(\{[^}]+\})|(\*\s+as\s+\w+)|(\w+)(?:\s*,\s*(?:(\{[^}]+\})|(\*\s+as\s+\w+)))?)?\s*(?:from\s+)?['"]([^'"]+)['"]/);
    if (esImportMatch) {
      const modulePath = esImportMatch[6]!;
      const isTypeOnly = line.includes('import type');
      const symbolsStr = esImportMatch[1] || esImportMatch[4]; // Named imports

      const item: FileImportItem = {
        module: modulePath,
        line: lineNum,
      };

      if (symbolsStr) {
        // Parse { x, y as z } into ['x', 'y']
        const symbols = symbolsStr
          .replace(/[{}]/g, '')
          .split(',')
          .map(s => s.trim().split(/\s+as\s+/)[0]!.trim())
          .filter(s => s.length > 0);
        if (symbols.length > 0) {
          item.symbols = symbols;
        }
      }

      if (isTypeOnly) {
        item.is_type_only = true;
      }

      imports.push(item);
      continue;
    }

    // Dynamic import: import('module')
    const dynamicImportMatch = line.match(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (dynamicImportMatch) {
      imports.push({
        module: dynamicImportMatch[1]!,
        line: lineNum,
        is_dynamic: true,
      });
      continue;
    }

    // CommonJS: require('module')
    const requireMatch = line.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (requireMatch) {
      imports.push({
        module: requireMatch[1]!,
        line: lineNum,
      });
    }
  }

  return imports;
}

/**
 * Handle lsp_file_imports tool call.
 * Returns imports/dependencies of a file by analyzing the content.
 */
export async function handleFileImports(
  input: FileImportsInput
): Promise<FileImportsResponse> {
  const { file_path } = input;

  const { content } = await prepareFile(file_path);

  const imports = extractImportsFromContent(content);

  return {
    file: file_path,
    imports,
    note: 'Imports extracted from file content using pattern matching. Supports ES modules, CommonJS require(), and dynamic imports.',
  };
}

/**
 * Handle lsp_related_files tool call.
 * Shows files that import or are imported by a given file.
 */
export async function handleRelatedFiles(
  input: RelatedFilesInput
): Promise<RelatedFilesResponse> {
  const { file_path, relationship } = input;
  const ctx = getToolContext();

  const result: RelatedFilesResponse = {
    file: file_path,
    imports: [],
    imported_by: [],
    note: 'Import relationships based on file content analysis. Only files opened in this session are included in imported_by.',
  };

  // Get files this file imports
  if (relationship === 'imports' || relationship === 'all') {
    const { content } = await prepareFile(file_path);
    const importItems = extractImportsFromContent(content);

    // Filter to relative imports only (local files)
    result.imports = importItems
      .filter(imp => imp.module.startsWith('.') || imp.module.startsWith('/'))
      .map(imp => imp.module);
  }

  // Get files that import this file (requires scanning opened documents)
  if (relationship === 'imported_by' || relationship === 'all') {
    // Get all cached URIs from diagnostics (these are files we've opened)
    const openedUris = ctx.diagnosticsCache.getUris();

    for (const uri of openedUris) {
      const otherPath = uriToPath(uri);
      if (otherPath === file_path) continue;

      const otherContent = ctx.documentManager.getContent(uri);
      if (!otherContent) continue;

      const otherImports = extractImportsFromContent(otherContent);

      // Check if any import points to our file
      const importsSelf = otherImports.some(imp => {
        // Simple check: does the import path end with our filename?
        const targetName = file_path.split('/').pop()?.replace(/\.(ts|tsx|js|jsx)$/, '');
        if (!targetName) return false;
        return imp.module.includes(targetName);
      });

      if (importsSelf) {
        result.imported_by.push(otherPath);
      }
    }
  }

  return result;
}
