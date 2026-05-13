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

import type { InlayHint } from 'vscode-languageserver-protocol';
import type { InlayHintsInput } from '../schemas/tool-schemas.js';
import type { InlayHintsResponse, InlayHintResult } from '../types.js';
import { prepareFile, toPosition } from './utils.js';
import { fromLspPosition } from '../utils/position.js';

const KIND_NAMES: Record<number, 'type' | 'parameter'> = {
  1: 'type',
  2: 'parameter',
};

function labelToString(label: InlayHint['label']): string {
  if (typeof label === 'string') {
    return label;
  }
  return label.map((p) => p.value).join('');
}

function tooltipToString(tooltip: InlayHint['tooltip']): string | undefined {
  if (!tooltip) return undefined;
  if (typeof tooltip === 'string') return tooltip;
  return tooltip.value;
}

export async function handleInlayHints(
  input: InlayHintsInput,
): Promise<InlayHintsResponse> {
  const { file_path, start_line, start_column, end_line, end_column, limit } = input;

  const { client, uri, content } = await prepareFile(file_path);

  const range = {
    start: toPosition(start_line, start_column, content),
    end: toPosition(end_line, end_column, content),
  };

  const result = await client.inlayHints(uri, range);

  if (!result || result.length === 0) {
    return {
      hints: [],
      range: {
        start: { line: start_line, column: start_column },
        end: { line: end_line, column: end_column },
      },
    };
  }

  const hints: InlayHintResult[] = result.slice(0, limit).map((h) => {
    const pos = fromLspPosition(h.position, content);
    const hint: InlayHintResult = {
      line: pos.line,
      column: pos.column,
      label: labelToString(h.label),
    };
    if (h.kind) {
      const kind = KIND_NAMES[h.kind];
      if (kind) hint.kind = kind;
    }
    const tooltip = tooltipToString(h.tooltip);
    if (tooltip) hint.tooltip = tooltip;
    if (h.paddingLeft) hint.padding_left = true;
    if (h.paddingRight) hint.padding_right = true;
    return hint;
  });

  return {
    hints,
    range: {
      start: { line: start_line, column: start_column },
      end: { line: end_line, column: end_column },
    },
  };
}
