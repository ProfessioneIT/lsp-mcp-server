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

import type { Position, Range } from 'vscode-languageserver-protocol';

/**
 * Position conversion utilities for handling LSP's 0-indexed positions
 * and our 1-indexed tool interface, as well as UTF-16 code unit handling.
 *
 * LSP uses:
 * - 0-indexed lines and characters
 * - UTF-16 code units for character positions
 *
 * Our tools use:
 * - 1-indexed lines and columns
 * - UTF-32 code points (what humans think of as "characters")
 */

/**
 * Get the lines of a document as an array
 */
export function getLines(content: string): string[] {
  return content.split(/\r\n|\r|\n/);
}

/**
 * Get a specific line from content (0-indexed)
 */
export function getLine(content: string, lineIndex: number): string | undefined {
  const lines = getLines(content);
  return lines[lineIndex];
}

/**
 * Convert UTF-32 code point offset to UTF-16 code unit offset within a line.
 * This is needed because JavaScript strings are UTF-16 encoded,
 * but users think in terms of visual characters (code points).
 *
 * @param line - The line content
 * @param codePointOffset - 0-indexed code point offset
 * @returns 0-indexed UTF-16 code unit offset
 */
export function codePointToUtf16(line: string, codePointOffset: number): number {
  let utf16Offset = 0;
  let codePoints = 0;

  for (const char of line) {
    if (codePoints >= codePointOffset) {
      break;
    }
    utf16Offset += char.length; // char.length is 2 for surrogate pairs
    codePoints++;
  }

  return utf16Offset;
}

/**
 * Convert UTF-16 code unit offset to UTF-32 code point offset within a line.
 *
 * @param line - The line content
 * @param utf16Offset - 0-indexed UTF-16 code unit offset
 * @returns 0-indexed code point offset
 */
export function utf16ToCodePoint(line: string, utf16Offset: number): number {
  let currentUtf16 = 0;
  let codePoints = 0;

  for (const char of line) {
    if (currentUtf16 >= utf16Offset) {
      break;
    }
    currentUtf16 += char.length;
    codePoints++;
  }

  return codePoints;
}

/**
 * Convert 1-indexed (line, column) to LSP 0-indexed Position.
 * Handles UTF-16 conversion for the column.
 *
 * @param line - 1-indexed line number
 * @param column - 1-indexed column number (code point offset)
 * @param content - The document content (optional, needed for UTF-16 conversion)
 * @returns LSP Position (0-indexed)
 */
export function toLspPosition(
  line: number,
  column: number,
  content?: string
): Position {
  const lspLine = line - 1;
  let lspCharacter = column - 1;

  // If content is provided, convert code points to UTF-16
  if (content !== undefined) {
    const lineContent = getLine(content, lspLine);
    if (lineContent !== undefined) {
      lspCharacter = codePointToUtf16(lineContent, column - 1);
    }
  }

  return {
    line: Math.max(0, lspLine),
    character: Math.max(0, lspCharacter),
  };
}

/**
 * Convert LSP 0-indexed Position to 1-indexed (line, column).
 * Handles UTF-16 to code point conversion for the column.
 *
 * @param position - LSP Position (0-indexed)
 * @param content - The document content (optional, needed for UTF-16 conversion)
 * @returns 1-indexed line and column
 */
export function fromLspPosition(
  position: Position,
  content?: string
): { line: number; column: number } {
  const line = position.line + 1;
  let column = position.character + 1;

  // If content is provided, convert UTF-16 to code points
  if (content !== undefined) {
    const lineContent = getLine(content, position.line);
    if (lineContent !== undefined) {
      column = utf16ToCodePoint(lineContent, position.character) + 1;
    }
  }

  return { line, column };
}

/**
 * Convert 1-indexed range to LSP 0-indexed Range.
 *
 * @param startLine - 1-indexed start line
 * @param startColumn - 1-indexed start column
 * @param endLine - 1-indexed end line
 * @param endColumn - 1-indexed end column
 * @param content - The document content (optional, needed for UTF-16 conversion)
 * @returns LSP Range (0-indexed)
 */
export function toLspRange(
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number,
  content?: string
): Range {
  return {
    start: toLspPosition(startLine, startColumn, content),
    end: toLspPosition(endLine, endColumn, content),
  };
}

/**
 * Convert LSP 0-indexed Range to 1-indexed range.
 *
 * @param range - LSP Range (0-indexed)
 * @param content - The document content (optional, needed for UTF-16 conversion)
 * @returns 1-indexed start and end positions
 */
export function fromLspRange(
  range: Range,
  content?: string
): {
  start: { line: number; column: number };
  end: { line: number; column: number };
} {
  return {
    start: fromLspPosition(range.start, content),
    end: fromLspPosition(range.end, content),
  };
}

/**
 * Validate that a position is within the bounds of the content.
 *
 * @param line - 1-indexed line number
 * @param column - 1-indexed column number
 * @param content - The document content
 * @returns true if position is valid
 */
export function isValidPosition(line: number, column: number, content: string): boolean {
  if (line < 1 || column < 1) {
    return false;
  }

  const lines = getLines(content);
  if (line > lines.length) {
    return false;
  }

  const lineContent = lines[line - 1];
  if (lineContent === undefined) {
    return false;
  }

  // Count code points in the line
  const codePoints = [...lineContent].length;

  // Column can be at most codePoints + 1 (for end-of-line position)
  return column <= codePoints + 1;
}

/**
 * Get the content of a line at the given 1-indexed line number.
 *
 * @param content - The document content
 * @param line - 1-indexed line number
 * @returns The line content or undefined if out of bounds
 */
export function getLineContent(content: string, line: number): string | undefined {
  return getLine(content, line - 1);
}

/**
 * Clamp a position to valid bounds within the content.
 *
 * @param line - 1-indexed line number
 * @param column - 1-indexed column number
 * @param content - The document content
 * @returns Clamped 1-indexed position
 */
export function clampPosition(
  line: number,
  column: number,
  content: string
): { line: number; column: number } {
  const lines = getLines(content);

  // Clamp line
  const clampedLine = Math.max(1, Math.min(line, lines.length));

  // Get line content and count code points
  const lineContent = lines[clampedLine - 1] ?? '';
  const codePoints = [...lineContent].length;

  // Clamp column (allow end-of-line position)
  const clampedColumn = Math.max(1, Math.min(column, codePoints + 1));

  return { line: clampedLine, column: clampedColumn };
}
