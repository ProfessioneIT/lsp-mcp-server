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

import type { TypeHierarchyItem } from 'vscode-languageserver-protocol';
import type { TypeHierarchyInput } from '../schemas/tool-schemas.js';
import type { TypeHierarchyResponse, TypeHierarchyItemResult } from '../types.js';
import { prepareFile, toPosition, getSymbolKindName } from './utils.js';
import { uriToPath } from '../utils/uri.js';
import { LSPError, LSPErrorCode } from '../types.js';

/**
 * Convert TypeHierarchyItem to our result format.
 */
function convertItem(item: TypeHierarchyItem): TypeHierarchyItemResult {
  const result: TypeHierarchyItemResult = {
    name: item.name,
    kind: getSymbolKindName(item.kind),
    path: uriToPath(item.uri),
    line: item.range.start.line + 1,
    column: item.range.start.character + 1,
    range: {
      start: { line: item.range.start.line + 1, column: item.range.start.character + 1 },
      end: { line: item.range.end.line + 1, column: item.range.end.character + 1 },
    },
    selection_range: {
      start: { line: item.selectionRange.start.line + 1, column: item.selectionRange.start.character + 1 },
      end: { line: item.selectionRange.end.line + 1, column: item.selectionRange.end.character + 1 },
    },
  };

  if (item.detail) {
    result.detail = item.detail;
  }

  if (item.tags && item.tags.length > 0) {
    result.tags = item.tags.map(t => t === 1 ? 'deprecated' : `tag_${t}`);
  }

  return result;
}

/**
 * Handle lsp_type_hierarchy tool call.
 */
export async function handleTypeHierarchy(
  input: TypeHierarchyInput
): Promise<TypeHierarchyResponse> {
  const { file_path, line, column, direction } = input;

  const { client, uri, content } = await prepareFile(file_path);

  // Convert position
  const position = toPosition(line, column, content);

  // Prepare type hierarchy
  const items = await client.prepareTypeHierarchy(uri, position);

  if (!items || items.length === 0) {
    throw new LSPError(
      LSPErrorCode.CAPABILITY_NOT_SUPPORTED,
      'No type hierarchy item found at this position',
      'Move cursor to a class, interface, or type definition.',
      { file_path, position: { line, column } }
    );
  }

  // Use the first item (usually there's only one)
  const item = items[0]!;
  const result: TypeHierarchyResponse = {
    item: convertItem(item),
  };

  // Get supertypes if requested
  if (direction === 'supertypes' || direction === 'both') {
    const supertypes = await client.typeHierarchySupertypes(item);
    if (supertypes && supertypes.length > 0) {
      result.supertypes = supertypes.map(convertItem);
    }
  }

  // Get subtypes if requested
  if (direction === 'subtypes' || direction === 'both') {
    const subtypes = await client.typeHierarchySubtypes(item);
    if (subtypes && subtypes.length > 0) {
      result.subtypes = subtypes.map(convertItem);
    }
  }

  return result;
}
