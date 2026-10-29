import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { MASKED_KEY, maskApiKeys, mergeApiKeys } from '../../src/webview/apiKeys';

describe('apiKeys: masking and merging', () => {
  it('masks real keys to the UI', () => {
    const masked = maskApiKeys({ evren: 'gercek-1', openrouter: 'gercek-2' });
    assert.strictEqual(masked.evren, MASKED_KEY);
    assert.strictEqual(masked.openrouter, MASKED_KEY);
    assert.strictEqual(masked.openaiCompatible, '');
    assert.ok(!JSON.stringify(masked).includes('gercek-'));
  });

  it('preserves existing key when mask arrives (regression)', () => {
    // The webview posts MASKED_KEY back on every save; the real key must survive.
    const result = mergeApiKeys({ openrouter: 'gercek-anahtar' }, { openrouter: MASKED_KEY });
    assert.strictEqual(result.keys.openrouter, 'gercek-anahtar');
    assert.strictEqual(result.store.length, 0, 'SecretStorage must not be written unnecessarily');
    assert.strictEqual(result.remove.length, 0);
  });

  it('key must not be corrupted even if only an irrelevant setting is saved', () => {
    // Simulates toggling autoVerify and pressing Save.
    const current = { openrouter: 'gercek', openaiCompatible: 'or-gercek' };
    const result = mergeApiKeys(current, { openrouter: MASKED_KEY, openaiCompatible: MASKED_KEY });
    assert.deepStrictEqual(result.keys, current);
  });

  it('registers a new key', () => {
    const result = mergeApiKeys({}, { openrouter: '  sk-or-yeni  ' });
    assert.strictEqual(result.keys.openrouter, 'sk-or-yeni');
    assert.deepStrictEqual(result.store, [{ provider: 'openrouter', key: 'sk-or-yeni' }]);
  });

  it('deletes key with empty value', () => {
    const result = mergeApiKeys({ openrouter: 'gercek' }, { openrouter: '' });
    assert.strictEqual(result.keys.openrouter, undefined);
    assert.deepStrictEqual(result.remove, ['openrouter']);
  });

  it('ignores undefined field', () => {
    const result = mergeApiKeys({ openrouter: 'gercek' }, { openrouter: undefined });
    assert.strictEqual(result.keys.openrouter, 'gercek');
    assert.strictEqual(result.store.length, 0);
  });

  it('returns existing keys when incoming key is missing', () => {
    const result = mergeApiKeys({ openrouter: 'gercek' }, undefined);
    assert.strictEqual(result.keys.openrouter, 'gercek');
    assert.strictEqual(result.store.length, 0);
  });

  it('does not mutate the input', () => {
    const current = { openrouter: 'gercek' };
    const result = mergeApiKeys(current, { openrouter: '' });
    assert.strictEqual(current.openrouter, 'gercek');
    assert.notStrictEqual(result.keys, current);
  });
});
