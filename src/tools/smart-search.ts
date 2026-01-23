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

import type { SmartSearchInput } from '../schemas/tool-schemas.js';
import type {
  SmartSearchResponse,
  LocationResult,
} from '../types.js';
import { prepareFile, toPosition, convertLocations } from './utils.js';
import { getToolContext } from './context.js';
import { fromLspRange, getLineContent } from '../utils/position.js';
import { uriToPath } from '../utils/uri.js';
import { getSymbolKindName } from './utils.js';

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
