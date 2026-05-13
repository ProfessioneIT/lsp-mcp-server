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

import type { SelectionRange } from 'vscode-languageserver-protocol';
import type { SelectionRangeInput } from '../schemas/tool-schemas.js';
import type { SelectionRangeResponse, SelectionRangeNode } from '../types.js';
import { prepareFile, toPosition } from './utils.js';
import { fromLspRange, getLineContent } from '../utils/position.js';

/**
 * Flatten an LSP SelectionRange chain (linked-list via parent pointer)
 * into an innermost-to-outermost array of nodes. Each node also keeps a
 * reference to its parent for callers that want the nested form.
 */
function flatten(root: SelectionRange, content: string): SelectionRangeNode[] {
  const nodes: SelectionRangeNode[] = [];
  let cur: SelectionRange | undefined = root;
  while (cur) {
    const range = fromLspRange(cur.range, content);
    const ctx = getLineContent(content, range.start.line)?.trim() ?? '';
    nodes.push({ range, context: ctx });
    cur = cur.parent;
  }
  // Link parent pointers in the flattened nodes for callers that want them.
  for (let i = 0; i < nodes.length - 1; i++) {
    nodes[i]!.parent = nodes[i + 1]!;
  }
  return nodes;
}

export async function handleSelectionRange(
  input: SelectionRangeInput,
): Promise<SelectionRangeResponse> {
  const { file_path, line, column } = input;

  const { client, uri, content } = await prepareFile(file_path);
  const position = toPosition(line, column, content);

  const result = await client.selectionRange(uri, [position]);

  if (!result || result.length === 0 || !result[0]) {
    return { ranges: [] };
  }

  return { ranges: flatten(result[0], content) };
}
