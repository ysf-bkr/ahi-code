import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { SubagentManager } from '../../src/core/multiagent/SubagentManager';
import { ModelProvider, ProviderMessage } from '../../src/providers/base';
import { PermissionManager } from '../../src/core/permission/PermissionManager';
import { UserSettings } from '../../src/shared/types';
import type { CallGraphManager } from '../../src/core/callgraph/CallGraphManager';
import type { SkillManager } from '../../src/core/skills/SkillManager';

const provider: ModelProvider = {
  id: 'test',
  name: 'Test',
  sendMessage: async () => ({ text: 'Alt ajan raporu' })
};

const settings: UserSettings = {
  selectedProvider: 'ollama',
  selectedModel: 'llama3.1',
  apiKeys: {},
  autoApprove: {
    readFiles: false,
    writeFiles: false,
    executeCommands: false
  }
};

describe('SubagentManager: role and depth limits', () => {
  it('rejects an unknown role delegated by the manager', async () => {
    const manager = new SubagentManager(provider);
    const result = await manager.runSubagent({ role: 'bilinmeyen-rol', task: 'x' }, undefined, 1);
    assert.ok(result.includes('was found'));
  });

  it('runs a specialist started at the top level', async () => {
    const manager = new SubagentManager(provider);
    const result = await manager.runSubagent({ role: 'security', task: 'x' });
    assert.ok(result.includes('Alt ajan raporu'));
  });

  it('enforces maximum subagent depth', async () => {
    const manager = new SubagentManager(provider);
    const result = await manager.runSubagent({ role: 'reviewer', task: 'x' }, undefined, 2);
    assert.ok(result.includes('maxDepth'));
  });

  it('runs built-in reviewer role (aliased to quality)', async () => {
    const manager = new SubagentManager(provider);
    const result = await manager.runSubagent({ role: 'reviewer', task: 'Kodu incele' }, undefined, 1);
    assert.ok(result.includes('Alt ajan raporu'));
  });

  it('runs built-in quality role from atabey registry', async () => {
    const manager = new SubagentManager(provider);
    const result = await manager.runSubagent(
      { role: 'quality', task: 'Kodu incele ve test et' },
      undefined,
      1
    );
    assert.ok(result.includes('Alt ajan raporu'));
    assert.ok(result.includes('quality'));
  });

  it('runs built-in manager orchestrator role', async () => {
    const manager = new SubagentManager(provider);
    const result = await manager.runSubagent({ role: 'manager', task: 'Görevleri koordine et' });
    assert.ok(result.includes('Alt ajan raporu'));
    assert.ok(result.includes('manager'));
  });

  it('notifies status listeners with structured details', async () => {
    const events: Array<{ role: string; status: string; state?: string }> = [];
    const manager = new SubagentManager(provider, (role, status, details) => {
      events.push({ role, status, state: details?.state });
    });
    await manager.runSubagent({ role: 'architect', task: 'Sistemi analiz et' }, undefined, 1);
    assert.ok(events.length >= 2, 'en az başlangıç ve bitiş olayları tetiklenmeli');
    assert.strictEqual(events[0]?.role, 'architect');
    assert.strictEqual(events[0]?.state, 'starting');
    assert.strictEqual(events[events.length - 1]?.state, 'completed');
  });

  it('applies the main agent approval policy to subagent tool calls (F05)', async () => {
    // Okuma otomatik onayı kapalıyken ana ajan read_file için onay ister;
    // alt ajan aynı kararı almalı ve dosyayı sessizce okumamalı.
    let step = 0;
    let lastToolResult = '';
    const toolProvider: ModelProvider = {
      id: 'test',
      name: 'Test',
      sendMessage: async (messages: ProviderMessage[]) => {
        step++;
        if (step === 1) {
          return {
            text: 'Dosyayı okuyorum',
            toolCalls: [{ id: 'tc-1', name: 'read_file', arguments: { path: 'src/a.ts' } }]
          };
        }
        const toolMessage = [...messages].reverse().find((m) => m.role === 'tool');
        lastToolResult = toolMessage?.content || '';
        return { text: 'Rapor tamam.' };
      }
    };

    const permissionManager = new PermissionManager(settings);
    const manager = new SubagentManager(
      toolProvider,
      undefined,
      undefined,
      undefined,
      undefined,
      permissionManager
    );

    const result = await manager.runSubagent({ role: 'explorer', task: 'Dosyayı oku' }, '/mock/ws', 1);
    assert.ok(result.includes('Rapor tamam.'));
    assert.ok(lastToolResult.includes('[Approval Required]'), `onay reddi bekleniyordu: ${lastToolResult}`);
  });

  it('rejects always-policy tools in subagents even with auto-approve on (F05)', async () => {
    // Özel ajan `web_fetch` izinli olsa bile 'always' politikası gereği
    // alt ajan içinde çalışamaz; ana ajan onay akışından geçirmek zorundadır.
    const permissive: UserSettings = {
      ...settings,
      autoApprove: { readFiles: true, writeFiles: true, executeCommands: true }
    };
    let step = 0;
    let lastToolResult = '';
    const toolProvider: ModelProvider = {
      id: 'test',
      name: 'Test',
      sendMessage: async (messages: ProviderMessage[]) => {
        step++;
        if (step === 1) {
          return {
            text: 'Webden bakıyorum',
            toolCalls: [{ id: 'tc-2', name: 'web_fetch', arguments: { url: 'https://example.com' } }]
          };
        }
        const toolMessage = [...messages].reverse().find((m) => m.role === 'tool');
        lastToolResult = toolMessage?.content || '';
        return { text: 'Rapor bitti.' };
      }
    };

    const fakeSkillManager = {
      getCustomAgents: () => [
        {
          name: 'web-uzmanı',
          role: 'web-uzmanı',
          description: 'web araştırmacısı',
          path: '.agents/agents/web.md',
          prompt: 'Web araştır.',
          allowedTools: ['web_fetch']
        }
      ],
      getPromptContext: () => ''
    } as unknown as SkillManager;

    const permissionManager = new PermissionManager(permissive);
    const manager = new SubagentManager(
      toolProvider,
      undefined,
      fakeSkillManager,
      undefined,
      undefined,
      permissionManager
    );

    const result = await manager.runSubagent({ role: 'web-uzmanı', task: 'Araştır' }, '/mock/ws', 1);
    assert.ok(result.includes('Rapor bitti.'));
    assert.ok(lastToolResult.includes('[Approval Required]'), `onay reddi bekleniyordu: ${lastToolResult}`);
  });

  it('passes callGraph and gitManager to subagent tool execution context', async () => {
    let callCount = 0;
    const toolProvider: ModelProvider = {
      id: 'test',
      name: 'Test',
      sendMessage: async () => {
        callCount++;
        if (callCount === 1) {
          return {
            text: 'Çağıranları sorguluyorum',
            toolCalls: [
              {
                id: 'tc-1',
                name: 'get_callers',
                arguments: { symbol: 'hesapla' }
              }
            ]
          };
        }
        return { text: 'Analiz tamamlandı.' };
      }
    };

    const mockCallGraph = {
      status: () => ({ ready: true, message: 'Harita hazır' }),
      getDocument: () => ({
        meta: { version: 1 },
        nodes: [
          {
            id: 'src/a.ts#hesapla',
            name: 'hesapla',
            kind: 'function',
            file: 'src/a.ts',
            startLine: 1,
            endLine: 2,
            exported: true,
            isTest: false
          }
        ],
        edges: [],
        files: {}
      })
    } as unknown as CallGraphManager;

    const manager = new SubagentManager(
      toolProvider,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      mockCallGraph
    );

    const result = await manager.runSubagent(
      { role: 'architect', task: 'Çağıranları bul' },
      '/mock/workspace',
      1
    );
    assert.ok(result.includes('Analiz tamamlandı.'));
  });
});

