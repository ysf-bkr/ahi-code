import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { resolveAgentModel } from '@ahicode/core/core/routing/agentModelPolicy';
import { classifyModelCapability, isConversationModel } from '@ahicode/core/shared/modelCapability';
import { UserSettings } from '@ahicode/core/shared/types';

const evrenBase: UserSettings = {
  selectedProvider: 'evren',
  selectedModel: 'glm-4.5',
  apiKeys: { evren: 'k' },
  autoApprove: { readFiles: true, writeFiles: true, executeCommands: false }
};

describe('agent model policy: EVREN presets', () => {
  it('routes the manager and architect to GLM-5.3 with a MiMo fallback', () => {
    const manager = resolveAgentModel('manager', 'görevleri yönet', evrenBase);
    assert.strictEqual(manager.model, 'GLM-5.3');
    assert.strictEqual(manager.fallbackModel, 'MiMo-V2.6-Pro');
    assert.strictEqual(manager.routed, true);

    const architect = resolveAgentModel('architect', 'mimariyi tasarla', evrenBase);
    assert.strictEqual(architect.model, 'GLM-5.3');
  });

  it('routes the explorer to the lighter MiMo model without a heavier fallback', () => {
    const explorer = resolveAgentModel('explorer', 'projeyi tara', evrenBase);
    assert.strictEqual(explorer.model, 'MiMo-V2.6-Pro');
    assert.strictEqual(explorer.fallbackModel, undefined);
  });

  it('routes review roles (quality, security) to the strong review model', () => {
    assert.strictEqual(resolveAgentModel('quality', 'diffi incele', evrenBase).model, 'GLM-5.3');
    assert.strictEqual(resolveAgentModel('security', 'denetle', evrenBase).model, 'GLM-5.3');
  });

  it('does not force a preset when the selected model already matches', () => {
    const settings: UserSettings = { ...evrenBase, selectedModel: 'GLM-5.3' };
    const choice = resolveAgentModel('manager', 'yönet', settings);
    assert.strictEqual(choice.model, undefined);
    assert.strictEqual(choice.routed, false);
    // Fallback yine de tanımlı kalmalı: GLM-5.3 hata verirse MiMo denenebilir.
    assert.strictEqual(choice.fallbackModel, 'MiMo-V2.6-Pro');
  });

  it('lets a user override win over the provider preset', () => {
    const settings: UserSettings = { ...evrenBase, agentModels: { backend: 'deepseek-coder' } };
    const choice = resolveAgentModel('backend', 'api yaz', settings);
    assert.strictEqual(choice.model, 'deepseek-coder');
    assert.strictEqual(choice.routed, true);
  });

  it('falls back to the selected model for non-EVREN providers without routing', () => {
    const settings: UserSettings = {
      ...evrenBase,
      selectedProvider: 'openrouter',
      selectedModel: 'anthropic/claude'
    };
    const choice = resolveAgentModel('backend', 'api yaz', settings);
    assert.strictEqual(choice.model, 'anthropic/claude');
    assert.strictEqual(choice.routed, false);
  });

  it('uses role-kind defaults when model routing is enabled on other providers', () => {
    const settings: UserSettings = {
      ...evrenBase,
      selectedProvider: 'openrouter',
      modelRouting: { enabled: true, reviewModel: 'review-pro', fastModel: 'fast-mini' }
    };
    assert.strictEqual(resolveAgentModel('quality', 'incele', settings).model, 'review-pro');
    assert.strictEqual(resolveAgentModel('explorer', 'tara', settings).model, 'fast-mini');
  });

  it('never assigns a non-conversation model to a coding agent', () => {
    const settings: UserSettings = { ...evrenBase, agentModels: { backend: 'qwen3-embedding-8b' } };
    const choice = resolveAgentModel('backend', 'api yaz', settings);
    // Embedding bir sohbet modeli değildir; seçim yok sayılır, seçili modele düşülür.
    assert.strictEqual(choice.model, evrenBase.selectedModel);
    assert.strictEqual(choice.routed, false);
  });
});

describe('model capability classification', () => {
  it('classifies embedding, rerank and media models', () => {
    assert.strictEqual(classifyModelCapability('qwen3-embedding-8b'), 'embedding');
    assert.strictEqual(classifyModelCapability('qwen3-reranker-8b'), 'rerank');
    assert.strictEqual(classifyModelCapability('qwen3-vl-30b'), 'vision');
    assert.strictEqual(classifyModelCapability('deepseek-ocr-2'), 'ocr');
    assert.strictEqual(classifyModelCapability('qwen3-asr-1.7b'), 'asr');
    assert.strictEqual(classifyModelCapability('voxcpm2'), 'tts');
  });

  it('treats plain chat/coding models as conversation models', () => {
    assert.ok(isConversationModel('GLM-5.3'));
    assert.ok(isConversationModel('MiMo-V2.6-Pro'));
    assert.ok(isConversationModel('deepseek-coder'));
    assert.ok(!isConversationModel('qwen3-embedding-8b'));
    assert.ok(!isConversationModel('qwen3-vl-30b'));
  });
});
