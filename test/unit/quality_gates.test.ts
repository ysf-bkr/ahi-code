import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { filterToolsForMode, isDelegationTool, isToolAllowed } from '../../src/core/agent/modeTools';
import { criteriaCoverage, checkSpecCoverage } from '../../src/core/spec/SpecStore';
import type { TaskSpec } from '../../src/core/spec/SpecStore';

/**
 * Endüstriyel kalite kapıları:
 * 1. Okuma aşamasında devretme serbest (keşif için alt ajan gerekir).
 * 2. Okuma aşamasında yazma/komut kilitli kalır.
 * 3. Spec onayı üç boyutlu kriter ister.
 */
describe('modeTools: okuma aşamasında devretme', () => {
  const tools = [
    { name: 'read_file' },
    { name: 'write_file' },
    { name: 'execute_command' },
    { name: 'invoke_subagent' },
    { name: 'run_parallel_tasks' },
    { name: 'update_module_plan' }
  ];

  it('okuma aşamasında devretme ve modül planı serbest, yazma kilitli', () => {
    const allowed = filterToolsForMode(tools, 'code', { workflowReadOnly: true }).map((tool) => tool.name);

    assert.ok(allowed.includes('invoke_subagent'), 'keşif için alt ajan çalıştırılabilmeli');
    assert.equal(
      allowed.includes('run_parallel_tasks'),
      false,
      'paralel görevler izole worktree açar; okuma aşamasında gerekmez'
    );
    assert.ok(allowed.includes('update_module_plan'), 'modül haritası kod yazmadan önce kurulur');
    assert.equal(allowed.includes('write_file'), false, 'spec onayı öncesi yazma kilitli');
    assert.equal(allowed.includes('execute_command'), false);
  });

  it('plan modunda komut aşama kilidiyle birlikte kapalı kalır', () => {
    assert.equal(isToolAllowed('execute_command', 'plan'), false);
    assert.equal(isToolAllowed('invoke_subagent', 'plan'), true);
  });

  it('okuma aşamasında yalnızca tek uzmana devretmeyi serbest bırakır', () => {
    assert.equal(isDelegationTool('invoke_subagent'), true);
    assert.equal(isDelegationTool('run_parallel_tasks'), false);
    assert.equal(isDelegationTool('write_file'), false);
  });
});

describe('SpecStore: üç boyutlu kabul kriterleri', () => {
  const spec = (criteria: string[]): TaskSpec => ({
    id: 'spec-test',
    goal: 'Örnek',
    scope: ['src'],
    outOfScope: [],
    assumptions: [],
    acceptanceCriteria: criteria.map((text, index) => ({ id: `ac-${index + 1}`, text, done: false })),
    files: [],
    risk: 'low',
    status: 'draft',
    createdAt: 0,
    updatedAt: 0
  });

  it('mutlu yol, hata yolu ve uç durum birlikte varsa geçer', () => {
    const coverage = criteriaCoverage([
      { text: 'Düğme tıklandığında ekran görünür' },
      { text: 'Geçersiz girdide hata mesajı gösterilir' },
      { text: 'Boş liste sınırında çökmez' }
    ]);
    assert.deepStrictEqual(coverage.missing, []);
    assert.strictEqual(
      checkSpecCoverage(
        spec([
          'Düğme tıklandığında ekran görünür',
          'Geçersiz girdide hata mesajı gösterilir',
          'Boş liste sınırında çökmez'
        ])
      ).ok,
      true
    );
  });

  it('yalnızca mutlu yol yazan spec onaylanamaz', () => {
    const result = checkSpecCoverage(spec(['Ekran görünür', 'Düğme tıklanınca çalışır']));
    assert.strictEqual(result.ok, false);
    assert.match(result.missing.join(','), /error handling/);
    assert.match(result.missing.join(','), /edge cases/);
    assert.match(result.message, /write_spec/);
  });
});
