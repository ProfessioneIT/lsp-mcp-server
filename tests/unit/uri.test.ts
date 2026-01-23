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

import { describe, it, expect } from 'vitest';
import {
  pathToUri,
  uriToPath,
  getExtension,
  normalizePath,
} from '../../src/utils/uri.js';

describe('URI utilities', () => {
  describe('pathToUri', () => {
    it('converts absolute path to file URI', () => {
      expect(pathToUri('/home/user/file.ts')).toBe('file:///home/user/file.ts');
    });

    it('encodes special characters', () => {
      expect(pathToUri('/home/user/my file.ts')).toBe('file:///home/user/my%20file.ts');
    });
  });

  describe('uriToPath', () => {
    it('converts file URI to path', () => {
      expect(uriToPath('file:///home/user/file.ts')).toBe('/home/user/file.ts');
    });

    it('decodes special characters', () => {
      expect(uriToPath('file:///home/user/my%20file.ts')).toBe('/home/user/my file.ts');
    });

    it('throws on non-file URIs', () => {
      expect(() => uriToPath('untitled:Untitled-1')).toThrow('Invalid file URI');
    });
  });

  describe('getExtension', () => {
    it('returns file extension with dot', () => {
      expect(getExtension('/path/to/file.ts')).toBe('.ts');
      expect(getExtension('/path/to/file.test.ts')).toBe('.ts');
    });

    it('returns empty string for no extension', () => {
      expect(getExtension('/path/to/file')).toBe('');
      expect(getExtension('/path/to/.gitignore')).toBe('');
    });
  });

  describe('normalizePath', () => {
    it('normalizes path separators', () => {
      expect(normalizePath('/path/to/file.ts')).toBe('/path/to/file.ts');
    });

    it('removes trailing slash', () => {
      expect(normalizePath('/path/to/dir/')).toBe('/path/to/dir');
    });

    it('resolves relative components', () => {
      expect(normalizePath('/path/to/../to/file.ts')).toBe('/path/to/file.ts');
    });
  });
});
