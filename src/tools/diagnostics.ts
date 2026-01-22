import type { DiagnosticsInput } from '../schemas/tool-schemas.js';
import type { DiagnosticsResponse, DiagnosticResult } from '../types.js';
import { prepareFile, getDiagnosticSeverityName } from './utils.js';
import { fromLspRange, getLineContent } from '../utils/position.js';

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
