import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { classifyTask, ModelRouter } from '../../src/core/routing/ModelRouter';
import { ContextManager, DEFAULT_CONTEXT_WINDOW_TOKENS } from '../../src/core/context/ContextManager';
import { UserSettings } from '../../src/shared/types';

const baseSettings: UserSettings = {
  selectedProvider: 'ollama',
  selectedModel: 'llama3.1',
  apiKeys: {},
  autoApprove: { readFiles: true, writeFiles: false, executeCommands: false }
};

describe('ModelRouter', () => {
  it('classifies task complexity for Turkish prompts', () => {
    assert.strictEqual(classifyTask('merhaba, kısaca açıkla'), 'simple');
    assert.strictEqual(classifyTask('Veritabanı şemasını ve mimariyi yeniden düzenle'), 'complex');
    assert.strictEqual(classifyTask('Bu PR için kod incelemesi yap'), 'review');
    assert.strictEqual(classifyTask('Plan çıkar', 'plan'), 'complex');
  });

  it('preserves the selected model when routing is disabled', () => {
    const decision = new ModelRouter().route('küçük düzeltme', 'code', baseSettings);
    assert.strictEqual(decision.model, baseSettings.selectedModel);
    assert.strictEqual(decision.routed, false);
  });

  it('routes tasks to models based on complexity', () => {
    const settings: UserSettings = {
      ...baseSettings,
      modelRouting: { enabled: true, fastModel: 'fast-mini', deepModel: 'deep-pro' }
    };
    const router = new ModelRouter();
    assert.strictEqual(router.route('kısaca açıkla', 'code', settings).model, 'fast-mini');
    assert.strictEqual(
      router.route('Mimariyi analiz et ve güvenlik denetimi yap', 'code', settings).model,
      'deep-pro'
    );
  });
});

describe('ContextManager: overflow protection (not budget)', () => {
  it('fits by trimming long history, does not stop task', () => {
    const manager = new ContextManager({ contextWindowTokens: 400 });
    const messages = [
      { role: 'system' as const, content: 'sistem' },
      ...Array.from({ length: 20 }, (_, index) => ({
        role: 'user' as const,
        content: `mesaj ${index} ${'x'.repeat(120)}`
      }))
    ];

    const pruned = manager.pruneMessages(messages);
    assert.ok(pruned.length < messages.length, 'old messages should be dropped');
    assert.ok(manager.estimateMessagesTokens(pruned) <= 400, 'request should fit in window');
  });

  it('default window not presented to user as budget', () => {
    // Koruma yalnızca sağlayıcıya gönderilen istek boyutunu sınırlar; sağlıklı
    // bir görevi duraklatabilecek görev başına token üst limiti yoktur.
    assert.ok(DEFAULT_CONTEXT_WINDOW_TOKENS >= 64_000);
    const manager = new ContextManager();
    assert.ok(
      manager.estimateMessagesTokens([{ role: 'user', content: 'kısa' }]) < DEFAULT_CONTEXT_WINDOW_TOKENS
    );
  });
});
