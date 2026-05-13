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

import type { DocumentHighlightsInput } from '../schemas/tool-schemas.js';
import type { DocumentHighlightsResponse, DocumentHighlightResult } from '../types.js';
import { prepareFile, toPosition } from './utils.js';
import { fromLspRange, getLineContent } from '../utils/position.js';

const KIND_NAMES: Record<number, 'text' | 'read' | 'write'> = {
  1: 'text',
  2: 'read',
  3: 'write',
};

export async function handleDocumentHighlights(
  input: DocumentHighlightsInput,
): Promise<DocumentHighlightsResponse> {
  const { file_path, line, column } = input;

  const { client, uri, content } = await prepareFile(file_path);
  const position = toPosition(line, column, content);

  const result = await client.documentHighlight(uri, position);

  if (!result || result.length === 0) {
    return { highlights: [] };
  }

  const highlights: DocumentHighlightResult[] = result.map((h) => {
    const range = fromLspRange(h.range, content);
    const ctx = getLineContent(content, range.start.line)?.trim() ?? '';
    return {
      range,
      kind: h.kind ? KIND_NAMES[h.kind] ?? 'text' : 'text',
      context: ctx,
    };
  });

  return { highlights };
}
