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
