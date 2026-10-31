import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { SubagentManager } from '@ahicode/core/core/multiagent/SubagentManager';
import { PermissionManager } from '@ahicode/core/core/permission/PermissionManager';
import { ModelCompletionResponse, ModelProvider, ProviderMessage } from '@ahicode/core/providers/base';

/**
 * Yönetici ajanın gerçekten delege ettiğini doğrular.
 *
 * Önceden `manager` rolünün araç listesinde `invoke_subagent` yoktu; olsa bile
 * `SubagentManager` araç yürütücüsü bu çağrıyı bilinçli olarak yutuyordu.
 * Yani "manager" yalnızca kıdemli bir işçiydi. Bu testler o boşluğu kapatır.
 */
class RecordingProvider implements ModelProvider {
  public readonly id = 'recording';
  public readonly name = 'Recording';
  public readonly requests: ProviderMessage[][] = [];
  private index = 0;

  constructor(private readonly responses: ModelCompletionResponse[]) {}

  async sendMessage(messages: ProviderMessage[]): Promise<ModelCompletionResponse> {
    this.requests.push(messages);
    const response = this.responses[this.index] ?? { text: 'Rapor tamam.' };
    this.index++;
    return response;
  }
}

const delegateCall: ModelCompletionResponse = {
  text: '',
  toolCalls: [
    {
      id: 'delegate_1',
      name: 'invoke_subagent',
      arguments: { role: 'backend', task: 'API rotasını yaz' }
    }
  ]
};

