import type { CodeAction, Command, WorkspaceEdit, TextEdit } from 'vscode-languageserver-protocol';
import type { CodeActionsInput } from '../schemas/tool-schemas.js';
import type { CodeActionsResponse, CodeActionResult, DiagnosticResult } from '../types.js';
import { prepareFile, toPosition, getDiagnosticSeverityName } from './utils.js';
import { fromLspRange } from '../utils/position.js';
import { uriToPath } from '../utils/uri.js';

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
 * Handle lsp_code_actions tool call.
 */
export async function handleCodeActions(
  input: CodeActionsInput
): Promise<CodeActionsResponse> {
  const { file_path, start_line, start_column, end_line, end_column, kinds } = input;

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

  // Convert to our format
  const actions: CodeActionResult[] = result.map(action => {
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

  return {
    actions,
    total_count: actions.length,
  };
}
