import type { FindReferencesInput, FindImplementationsInput } from '../schemas/tool-schemas.js';
import type { ReferencesResponse, ImplementationsResponse } from '../types.js';
import { prepareFile, locationToResult, toPosition } from './utils.js';

/**
 * Handle lsp_find_references tool call.
 */
export async function handleFindReferences(
  input: FindReferencesInput
): Promise<ReferencesResponse> {
  const { file_path, line, column, include_declaration, limit, offset } = input;

  const { client, uri, content } = await prepareFile(file_path);

  // Convert position
  const position = toPosition(line, column, content);

  // Call LSP
  const result = await client.references(uri, position, include_declaration);

  if (!result) {
    return {
      references: [],
      total_count: 0,
      returned_count: 0,
      offset: 0,
      has_more: false,
    };
  }

  // Convert all locations
  const allReferences = await Promise.all(
    result.map(loc => locationToResult(loc))
  );

  // Apply pagination
  const total = allReferences.length;
  const paginated = allReferences.slice(offset, offset + limit);

  return {
    references: paginated,
    total_count: total,
    returned_count: paginated.length,
    offset,
    has_more: offset + paginated.length < total,
  };
}

/**
 * Handle lsp_find_implementations tool call.
 */
export async function handleFindImplementations(
  input: FindImplementationsInput
): Promise<ImplementationsResponse> {
  const { file_path, line, column, limit } = input;

  const { client, uri, content } = await prepareFile(file_path);

  // Convert position
  const position = toPosition(line, column, content);

  // Call LSP
  const result = await client.implementation(uri, position);

  if (!result) {
    return {
      implementations: [],
      total_count: 0,
      returned_count: 0,
      has_more: false,
    };
  }

  // Normalize to array
  const locations = Array.isArray(result) ? result : [result];

  // Convert all locations
  const allImplementations = await Promise.all(
    locations.map(async loc => {
      if ('targetUri' in loc) {
        // LocationLink
        const { locationLinkToResult } = await import('./utils.js');
        return locationLinkToResult(loc);
      }
      return locationToResult(loc);
    })
  );

  // Apply limit
  const limited = allImplementations.slice(0, limit);

  return {
    implementations: limited,
    total_count: allImplementations.length,
    returned_count: limited.length,
    has_more: limited.length < allImplementations.length,
  };
}
