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

import * as fs from 'node:fs';
import * as path from 'node:path';
import { strictFileUriToPath } from '../utils/uri.js';

function isMissingPathError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') {
    return false;
  }

  const code = Reflect.get(error, 'code');
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * Canonicalize a possibly missing path through its nearest existing ancestor.
 * Broken links, non-directory ancestors, and permission errors fail closed.
 */
function canonicalizePotentialPath(filePath: string): string | undefined {
  let current = path.resolve(filePath);
  const missingSegments: string[] = [];

  while (true) {
    try {
      fs.lstatSync(current);
    } catch (error) {
      if (!isMissingPathError(error)) {
        return undefined;
      }

      const parent = path.dirname(current);
      if (parent === current) {
        return undefined;
      }
      missingSegments.push(path.basename(current));
      current = parent;
      continue;
    }

    let canonicalAncestor: string;
    try {
      canonicalAncestor = fs.realpathSync(current);
      if (
        missingSegments.length > 0 &&
        !fs.statSync(canonicalAncestor).isDirectory()
      ) {
        return undefined;
      }
    } catch {
      return undefined;
    }

    return path.resolve(canonicalAncestor, ...missingSegments.reverse());
  }
}

/**
 * Determine whether an LSP scope URI belongs to the selected workspace.
 */
export function isScopeInWorkspace(
  scopeUri: string | undefined,
  workspaceRoot: string,
): boolean {
  if (scopeUri === undefined) {
    return true;
  }

  try {
    const canonicalRoot = canonicalizePotentialPath(workspaceRoot);
    const scopePath = strictFileUriToPath(scopeUri);
    const canonicalScope = canonicalizePotentialPath(scopePath);
    if (!canonicalRoot || !canonicalScope) {
      return false;
    }

    const relative = path.relative(canonicalRoot, canonicalScope);
    return (
      relative === '' ||
      (relative !== '..' &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative))
    );
  } catch {
    return false;
  }
}
