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

import type { CodeAction, Command, WorkspaceEdit, TextEdit } from 'vscode-languageserver-protocol';
import type { CodeActionsInput } from '../schemas/tool-schemas.js';
import type { CodeActionsResponse, CodeActionResult, DiagnosticResult } from '../types.js';
import { LSPError, LSPErrorCode } from '../types.js';
import { prepareFile, toPosition, getDiagnosticSeverityName } from './utils.js';
import { fromLspRange } from '../utils/position.js';
import { uriToPath, readFile, validatePathWithinWorkspace } from '../utils/uri.js';
import * as fs from 'fs/promises';

/**
 * Check if the action is a CodeAction (not just a Command).
 */
function isCodeAction(action: CodeAction | Command): action is CodeAction {
  return 'kind' in action || 'edit' in action || 'diagnostics' in action;
}

/**
 * Convert workspace edit to our format.
 */
function convertWorkspaceEdit(
  edit: WorkspaceEdit | undefined
): CodeActionResult['edit'] | undefined {
  if (!edit || !edit.changes) {
    return undefined;
  }

  const changes: Record<string, Array<{
    range: { start: { line: number; column: number }; end: { line: number; column: number } };
    new_text: string;
  }>> = {};

  let filesAffected = 0;

  for (const [uri, edits] of Object.entries(edit.changes)) {
    const filePath = uriToPath(uri);
    filesAffected++;

    changes[filePath] = edits.map((e: TextEdit) => ({
      range: {
        start: { line: e.range.start.line + 1, column: e.range.start.character + 1 },
        end: { line: e.range.end.line + 1, column: e.range.end.character + 1 },
      },
      new_text: e.newText,
    }));
  }

  return {
    files_affected: filesAffected,
    changes,
  };
}

/**
 * Convert LSP diagnostic to our format.
 */
function convertDiagnostic(diag: { range: { start: { line: number; character: number }; end: { line: number; character: number } }; severity?: number; code?: string | number; source?: string; message: string }, content: string): DiagnosticResult {
  const range = fromLspRange(diag.range, content);
  const lines = content.split('\n');
  const contextLine = lines[diag.range.start.line] ?? '';

  const result: DiagnosticResult = {
    range,
    severity: getDiagnosticSeverityName(diag.severity),
    message: diag.message,
    context: contextLine.trim(),
  };

  if (diag.code !== undefined) {
    result.code = diag.code;
  }

  if (diag.source !== undefined) {
    result.source = diag.source;
  }

  return result;
}

/**
 * Apply edits from a WorkspaceEdit to files.
 */
async function applyWorkspaceEdit(edit: WorkspaceEdit, workspaceRoot: string): Promise<number> {
  if (!edit.changes) {
    return 0;
  }

  let filesModified = 0;

  for (const [fileUri, edits] of Object.entries(edit.changes)) {
    const filePath = uriToPath(fileUri);

    // Validate file is within workspace before writing
    validatePathWithinWorkspace(filePath, workspaceRoot);

    // Read current content
    const content = await readFile(filePath);

    // Sort edits by position in reverse order (apply from end to start)
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
    filesModified++;
  }

  return filesModified;
}

/**
 * Handle lsp_code_actions tool call.
 */
export async function handleCodeActions(
  input: CodeActionsInput
): Promise<CodeActionsResponse> {
  const { file_path, start_line, start_column, end_line, end_column, kinds, apply, action_index } = input;

  const { client, uri, content } = await prepareFile(file_path);

  // Build the range
  const startPos = toPosition(start_line, start_column, content);
  const endPos = toPosition(end_line ?? start_line, end_column ?? start_column, content);

  const range = {
    start: startPos,
    end: endPos,
  };

  // Get diagnostics in range for context
  const allDiagnostics = client.getCachedDiagnostics(uri);
  const diagnosticsInRange = allDiagnostics.filter(d => {
    const dStart = d.range.start;
    const dEnd = d.range.end;
    // Check if diagnostic overlaps with the range
    return !(dEnd.line < startPos.line ||
             (dEnd.line === startPos.line && dEnd.character < startPos.character) ||
             dStart.line > endPos.line ||
             (dStart.line === endPos.line && dStart.character > endPos.character));
  });

  // Call LSP
  const result = await client.codeActions(uri, range, diagnosticsInRange, kinds);

  if (!result || result.length === 0) {
    return {
      actions: [],
      total_count: 0,
    };
  }

  // If apply is requested, apply the selected action
  let applied = false;
  let appliedAction: CodeActionResult | undefined;

  if (apply) {
    const indexToApply = action_index ?? 0;

    if (indexToApply < 0 || indexToApply >= result.length) {
      throw new LSPError(
        LSPErrorCode.INVALID_POSITION,
        `Invalid action index: ${indexToApply}. Available actions: 0-${result.length - 1}`,
        'Specify a valid action_index within the range of available actions.',
        { file_path }
      );
    }

    const actionToApply = result[indexToApply]!; // Safe: bounds checked above

    if (isCodeAction(actionToApply) && actionToApply.edit) {
      await applyWorkspaceEdit(actionToApply.edit, client.workspaceRoot);
      applied = true;
    } else if (isCodeAction(actionToApply) && actionToApply.command) {
      // Commands cannot be applied directly - they require LSP executeCommand
      throw new LSPError(
        LSPErrorCode.CAPABILITY_NOT_SUPPORTED,
        `Action "${actionToApply.title}" requires command execution which is not supported`,
        'This action cannot be applied automatically. It requires IDE command execution.',
        { file_path }
      );
    } else if (!isCodeAction(actionToApply)) {
      throw new LSPError(
        LSPErrorCode.CAPABILITY_NOT_SUPPORTED,
        `Action "${actionToApply.title}" is a command-only action`,
        'This action cannot be applied automatically. It requires IDE command execution.',
        { file_path }
      );
    } else {
      throw new LSPError(
        LSPErrorCode.CAPABILITY_NOT_SUPPORTED,
        `Action "${actionToApply.title}" has no edit to apply`,
        'This action does not provide file edits.',
        { file_path }
      );
    }
  }

  // Convert to our format
  const actions: CodeActionResult[] = result.map((action, index) => {
    if (isCodeAction(action)) {
      const actionResult: CodeActionResult = {
        title: action.title,
      };

      if (action.kind) {
        actionResult.kind = action.kind;
      }

      if (action.isPreferred) {
        actionResult.is_preferred = action.isPreferred;
      }

      if (action.diagnostics && action.diagnostics.length > 0) {
        actionResult.diagnostics = action.diagnostics.map(d => convertDiagnostic(d, content));
      }

      const convertedEdit = convertWorkspaceEdit(action.edit);
      if (convertedEdit) {
        actionResult.edit = convertedEdit;
      }

      if (action.command) {
        actionResult.command = {
          title: action.command.title,
          command: action.command.command,
        };
        if (action.command.arguments) {
          actionResult.command.arguments = action.command.arguments;
        }
      }

      // Track the applied action
      if (applied && index === (action_index ?? 0)) {
        appliedAction = actionResult;
      }

      return actionResult;
    } else {
      // It's just a Command
      const cmdResult: CodeActionResult = {
        title: action.title,
        command: {
          title: action.title,
          command: action.command,
        },
      };
      if (action.arguments) {
        cmdResult.command!.arguments = action.arguments;
      }
      return cmdResult;
    }
  });

  const response: CodeActionsResponse = {
    actions,
    total_count: actions.length,
  };

  if (applied && appliedAction) {
    response.applied = appliedAction;
  }

  return response;
}
