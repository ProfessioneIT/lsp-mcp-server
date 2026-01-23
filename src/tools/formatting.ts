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

import type { TextEdit, FormattingOptions } from 'vscode-languageserver-protocol';
import type { FormatDocumentInput } from '../schemas/tool-schemas.js';
import type { FormatDocumentResponse, FormatEdit } from '../types.js';
import { prepareFile } from './utils.js';
import { readFile } from '../utils/uri.js';
import * as fs from 'fs/promises';

/**
 * Convert TextEdit to FormatEdit.
 */
function convertEdit(edit: TextEdit): FormatEdit {
  return {
    range: {
      start: { line: edit.range.start.line + 1, column: edit.range.start.character + 1 },
      end: { line: edit.range.end.line + 1, column: edit.range.end.character + 1 },
    },
    new_text: edit.newText,
  };
}

/**
 * Apply edits to content (edits must be sorted by position, applied from end to start).
 */
function applyEdits(content: string, edits: TextEdit[]): string {
  // Sort edits by position in reverse order (apply from end to start)
  const sortedEdits = [...edits].sort((a, b) => {
    if (a.range.start.line !== b.range.start.line) {
      return b.range.start.line - a.range.start.line;
    }
    return b.range.start.character - a.range.start.character;
  });

  const lines = content.split('\n');
  let result = content;

  for (const edit of sortedEdits) {
    // Calculate byte offsets
    let startOffset = 0;
    for (let i = 0; i < edit.range.start.line; i++) {
      startOffset += (lines[i]?.length ?? 0) + 1; // +1 for newline
    }
    startOffset += edit.range.start.character;

    let endOffset = 0;
    for (let i = 0; i < edit.range.end.line; i++) {
      endOffset += (lines[i]?.length ?? 0) + 1;
    }
    endOffset += edit.range.end.character;

    // Apply the edit
    result = result.substring(0, startOffset) + edit.newText + result.substring(endOffset);
  }

  return result;
}

/**
 * Handle lsp_format_document tool call.
 */
export async function handleFormatDocument(
  input: FormatDocumentInput
): Promise<FormatDocumentResponse> {
  const { file_path, tab_size, insert_spaces, apply } = input;

  const { client, uri } = await prepareFile(file_path);

  // Build formatting options
  const options: FormattingOptions = {
    tabSize: tab_size,
    insertSpaces: insert_spaces,
  };

  // Call LSP
  const result = await client.formatDocument(uri, options);

  if (!result || result.length === 0) {
    return {
      edits: [],
      edits_count: 0,
      applied: false,
    };
  }

  // Convert edits
  const edits = result.map(convertEdit);

  // Apply changes if requested
  if (apply) {
    const currentContent = await readFile(file_path);
    const newContent = applyEdits(currentContent, result);
    await fs.writeFile(file_path, newContent, 'utf-8');
  }

  return {
    edits,
    edits_count: edits.length,
    applied: apply,
  };
}
