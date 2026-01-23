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

import type { TextEdit } from 'vscode-languageserver-protocol';
import type { RenameInput } from '../schemas/tool-schemas.js';
import type { RenameResponse, RenameEdit } from '../types.js';
import { prepareFile, toPosition } from './utils.js';
import { fromLspRange, getLineContent } from '../utils/position.js';
import { uriToPath, readFile } from '../utils/uri.js';
import { LSPError, LSPErrorCode } from '../types.js';
import * as fs from 'fs/promises';

/**
 * Convert TextEdit to RenameEdit.
 */
async function textEditToRenameEdit(
  edit: TextEdit,
  uri: string,
  cachedContent?: string
): Promise<RenameEdit> {
  const filePath = uriToPath(uri);

  let content = cachedContent;
  if (!content) {
    try {
      content = await readFile(filePath);
    } catch {
      content = '';
    }
  }

  const { start, end } = fromLspRange(edit.range, content);
  const contextLine = getLineContent(content, start.line) ?? '';

  return {
    range: { start, end },
    new_text: edit.newText,
    context: contextLine.trim(),
  };
}

/**
 * Apply edits to a file.
 */
async function applyEditsToFile(
  filePath: string,
  edits: TextEdit[]
): Promise<void> {
  // Read current content
  const content = await readFile(filePath);

  // Sort edits by position in reverse order (apply from end to start)
  // to maintain correct positions for earlier edits
  const sortedEdits = [...edits].sort((a, b) => {
    if (a.range.start.line !== b.range.start.line) {
      return b.range.start.line - a.range.start.line;
    }
    return b.range.start.character - a.range.start.character;
  });

  // Apply edits
  const lines = content.split('\n');
  let currentContent = content;

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
    currentContent =
      currentContent.substring(0, startOffset) +
      edit.newText +
      currentContent.substring(endOffset);
  }

  // Write back
  await fs.writeFile(filePath, currentContent, 'utf-8');
}

/**
 * Handle lsp_rename tool call.
 */
export async function handleRename(
  input: RenameInput
): Promise<RenameResponse> {
  const { file_path, line, column, new_name, dry_run } = input;

  const { client, uri, content } = await prepareFile(file_path);

  // Convert position
  const position = toPosition(line, column, content);

  // First, check if rename is valid at this position
  const prepareResult = await client.prepareRename(uri, position);

  if (!prepareResult) {
    throw new LSPError(
      LSPErrorCode.RENAME_NOT_ALLOWED,
      'Rename is not allowed at this position',
      'Move cursor to a renameable symbol (variable, function, class, etc.)',
      { file_path, position: { line, column } }
    );
  }

  // Extract original name if available
  let originalName: string | undefined;
  if ('placeholder' in prepareResult) {
    originalName = prepareResult.placeholder;
  }

  // Perform rename
  const workspaceEdit = await client.rename(uri, position, new_name);

  if (!workspaceEdit || !workspaceEdit.changes) {
    const emptyResult: RenameResponse = {
      changes: {},
      files_affected: 0,
      edits_count: 0,
      applied: false,
    };
    if (originalName) {
      emptyResult.original_name = originalName;
    }
    return emptyResult;
  }

  // Convert to our format
  const changes: Record<string, RenameEdit[]> = {};
  let totalEdits = 0;

  // Cache file contents to avoid reading the same file multiple times
  const contentCache = new Map<string, string>();
  contentCache.set(uri, content);

  for (const [fileUri, edits] of Object.entries(workspaceEdit.changes)) {
    const filePath = uriToPath(fileUri);

    // Get or cache content
    let fileContent = contentCache.get(fileUri);
    if (!fileContent) {
      try {
        fileContent = await readFile(filePath);
        contentCache.set(fileUri, fileContent);
      } catch {
        fileContent = '';
      }
    }

    // Convert edits
    const renameEdits: RenameEdit[] = [];
    for (const edit of edits) {
      renameEdits.push(await textEditToRenameEdit(edit, fileUri, fileContent));
      totalEdits++;
    }

    changes[filePath] = renameEdits;
  }

  // Apply changes if not dry run
  if (!dry_run) {
    for (const [fileUri, edits] of Object.entries(workspaceEdit.changes)) {
      const filePath = uriToPath(fileUri);
      await applyEditsToFile(filePath, edits);
    }
  }

  const response: RenameResponse = {
    changes,
    files_affected: Object.keys(changes).length,
    edits_count: totalEdits,
    applied: !dry_run,
  };

  if (originalName) {
    response.original_name = originalName;
  }

  return response;
}
