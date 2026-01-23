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
  GotoDefinitionSchema,
  FindReferencesSchema,
  DiagnosticsSchema,
  RenameSchema,
  WorkspaceSymbolsSchema,
} from '../../src/schemas/tool-schemas.js';

describe('Tool Schemas', () => {
  describe('GotoDefinitionSchema', () => {
    it('accepts valid input', () => {
      const result = GotoDefinitionSchema.safeParse({
        file_path: '/path/to/file.ts',
        line: 10,
        column: 5,
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing required fields', () => {
      const result = GotoDefinitionSchema.safeParse({
        file_path: '/path/to/file.ts',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid line numbers', () => {
      const result = GotoDefinitionSchema.safeParse({
        file_path: '/path/to/file.ts',
        line: 0, // must be >= 1
        column: 5,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('FindReferencesSchema', () => {
    it('applies default values', () => {
      const result = FindReferencesSchema.parse({
        file_path: '/path/to/file.ts',
        line: 10,
        column: 5,
      });
      expect(result.include_declaration).toBe(true);
      expect(result.limit).toBe(100);
      expect(result.offset).toBe(0);
    });

    it('respects provided values', () => {
      const result = FindReferencesSchema.parse({
        file_path: '/path/to/file.ts',
        line: 10,
        column: 5,
        include_declaration: false,
        limit: 50,
        offset: 10,
      });
      expect(result.include_declaration).toBe(false);
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(10);
    });

    it('rejects limit above max', () => {
      const result = FindReferencesSchema.safeParse({
        file_path: '/path/to/file.ts',
        line: 10,
        column: 5,
        limit: 1000, // max is 500
      });
      expect(result.success).toBe(false);
    });
  });

  describe('DiagnosticsSchema', () => {
    it('applies default severity filter', () => {
      const result = DiagnosticsSchema.parse({
        file_path: '/path/to/file.ts',
      });
      expect(result.severity_filter).toBe('all');
    });

    it('accepts valid severity filters', () => {
      const filters = ['all', 'error', 'warning', 'info', 'hint'] as const;
      for (const filter of filters) {
        const result = DiagnosticsSchema.safeParse({
          file_path: '/path/to/file.ts',
          severity_filter: filter,
        });
        expect(result.success).toBe(true);
      }
    });

    it('rejects invalid severity filter', () => {
      const result = DiagnosticsSchema.safeParse({
        file_path: '/path/to/file.ts',
        severity_filter: 'invalid',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('RenameSchema', () => {
    it('defaults dry_run to true', () => {
      const result = RenameSchema.parse({
        file_path: '/path/to/file.ts',
        line: 10,
        column: 5,
        new_name: 'newVariable',
      });
      expect(result.dry_run).toBe(true);
    });

    it('allows dry_run to be set to false', () => {
      const result = RenameSchema.parse({
        file_path: '/path/to/file.ts',
        line: 10,
        column: 5,
        new_name: 'newVariable',
        dry_run: false,
      });
      expect(result.dry_run).toBe(false);
    });

    it('rejects empty new_name', () => {
      const result = RenameSchema.safeParse({
        file_path: '/path/to/file.ts',
        line: 10,
        column: 5,
        new_name: '',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('WorkspaceSymbolsSchema', () => {
    it('requires non-empty query', () => {
      const result = WorkspaceSymbolsSchema.safeParse({
        query: '',
      });
      expect(result.success).toBe(false);
    });

    it('accepts valid symbol kinds filter', () => {
      const result = WorkspaceSymbolsSchema.safeParse({
        query: 'test',
        kinds: ['Class', 'Function', 'Interface'],
      });
      expect(result.success).toBe(true);
    });
  });
});
