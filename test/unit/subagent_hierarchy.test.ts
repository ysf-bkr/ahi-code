import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { SubagentManager } from '../../src/core/multiagent/SubagentManager';
import { ModelProvider } from '../../src/providers/base';

/**
 * Alt ajan hiyerarşisi.
 *
 * Kural: en üstte yalnızca @manager çalışır. Ana ajan ve kullanıcı uzmanları
 * (security, backend, ...) doğrudan başlatamaz; işi yöneticiye devreder,
 * yönetici uzmanları seçer. İç içe yönetici de yoktur.
 *
 * Bu kural yürütme katmanındadır: model prompt'u dinlese de dinlemese de
 * geçerlidir.
 */
const provider: ModelProvider = {
  id: 'test',
  name: 'Test',
  sendMessage: async () => ({ text: 'Rapor' })
};

describe('SubagentManager: yönetici ve uzman ajan hiyerarşisi', () => {
  it('runs specialists directly at the top level', async () => {
    const manager = new SubagentManager(provider);
    for (const role of ['security', 'backend', 'quality', 'coder']) {
      const result = await manager.runSubagent({ role, task: 'x' });
      assert.match(result, /Rapor/, `${role} en üstten doğrudan başlatılabilmeli`);
    }
  });

  it('runs the manager at the top level', async () => {
    const manager = new SubagentManager(provider);
    const result = await manager.runSubagent({ role: 'manager', task: 'koordine et' });
    assert.match(result, /Rapor/);
  });

  it('rejects a nested manager', async () => {
    const manager = new SubagentManager(provider);
    const result = await manager.runSubagent({ role: 'manager', task: 'x' }, undefined, 1);
    assert.match(result, /Nested managers are not allowed/);
  });

  it('runs specialists when the manager delegates (depth > 0)', async () => {
    const manager = new SubagentManager(provider);
    const result = await manager.runSubagent({ role: 'security', task: 'tara' }, undefined, 1);
    assert.match(result, /Rapor/, 'yöneticinin devrettiği uzman çalışmalı');
  });
});
