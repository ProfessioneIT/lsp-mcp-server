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

import type { TextEdit, WorkspaceEdit } from 'vscode-languageserver-protocol';
import type { RenameInput } from '../schemas/tool-schemas.js';
import type { RenameResponse, RenameEdit } from '../types.js';
import { prepareFile, toPosition } from './utils.js';
import { fromLspRange, getLineContent } from '../utils/position.js';
import { uriToPath, readFile, validatePathWithinWorkspace } from '../utils/uri.js';
import * as fs from 'fs/promises';
import type { ServerCapabilities } from 'vscode-languageserver-protocol';
import { LSPError, LSPErrorCode } from '../types.js';

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

  // Per the LSP spec, only servers advertising `renameProvider.prepareProvider`
  // support prepareRename; `renameProvider: true` means rename without it.
  // When the server does support it, a null result or an error means the
  // position cannot be renamed, and that must be reported rather than turned
  // into an empty rename. The one exception is MethodNotFound, from servers
  // that advertise prepareProvider without implementing it.
  let prepareResult: Awaited<ReturnType<typeof client.prepareRename>> = null;
  if (supportsPrepareRename(client.capabilities)) {
    let prepareImplemented = true;
    try {
      prepareResult = await client.prepareRename(uri, position);
    } catch (error) {
      if (!isMethodNotFound(error)) {
        throw error;
      }
      prepareImplemented = false;
    }

    if (prepareImplemented && !prepareResult) {
      throw new LSPError(
        LSPErrorCode.RENAME_NOT_ALLOWED,
        'Rename is not allowed at this position',
        'Move cursor to a renameable symbol (variable, function, class, etc.)',
        { file_path, position: { line, column } }
      );
    }
  }

  // Extract original name if available
  let originalName: string | undefined;
  if (prepareResult && typeof prepareResult === 'object' && 'placeholder' in prepareResult) {
    originalName = prepareResult.placeholder;
  }

  // Perform rename
  const workspaceEdit = await client.rename(uri, position, new_name);

  const { editsByUri, fileOperations } = collectTextEdits(workspaceEdit);

  if (fileOperations > 0 && !dry_run) {
    // Refuse before writing anything, rather than applying half a rename
    throw new LSPError(
      LSPErrorCode.CAPABILITY_NOT_SUPPORTED,
      'This rename also creates, renames, or deletes files, which lsp_rename cannot apply',
      'Run with dry_run=true to preview the text edits, then apply them and the file operations manually.',
      { file_path }
    );
  }

  if (Object.keys(editsByUri).length === 0) {
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

  for (const [fileUri, edits] of Object.entries(editsByUri)) {
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
    const workspaceRoot = client.workspaceRoot;

    for (const [fileUri, edits] of Object.entries(editsByUri)) {
      const filePath = uriToPath(fileUri);
      // Validate file is within workspace to prevent writing outside it
      validatePathWithinWorkspace(filePath, workspaceRoot);
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

  if (fileOperations > 0) {
    response.note = `The server also proposed ${fileOperations} file operation(s) (create, rename, or delete), which are not shown and cannot be applied by lsp_rename.`;
  }

  return response;
}

/** JSON-RPC error code for a method the server does not implement. */
const METHOD_NOT_FOUND = -32601;

function supportsPrepareRename(capabilities: ServerCapabilities): boolean {
  const provider = capabilities.renameProvider;
  return typeof provider === 'object' && provider !== null && provider.prepareProvider === true;
}

function isMethodNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === METHOD_NOT_FOUND;
}

/**
 * Collect text edits from a WorkspaceEdit, whether the server used `changes`
 * or `documentChanges` (e.g. pylsp). File create/rename/delete operations in
 * documentChanges are counted but not collected.
 */
function collectTextEdits(workspaceEdit: WorkspaceEdit | null): {
  editsByUri: Record<string, TextEdit[]>;
  fileOperations: number;
} {
  const editsByUri: Record<string, TextEdit[]> = {};
  let fileOperations = 0;

  if (!workspaceEdit) {
    return { editsByUri, fileOperations };
  }

  for (const [fileUri, edits] of Object.entries(workspaceEdit.changes ?? {})) {
    (editsByUri[fileUri] ??= []).push(...edits);
  }

  for (const change of workspaceEdit.documentChanges ?? []) {
    if ('textDocument' in change) {
      const edits = change.edits.map((e): TextEdit =>
        'newText' in e ? e : { range: e.range, newText: e.snippet.value }
      );
      (editsByUri[change.textDocument.uri] ??= []).push(...edits);
    } else {
      fileOperations++;
    }
  }

  return { editsByUri, fileOperations };
}
