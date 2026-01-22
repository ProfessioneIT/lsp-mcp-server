import type { GotoDefinitionInput } from '../schemas/tool-schemas.js';
import type { DefinitionResponse } from '../types.js';
import { prepareFile, convertLocations, toPosition } from './utils.js';

/**
 * Handle lsp_goto_definition tool call.
 */
export async function handleGotoDefinition(
  input: GotoDefinitionInput
): Promise<DefinitionResponse> {
  const { file_path, line, column } = input;

  const { client, uri, content } = await prepareFile(file_path);

  // Convert position
  const position = toPosition(line, column, content);

  // Call LSP
  const result = await client.definition(uri, position);

  // Convert to our format
  const definitions = await convertLocations(result);

  return { definitions };
}

/**
 * Handle lsp_goto_type_definition tool call.
 */
export async function handleGotoTypeDefinition(
  input: GotoDefinitionInput
): Promise<DefinitionResponse> {
  const { file_path, line, column } = input;

  const { client, uri, content } = await prepareFile(file_path);

  // Convert position
  const position = toPosition(line, column, content);

  // Call LSP
  const result = await client.typeDefinition(uri, position);

  // Convert to our format
  const definitions = await convertLocations(result);

  return { definitions };
}