describe('SubagentManager: orchestration', () => {
  it('manager can delegate to a specialist', async () => {
    const provider = new RecordingProvider([delegateCall, { text: 'Backend işi bitti.' }]);
    const manager = new SubagentManager(provider);

    const result = await manager.runSubagent({ role: 'manager', task: 'API ekle' });

    // Akış: manager delege eder (1), backend yanıt verir (2), manager raporu
    // kapatır (3). Kritik olan, delege çağrısının gerçekten yürütülmesi.
    assert.ok(provider.requests.length >= 2, 'delege çağrısı gerçekten yürütülmeli');
    const secondSystem = provider.requests[1]?.[0]?.content ?? '';
    assert.match(secondSystem, /Backend Specialist/);
    assert.match(result, /Rapor tamam|Backend işi bitti/);
  });

  it('rejects delegation beyond the depth limit', async () => {
    const provider = new RecordingProvider([delegateCall, { text: 'x' }]);
    const manager = new SubagentManager(provider);

    // Derinlik 2'de alt ajan çağrısı çalışmaz; hata araç sonucu olarak döner.
    const result = await manager.runSubagent({ role: 'manager', task: 'zincir' }, undefined, 2);
    assert.match(result, /maxDepth/);
  });

  it('does not let non-delegating roles delegate', async () => {
    // backend rolünde invoke_subagent yok: çağrı yetkisiz araç hatası almalı.
    // Uzmanlar yalnızca yöneticinin devriyle (depth >= 1) çalışır.
    const provider = new RecordingProvider([delegateCall, { text: 'rapor' }]);
    const manager = new SubagentManager(provider);

    await manager.runSubagent({ role: 'backend', task: 'x' }, undefined, 1);

    const toolMessage = provider.requests[1]?.find((message) => message.role === 'tool');
    assert.match(String(toolMessage?.content), /not allowed to use tool 'invoke_subagent'/);
    assert.strictEqual(provider.requests.length, 2, 'yetkisiz delege yeni bir alt ajan başlatmamalı');
  });

  it('enforces role tool allowlists', async () => {
    // security rolü write_file kullanamaz.
    const writeAttempt: ModelCompletionResponse = {
      text: '',
      toolCalls: [{ id: 'w1', name: 'write_file', arguments: { path: 'a.ts', content: 'x' } }]
    };
    const provider = new RecordingProvider([writeAttempt, { text: 'rapor' }]);
    const manager = new SubagentManager(provider);

    await manager.runSubagent({ role: 'security', task: 'tara' }, undefined, 1);

    const toolMessage = provider.requests[1]?.find((message) => message.role === 'tool');
    assert.match(String(toolMessage?.content), /not allowed to use tool 'write_file'/);
  });

  it('nested delegation cannot bypass mutation approval', async () => {
    // Yönetici bir uzmana delege eder; uzman yazmaya çalışır. Ana ajanın
    // `invoke_subagent` onayı yazma izni DEĞİLDİR: yazma yine onay ister.
    const nestedWrite: ModelCompletionResponse = {
      text: '',
      toolCalls: [
        { id: 'w2', name: 'write_file', arguments: { path: 'src/a.ts', content: 'export const a = 1;' } }
      ]
    };
    const provider = new RecordingProvider([delegateCall, nestedWrite, { text: 'rapor' }]);
    const permissionManager = new PermissionManager({
      selectedProvider: 'ollama',
      selectedModel: 'llama3.1',
      apiKeys: {},
      autoApprove: { readFiles: true, writeFiles: false, executeCommands: false }
    });
    const manager = new SubagentManager(
      provider,
      undefined,
      undefined,
      undefined,
      undefined,
      permissionManager
    );

    await manager.runSubagent({ role: 'manager', task: 'dosya yaz' });

    const toolMessages = provider.requests
      .flatMap((request) => request.filter((message) => message.role === 'tool'))
      .map((message) => String(message.content));
    assert.ok(
      toolMessages.some((content) => /Approval Required/.test(content)),
      `yazma onayı alt ajanda da sorulmalı: ${toolMessages.join(' | ')}`
    );
  });

  it('manager can run parallel tasks in one call', async () => {
    const parallelCall: ModelCompletionResponse = {
      text: '',
      toolCalls: [
        {
          id: 'par_1',
          name: 'run_parallel_tasks',
          arguments: {
            tasks: [
              { role: 'backend', task: 'API yaz' },
              { role: 'frontend', task: 'Ekran yaz' }
            ]
          }
        }
      ]
    };
    const provider = new RecordingProvider([
      parallelCall,
      { text: 'back' },
      { text: 'front' },
      { text: 'ozet' }
    ]);
    const manager = new SubagentManager(provider);

    const result = await manager.runSubagent({ role: 'manager', task: 'iki iş' });

    // Her iki uzman da personasıyla çağrılmalı.
    const systems = provider.requests.map((request) => request[0]?.content ?? '');
    assert.ok(
      systems.some((text) => /Backend Specialist/.test(text)),
      'backend çalışmalı'
    );
    assert.ok(
      systems.some((text) => /Frontend Specialist/.test(text)),
      'frontend çalışmalı'
    );
    assert.match(result, /ozet/);
  });

  it('rejects an empty parallel task list without throwing', async () => {
    const emptyCall: ModelCompletionResponse = {
      text: '',
      toolCalls: [{ id: 'par_2', name: 'run_parallel_tasks', arguments: { tasks: [] } }]
    };
    const provider = new RecordingProvider([emptyCall, { text: 'rapor' }]);
    const manager = new SubagentManager(provider);

    await manager.runSubagent({ role: 'manager', task: 'boş' });

    const toolMessage = provider.requests[1]?.find((message) => message.role === 'tool');
    assert.match(String(toolMessage?.content), /At least one parallel task/);
  });

  it('exposes every built-in role with a real tool list', async () => {
    const { ALL_AGENT_DEFINITIONS } = await import('@ahicode/core/shared/agents');
    for (const agent of ALL_AGENT_DEFINITIONS) {
      assert.ok(agent.tools.length > 0, `${agent.name} araçsız kalmamalı`);
      // Manager dışındaki roller delege edemez.
      if (agent.name !== 'manager') {
        assert.ok(
          !agent.tools.includes('invoke_subagent'),
          `${agent.name} delege etmemeli (yalnızca manager orkestre eder)`
        );
      }
    }
  });

  it('read-only mode propagates through nested delegation', async () => {
    // Yönetici okuma modunda çalışırken uzmana devreder: uzman da salt-okunur
    // kalmalı, aksi halde devretme aşama kilidinin arka kapısı olurdu.
    const provider = new RecordingProvider([delegateCall, { text: 'rapor' }]);
    const manager = new SubagentManager(provider);

    await manager.runSubagent({ role: 'manager', task: 'incele', readOnly: true });

    const specialistSystem = provider.requests[1]?.[0]?.content ?? '';
    assert.match(specialistSystem, /READ-ONLY MODE|read-only/i);
    assert.doesNotMatch(specialistSystem, /You are the "AhiCode - Backend Specialist"[\s\S]*write_file tool/);
  });

  it('read-only specialists never receive mutating tools', async () => {
    const writeAttempt: ModelCompletionResponse = {
      text: '',
      toolCalls: [{ id: 'w1', name: 'write_file', arguments: { path: 'a.ts', content: 'x' } }]
    };
    const provider = new RecordingProvider([writeAttempt, { text: 'rapor' }]);
    const manager = new SubagentManager(provider);

    await manager.runSubagent({ role: 'backend', task: 'incele' }, undefined, 0, undefined, false);

    // Kısıtsız çağrıda yazma denenebilir; kısıtlı çağrıda araç hiç verilmez.
    const permissiveTool = provider.requests[1]?.find((message) => message.role === 'tool');
    assert.ok(permissiveTool, 'kısıtsız çağrı araç sonucu üretmeli');

    const readOnlyProvider = new RecordingProvider([writeAttempt, { text: 'rapor' }]);
    const readOnlyManager = new SubagentManager(readOnlyProvider);
    await readOnlyManager.runSubagent({ role: 'backend', task: 'incele', readOnly: true });
    const toolMessage = readOnlyProvider.requests[1]?.find((message) => message.role === 'tool');
    assert.match(String(toolMessage?.content), /not allowed to use tool 'write_file'/);
  });
});
