import { describe, it, expect } from 'vitest';
import {
  toLspPosition,
  fromLspPosition,
  getLineContent,
  fromLspRange,
} from '../../src/utils/position.js';

describe('position utilities', () => {
  const simpleContent = 'line 1\nline 2\nline 3';
  const unicodeContent = 'hello \u{1F600} world\nnext line';

  describe('toLspPosition', () => {
    it('converts 1-indexed to 0-indexed', () => {
      const result = toLspPosition(1, 1, simpleContent);
      expect(result.line).toBe(0);
      expect(result.character).toBe(0);
    });

    it('handles multi-line content', () => {
      const result = toLspPosition(2, 3, simpleContent);
      expect(result.line).toBe(1);
      expect(result.character).toBe(2);
    });

    it('converts out-of-bounds positions', () => {
      // The function doesn't clamp - it just converts 1-indexed to 0-indexed
      const result = toLspPosition(100, 100, simpleContent);
      expect(result.line).toBe(99);
      expect(result.character).toBe(99);
    });
  });

  describe('fromLspPosition', () => {
    it('converts 0-indexed to 1-indexed', () => {
      const result = fromLspPosition({ line: 0, character: 0 }, simpleContent);
      expect(result.line).toBe(1);
      expect(result.column).toBe(1);
    });

    it('handles UTF-16 positions with emoji', () => {
      // emoji \u{1F600} takes 2 UTF-16 code units
      // "hello " = 6 chars, emoji = 2 UTF-16 units, " world" = 6 chars
      // LSP position character 8 = after "hello " (6) + emoji (2) = start of " world"
      // When converted back, this maps to column 8 (1-indexed)
      const result = fromLspPosition({ line: 0, character: 8 }, unicodeContent);
      expect(result.line).toBe(1);
      expect(result.column).toBe(8); // 1-indexed column after emoji
    });
  });

  describe('getLineContent', () => {
    it('returns correct line content', () => {
      expect(getLineContent(simpleContent, 1)).toBe('line 1');
      expect(getLineContent(simpleContent, 2)).toBe('line 2');
      expect(getLineContent(simpleContent, 3)).toBe('line 3');
    });

    it('returns undefined for out-of-bounds', () => {
      expect(getLineContent(simpleContent, 0)).toBeUndefined();
      expect(getLineContent(simpleContent, 100)).toBeUndefined();
    });
  });

  describe('fromLspRange', () => {
    it('converts LSP range to our format', () => {
      const lspRange = {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 4 },
      };
      const result = fromLspRange(lspRange, simpleContent);
      expect(result.start.line).toBe(1);
      expect(result.start.column).toBe(1);
      expect(result.end.line).toBe(1);
      expect(result.end.column).toBe(5);
    });
  });
});
