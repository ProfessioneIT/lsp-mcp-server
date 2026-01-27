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

import type { DiagnosticsInput, WorkspaceDiagnosticsInput } from '../schemas/tool-schemas.js';
import type { DiagnosticsResponse, DiagnosticResult, WorkspaceDiagnosticsResponse, WorkspaceDiagnosticItem } from '../types.js';
import { prepareFile, getDiagnosticSeverityName } from './utils.js';
import { fromLspRange, getLineContent } from '../utils/position.js';
import { uriToPath, readFile } from '../utils/uri.js';
import { getToolContext } from './context.js';

const SEVERITY_ORDER = { error: 1, warning: 2, info: 3, hint: 4 };

/**
 * Handle lsp_diagnostics tool call.
 */
export async function handleDiagnostics(
  input: DiagnosticsInput
): Promise<DiagnosticsResponse> {
  const { file_path, severity_filter } = input;

  const { client, uri, content } = await prepareFile(file_path);

  // Get cached diagnostics
  const diagnostics = client.getCachedDiagnostics(uri);

  // Convert and filter
  const results: DiagnosticResult[] = [];
  let errors = 0;
  let warnings = 0;
  let info = 0;
  let hints = 0;

  for (const diag of diagnostics) {
    const severity = getDiagnosticSeverityName(diag.severity);

    // Count all for summary
    switch (severity) {
      case 'error': errors++; break;
      case 'warning': warnings++; break;
      case 'info': info++; break;
      case 'hint': hints++; break;
    }

    // Filter by severity
    if (severity_filter !== 'all') {
      const filterLevel = SEVERITY_ORDER[severity_filter];
      const diagLevel = SEVERITY_ORDER[severity];
      if (diagLevel > filterLevel) {
        continue;
      }
    }

    const { start, end } = fromLspRange(diag.range, content);
    const contextLine = getLineContent(content, start.line) ?? '';

    const result: DiagnosticResult = {
      range: { start, end },
      severity,
      message: diag.message,
      context: contextLine.trim(),
    };

    if (diag.code !== undefined) {
      result.code = diag.code;
    }

    if (diag.source) {
      result.source = diag.source;
    }

    results.push(result);
  }

  return {
    diagnostics: results,
    summary: { errors, warnings, info, hints },
    note: 'Diagnostics are cached from language server notifications. If file was recently modified, re-open it to refresh.',
  };
}

/**
 * Handle lsp_workspace_diagnostics tool call.
 * Returns all diagnostics across the workspace from cache.
 */
export async function handleWorkspaceDiagnostics(
  input: WorkspaceDiagnosticsInput
): Promise<WorkspaceDiagnosticsResponse> {
  const { severity_filter, limit, group_by } = input;
  const ctx = getToolContext();

  // Get all cached URIs
  const uris = ctx.diagnosticsCache.getUris();

  // Collect all diagnostics with file info
  const allItems: WorkspaceDiagnosticItem[] = [];
  const filesWithDiagnostics = new Set<string>();

  for (const uri of uris) {
    const diagnostics = ctx.diagnosticsCache.get(uri);
    if (diagnostics.length === 0) continue;

    const filePath = uriToPath(uri);
    filesWithDiagnostics.add(filePath);

    // Get file content for context lines
    let content = ctx.documentManager.getContent(uri);
    if (!content) {
      try {
        content = await readFile(filePath);
      } catch {
        content = '';
      }
    }

    for (const diag of diagnostics) {
      const severity = getDiagnosticSeverityName(diag.severity);

      // Filter by severity
      if (severity_filter !== 'all') {
        const filterLevel = SEVERITY_ORDER[severity_filter];
        const diagLevel = SEVERITY_ORDER[severity];
        if (diagLevel > filterLevel) {
          continue;
        }
      }

      const { start, end } = fromLspRange(diag.range, content);
      const contextLine = getLineContent(content, start.line) ?? '';

      const item: WorkspaceDiagnosticItem = {
        file: filePath,
        line: start.line,
        column: start.column,
        end_line: end.line,
        end_column: end.column,
        severity,
        message: diag.message,
        context: contextLine.trim(),
      };

      if (diag.code !== undefined) {
        item.code = diag.code;
      }

      if (diag.source) {
        item.source = diag.source;
      }

      allItems.push(item);
    }
  }

  // Sort based on group_by
  if (group_by === 'severity') {
    allItems.sort((a, b) => {
      const severityDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (severityDiff !== 0) return severityDiff;
      return a.file.localeCompare(b.file) || a.line - b.line;
    });
  } else {
    // group_by === 'file' (default)
    allItems.sort((a, b) => {
      const fileDiff = a.file.localeCompare(b.file);
      if (fileDiff !== 0) return fileDiff;
      return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.line - b.line;
    });
  }

  // Apply limit
  const items = allItems.slice(0, limit);

  // Get summary
  const summary = ctx.diagnosticsCache.getSummary();

  return {
    items,
    total_count: allItems.length,
    returned_count: items.length,
    files_affected: filesWithDiagnostics.size,
    summary,
    note: 'Diagnostics are from cache. Only files that have been opened in this session will have diagnostics. Use lsp_diagnostics on specific files to refresh.',
  };
}
