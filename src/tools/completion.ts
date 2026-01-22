import type { CompletionItem, CompletionList } from 'vscode-languageserver-protocol';
import type { CompletionsInput } from '../schemas/tool-schemas.js';
import type { CompletionsResponse, CompletionResult } from '../types.js';
import { prepareFile, toPosition, getCompletionKindName } from './utils.js';

/**
 * Convert completion item documentation to string.
 */
function documentationToString(doc: CompletionItem['documentation']): string | undefined {
  if (!doc) {
    return undefined;
  }

  if (typeof doc === 'string') {
    return doc;
  }

  if ('value' in doc) {
    return doc.value;
  }

  return undefined;
}

/**
 * Convert CompletionItem to our format.
 */
function completionItemToResult(item: CompletionItem): CompletionResult {
  const result: CompletionResult = {
    label: item.label,
    kind: getCompletionKindName(item.kind),
  };

  if (item.detail) {
    result.detail = item.detail;
  }

  const doc = documentationToString(item.documentation);
  if (doc) {
    result.documentation = doc;
  }

  if (item.insertText) {
    result.insert_text = item.insertText;
  }

  if (item.sortText) {
    result.sort_text = item.sortText;
  }

  return result;
}

/**
 * Handle lsp_completions tool call.
 */
export async function handleCompletions(
  input: CompletionsInput
): Promise<CompletionsResponse> {
  const { file_path, line, column, limit } = input;

  const { client, uri, content } = await prepareFile(file_path);

  // Convert position
  const position = toPosition(line, column, content);

  // Call LSP
  const result = await client.completion(uri, position);

  if (!result) {
    return {
      completions: [],
      is_incomplete: false,
    };
  }

  // Normalize to array and check if incomplete
  let items: CompletionItem[];
  let isIncomplete = false;

  if (Array.isArray(result)) {
    items = result;
  } else {
    // CompletionList
    const list = result as CompletionList;
    items = list.items;
    isIncomplete = list.isIncomplete;
  }

  // Convert and limit
  const completions = items
    .slice(0, limit)
    .map(item => completionItemToResult(item));

  return {
    completions,
    is_incomplete: isIncomplete || items.length > limit,
  };
}
