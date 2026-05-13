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

import type { FoldingRangesInput } from '../schemas/tool-schemas.js';
import type { FoldingRangesResponse, FoldingRangeResult } from '../types.js';
import { prepareFile } from './utils.js';

export async function handleFoldingRanges(
  input: FoldingRangesInput,
): Promise<FoldingRangesResponse> {
  const { file_path, kind_filter } = input;

  const { client, uri } = await prepareFile(file_path);

  const result = await client.foldingRanges(uri);

  if (!result || result.length === 0) {
    return { ranges: [] };
  }

  const filtered = kind_filter === 'all'
    ? result
    : result.filter((r) => r.kind === kind_filter);

  const ranges: FoldingRangeResult[] = filtered.map((r) => {
    const item: FoldingRangeResult = {
      start_line: r.startLine + 1,
      end_line: r.endLine + 1,
    };
    if (r.startCharacter !== undefined) {
      item.start_column = r.startCharacter + 1;
    }
    if (r.endCharacter !== undefined) {
      item.end_column = r.endCharacter + 1;
    }
    if (r.kind) {
      item.kind = r.kind;
    }
    if (r.collapsedText) {
      item.collapsed_text = r.collapsedText;
    }
    return item;
  });

  return { ranges };
}
