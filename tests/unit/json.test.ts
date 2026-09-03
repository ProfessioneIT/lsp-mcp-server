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
import { parseMinify, serializeToolResult } from '../../src/utils/json.js';

describe('parseMinify', () => {
  it('accepts default and full', () => {
    expect(parseMinify('default')).toBe('default');
    expect(parseMinify('full')).toBe('full');
  });

  it('treats omitted and unknown values as disabled', () => {
    expect(parseMinify(undefined)).toBe(false);
    expect(parseMinify(true)).toBe(false);
    expect(parseMinify(false)).toBe(false);
    expect(parseMinify('true')).toBe(false);
    expect(parseMinify('off')).toBe(false);
  });
});

describe('serializeToolResult', () => {
  it('pretty-prints and keeps nulls when minify is disabled', () => {
    expect(serializeToolResult({ a: 1, range: null }, false)).toBe(
      '{\n  "a": 1,\n  "range": null\n}',
    );
  });

  it('pretty-prints by default', () => {
    expect(serializeToolResult({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it('strips whitespace but keeps nulls when minify is default', () => {
    expect(serializeToolResult({ a: 1, range: null }, 'default')).toBe(
      '{"a":1,"range":null}',
    );
  });

  it('strips whitespace and omits null object properties when minify is full', () => {
    expect(serializeToolResult({
      contents: 'hover',
      range: null,
      extra: { start: null, end: { line: 1 } },
    }, 'full')).toBe('{"contents":"hover","extra":{"end":{"line":1}}}');
  });

  it('keeps null inside arrays when minify is full', () => {
    expect(serializeToolResult({ items: [null, 1] }, 'full')).toBe('{"items":[null,1]}');
  });

  it('serializes top-level null as null', () => {
    expect(serializeToolResult(null)).toBe('null');
    expect(serializeToolResult(null, 'default')).toBe('null');
    expect(serializeToolResult(null, 'full')).toBe('null');
  });

  it('serializes top-level undefined as null', () => {
    expect(serializeToolResult(undefined)).toBe('null');
    expect(serializeToolResult(undefined, 'default')).toBe('null');
    expect(serializeToolResult(undefined, 'full')).toBe('null');
  });

  it('keeps zero, false, empty string, empty array, and empty object when minify is default', () => {
    expect(serializeToolResult({
      count: 0,
      ok: false,
      context: '',
      items: [],
      extra: {},
    }, 'default')).toBe('{"count":0,"ok":false,"context":"","items":[],"extra":{}}');
  });
});
