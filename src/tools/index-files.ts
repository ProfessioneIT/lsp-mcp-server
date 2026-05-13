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

import type { IndexFilesInput } from '../schemas/tool-schemas.js';
import type { IndexFilesResponse } from '../types.js';
import { prepareFile } from './utils.js';

/**
 * Open a list of files so the relevant language servers begin publishing
 * diagnostics for them. This is the warm-up step before lsp_workspace_diagnostics
 * or lsp_related_files (imported_by branch), which only see opened files.
 *
 * Errors per file are reported individually — one bad file does not abort the batch.
 */
export async function handleIndexFiles(
  input: IndexFilesInput,
): Promise<IndexFilesResponse> {
  const { files } = input;

  const opened: string[] = [];
  const failed: Array<{ file: string; error: string }> = [];

  // Open files in parallel — each prepareFile() call routes to the right
  // language server and sends didOpen, after which diagnostics flow in.
  await Promise.all(
    files.map(async (file) => {
      try {
        await prepareFile(file);
        opened.push(file);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failed.push({ file, error: message });
      }
    }),
  );

  return {
    opened,
    failed,
    opened_count: opened.length,
    failed_count: failed.length,
  };
}
