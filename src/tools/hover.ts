import type { MarkupContent } from 'vscode-languageserver-protocol';
import type { HoverInput, SignatureHelpInput } from '../schemas/tool-schemas.js';
import type { HoverResponse, SignatureHelpResponse } from '../types.js';
import { prepareFile, toPosition } from './utils.js';
import { fromLspRange } from '../utils/position.js';

/**
 * Convert hover contents to string.
 */
function hoverContentsToString(contents: unknown): string {
  if (typeof contents === 'string') {
    return contents;
  }

  if (Array.isArray(contents)) {
    return contents.map(c => hoverContentsToString(c)).join('\n\n');
  }

  if (contents && typeof contents === 'object') {
    // MarkedString or MarkupContent
    if ('value' in contents) {
      const obj = contents as { language?: string; value: string };
      if (obj.language) {
        return `\`\`\`${obj.language}\n${obj.value}\n\`\`\``;
      }
      return obj.value;
    }
    if ('kind' in contents && 'value' in contents) {
      return (contents as MarkupContent).value;
    }
  }

  return String(contents);
}

/**
 * Handle lsp_hover tool call.
 */
export async function handleHover(
  input: HoverInput
): Promise<HoverResponse | null> {
  const { file_path, line, column } = input;

  const { client, uri, content } = await prepareFile(file_path);

  // Convert position
  const position = toPosition(line, column, content);

  // Call LSP
  const result = await client.hover(uri, position);

  if (!result) {
    return null;
  }

  const response: HoverResponse = {
    contents: hoverContentsToString(result.contents),
  };

  if (result.range) {
    const { start, end } = fromLspRange(result.range, content);
    response.range = { start, end };
  }

  return response;
}

/**
 * Handle lsp_signature_help tool call.
 */
export async function handleSignatureHelp(
  input: SignatureHelpInput
): Promise<SignatureHelpResponse | null> {
  const { file_path, line, column } = input;

  const { client, uri, content } = await prepareFile(file_path);

  // Convert position
  const position = toPosition(line, column, content);

  // Call LSP
  const result = await client.signatureHelp(uri, position);

  if (!result || result.signatures.length === 0) {
    return null;
  }

  const signatures = result.signatures.map(sig => {
    const sigResult: {
      label: string;
      documentation?: string;
      parameters?: Array<{ label: string; documentation?: string }>;
    } = {
      label: sig.label,
    };

    const doc = typeof sig.documentation === 'string'
      ? sig.documentation
      : sig.documentation?.value;
    if (doc) {
      sigResult.documentation = doc;
    }

    if (sig.parameters && sig.parameters.length > 0) {
      sigResult.parameters = sig.parameters.map(p => {
        const paramResult: { label: string; documentation?: string } = {
          label: typeof p.label === 'string' ? p.label : `[${p.label[0]}, ${p.label[1]}]`,
        };
        const paramDoc = typeof p.documentation === 'string'
          ? p.documentation
          : p.documentation?.value;
        if (paramDoc) {
          paramResult.documentation = paramDoc;
        }
        return paramResult;
      });
    }

    return sigResult;
  });

  return {
    signatures,
    active_signature: result.activeSignature ?? 0,
    active_parameter: result.activeParameter ?? 0,
  };
}
