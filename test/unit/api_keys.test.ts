import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { MASKED_KEY, maskApiKeys, mergeApiKeys } from '../../src/webview/apiKeys';
import { isChatConfigured } from '../../src/shared/constants';

describe('apiKeys: masking and merging', () => {
  it('masks real keys to the UI', () => {
    const masked = maskApiKeys({ evren: 'gercek-1', openrouter: 'gercek-2' });
    assert.strictEqual(masked.evren, MASKED_KEY);
    assert.strictEqual(masked.openrouter, MASKED_KEY);
    assert.strictEqual(masked.openaiCompatible, '');
    assert.ok(!JSON.stringify(masked).includes('gercek-'));
  });

  it('preserves existing key when mask arrives (regression)', () => {
    // Webview her kayıtta MASKED_KEY'i geri gönderir; gerçek anahtar korunmalı.
    const result = mergeApiKeys({ openrouter: 'gercek-anahtar' }, { openrouter: MASKED_KEY });
    assert.strictEqual(result.keys.openrouter, 'gercek-anahtar');
    assert.strictEqual(result.store.length, 0, 'SecretStorage must not be written unnecessarily');
    assert.strictEqual(result.remove.length, 0);
  });

  it('key must not be corrupted even if only an irrelevant setting is saved', () => {
    // autoVerify anahtarını değiştirip Kaydet'e basmayı simüle eder.
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

  it('evren API anahtarını kaydeder ve siler', () => {
    const ekle = mergeApiKeys({}, { evren: 'evren-secret-key' });
    assert.strictEqual(ekle.keys.evren, 'evren-secret-key');
    assert.deepStrictEqual(ekle.store, [{ provider: 'evren', key: 'evren-secret-key' }]);

    const sil = mergeApiKeys({ evren: 'evren-secret-key' }, { evren: '' });
    assert.strictEqual(sil.keys.evren, undefined);
    assert.deepStrictEqual(sil.remove, ['evren']);
  });
});

describe('isChatConfigured: sohbet kilit ve ayar denetimi', () => {
  it('ayarlar yapılandırılmamışsa sohbet kilitlidir', () => {
    assert.strictEqual(isChatConfigured(undefined), false);
    assert.strictEqual(isChatConfigured({ isConfigured: false }), false);
    assert.strictEqual(
      isChatConfigured({ isConfigured: false, selectedProvider: 'ollama', selectedModel: 'llama3.1' }),
      false
    );
  });

  it('yapılandırılmış ollama sağlayıcısı model varsa geçerlidir', () => {
    assert.strictEqual(
      isChatConfigured({ isConfigured: true, selectedProvider: 'ollama', selectedModel: 'llama3.1' }),
      true
    );
    assert.strictEqual(
      isChatConfigured({ isConfigured: true, selectedProvider: 'ollama', selectedModel: '' }),
      false
    );
  });

  it('evren sağlayıcısı anahtar gerektirir', () => {
    assert.strictEqual(
      isChatConfigured({ isConfigured: true, selectedProvider: 'evren', selectedModel: 'auto', apiKeys: {} }),
      false
    );
    assert.strictEqual(
      isChatConfigured({
        isConfigured: true,
        selectedProvider: 'evren',
        selectedModel: 'auto',
        apiKeys: { evren: 'key' }
      }),
      true
    );
    assert.strictEqual(
      isChatConfigured({
        isConfigured: true,
        selectedProvider: 'evren',
        selectedModel: 'auto',
        apiKeys: {},
        apiKeyStatus: { evren: true, openrouter: false, openaiCompatible: false }
      }),
      true
    );
  });

  it('openrouter sağlayıcısı anahtar gerektirir', () => {
    assert.strictEqual(
      isChatConfigured({
        isConfigured: true,
        selectedProvider: 'openrouter',
        selectedModel: 'claude',
        apiKeys: {}
      }),
      false
    );
    assert.strictEqual(
      isChatConfigured({
        isConfigured: true,
        selectedProvider: 'openrouter',
        selectedModel: 'claude',
        apiKeys: { openrouter: 'or-key' }
      }),
      true
    );
  });

  it('openai-compatible uç nokta ve model gerektirir', () => {
    assert.strictEqual(
      isChatConfigured({
        isConfigured: true,
        selectedProvider: 'openai-compatible',
        openAiCompatibleBaseUrl: '',
        selectedModel: 'gpt-4o'
      }),
      false
    );
    assert.strictEqual(
      isChatConfigured({
        isConfigured: true,
        selectedProvider: 'openai-compatible',
        openAiCompatibleBaseUrl: 'http://localhost:1234/v1',
        selectedModel: 'gpt-4o'
      }),
      true
    );
  });
});
