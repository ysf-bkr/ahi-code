import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { limitWithMarker, stripAnsi } from '../../src/shared/text';

describe('text helpers: terminal output cleanup', () => {
  it('strips ANSI escape sequences', () => {
    assert.strictEqual(stripAnsi('\u001b[31mred\u001b[0m plain'), 'red plain');
    assert.strictEqual(stripAnsi('no codes'), 'no codes');
  });

  it('keeps text under the limit untouched', () => {
    assert.strictEqual(limitWithMarker('short', 10), 'short');
  });

  it('truncates long text and appends the marker', () => {
    const result = limitWithMarker('abcdef', 3, '[... cut ...]');
    assert.strictEqual(result, 'abc\n[... cut ...]');
  });
});