describe('SubagentManager: agent bazlı model ve otomatik fallback', () => {
  /** 13 mevcut konumdan sonraki iki yeni parametreye kadar undefined taşır. */
  function managerWith(
    provider: ModelProvider,
    router: (
      role: string,
      task: string
    ) => { model?: string; fallbackModel?: string; reason: string; routed: boolean },
    factory: (model: string) => ModelProvider | undefined,
    onStatus?: (role: string, status: string) => void
  ): SubagentManager {
    return new SubagentManager(
      provider,
      onStatus as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      router,
      factory
    );
  }

  it('alt ajanı rolüne göre çözümlenen modelin sağlayıcısıyla çalıştırır', async () => {
    const used: string[] = [];
    const base: ModelProvider = {
      id: 'base',
      name: 'base',
      sendMessage: async () => {
        used.push('base');
        return { text: 'base rapor' };
      }
    };
    const routed: ModelProvider = {
      id: 'glm',
      name: 'glm',
      sendMessage: async () => {
        used.push('glm');
        return { text: 'GLM raporu' };
      }
    };
    const manager = managerWith(
      base,
      () => ({ model: 'GLM-5.3', reason: '', routed: true }),
      (model) => (model === 'GLM-5.3' ? routed : undefined)
    );
    const result = await manager.runSubagent({ role: 'backend', task: 'api yaz' }, undefined, 1);
    assert.ok(result.includes('GLM raporu'));
    assert.deepStrictEqual(used, ['glm'], 'yalnızca yönlendirilen model çağrılmalı');
  });

  it('ana model hata verince bağlamı koruyarak yedek modele geçer', async () => {
    const base: ModelProvider = {
      id: 'base',
      name: 'base',
      sendMessage: async () => {
        throw new Error('HTTP 503 model unavailable');
      }
    };
    let fallbackSawSystemPrompt = '';
    const fallback: ModelProvider = {
      id: 'mimo',
      name: 'mimo',
      sendMessage: async (messages) => {
        fallbackSawSystemPrompt = messages[0]?.content || '';
        return { text: 'Yedek model raporu' };
      }
    };
    const statuses: string[] = [];
    const manager = managerWith(
      base,
      () => ({ model: 'GLM-5.3', fallbackModel: 'MiMo-V2.6-Pro', reason: '', routed: true }),
      (model) => (model === 'MiMo-V2.6-Pro' ? fallback : undefined),
      (_role, status) => statuses.push(status)
    );
    const result = await manager.runSubagent({ role: 'backend', task: 'api yaz' }, undefined, 1);
    assert.ok(result.includes('Yedek model raporu'), `fallback bekleniyordu: ${result}`);
    assert.ok(fallbackSawSystemPrompt.includes('TASK: api yaz'), 'görev bağlamı yedeğe taşınmalı');
    assert.ok(
      statuses.some((s) => s.includes('yedek model')),
      `fallback bildirimi bekleniyordu: ${statuses.join('|')}`
    );
  });
});
