import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { parsePlanUpdateInput, parseSubagentTaskParams } from '@ahicode/core/tools/parsers';

describe('parsers: araç argümanlarını güvenli ayrıştırma', () => {
  it('plan adımlarını doğrular ve geçersiz alanları atlar', () => {
    const parsed = parsePlanUpdateInput({
      goal: 'Bir şey yap',
      steps: [
        { title: 'Adım 1', status: 'pending', dependsOn: ['a'] },
        { title: 'Adım 2', status: 'uydurma-durum', files: ['src/a.ts', 5] },
        'geçersiz adım',
        null
      ]
    });

    assert.strictEqual(parsed.goal, 'Bir şey yap');
    assert.strictEqual(parsed.steps?.length, 2);
    assert.deepStrictEqual(parsed.steps?.[0]?.dependsOn, ['a']);
    // Geçersiz durum yok sayılır, sayısal dosya adları filtrelenir.
    assert.strictEqual(parsed.steps?.[1]?.status, undefined);
    assert.deepStrictEqual(parsed.steps?.[1]?.files, ['src/a.ts']);
  });

  it('plan adımları dizi değilse boş liste döner', () => {
    assert.deepStrictEqual(parsePlanUpdateInput({ steps: 'adım' }).steps, []);
  });

  it('alt ajan parametrelerinde rol ve görevi zorunlu tutar', () => {
    assert.throws(() => parseSubagentTaskParams({ task: 'x' }), /role/i);
    assert.throws(() => parseSubagentTaskParams({ role: 'coder' }), /task/i);
    assert.throws(() => parseSubagentTaskParams({ role: '  ', task: '  ' }), /role/i);
  });

  it('alt ajan parametrelerini normalize eder', () => {
    const parsed = parseSubagentTaskParams({
      role: ' coder ',
      task: ' düzelt ',
      context: 'bağlam',
      isolate: 'true'
    });
    assert.deepStrictEqual(parsed, {
      role: 'coder',
      task: 'düzelt',
      context: 'bağlam',
      isolate: true
    });
  });
});
