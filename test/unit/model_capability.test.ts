import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { classifyModelCapability, isConversationModel } from '../../src/shared/modelCapability';

describe('modelCapability: model kimliğinden yetenek sınıflandırma', () => {
  it('boş ve tanımsız girdiyi sohbet modeli sayar', () => {
    assert.strictEqual(classifyModelCapability(''), 'chat');
    assert.strictEqual(classifyModelCapability(undefined as unknown as string), 'chat');
    assert.strictEqual(classifyModelCapability('   '), 'chat');
  });

  it('bilinen sohbet modellerini chat olarak sınıflandırır', () => {
    for (const id of ['GLM-5.3', 'MiMo-V2.6-Pro', 'llama3.1', 'gpt-4o', 'qwen2.5-coder']) {
      assert.strictEqual(classifyModelCapability(id), 'chat', `${id} chat olmalı`);
    }
  });

  it('embedding ve rerank modellerini ayrı sınıfa alır', () => {
    assert.strictEqual(classifyModelCapability('qwen3-embedding-8b'), 'embedding');
    assert.strictEqual(classifyModelCapability('nomic-embed-text'), 'embedding');
    assert.strictEqual(classifyModelCapability('qwen3-reranker-8b'), 'rerank');
  });

  it('görüş modellerini vision olarak tanır', () => {
    assert.strictEqual(classifyModelCapability('qwen3-vl-30b'), 'vision');
    assert.strictEqual(classifyModelCapability('llava-vision-7b'), 'vision');
  });

  it('OCR/ASR/TTS/görüntü üretim modellerini tanır', () => {
    assert.strictEqual(classifyModelCapability('deepseek-ocr-2'), 'ocr');
    assert.strictEqual(classifyModelCapability('qwen3-asr-1.7b'), 'asr');
    assert.strictEqual(classifyModelCapability('voxcpm2'), 'tts');
    assert.strictEqual(classifyModelCapability('dall-e-3'), 'image');
    assert.strictEqual(classifyModelCapability('stable-diffusion-xl'), 'image');
  });

  it('isConversationModel yalnızca sohbet modelleri için true verir', () => {
    assert.strictEqual(isConversationModel('GLM-5.3'), true);
    assert.strictEqual(isConversationModel('qwen3-embedding-8b'), false);
    assert.strictEqual(isConversationModel('deepseek-ocr-2'), false);
    assert.strictEqual(
      isConversationModel('qwen3-vl-30b'),
      false,
      'vision sohbet/araç çağrısı modeli değildir'
    );
  });
});
