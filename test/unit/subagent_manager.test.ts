import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { SubagentManager } from '../../src/core/multiagent/SubagentManager';
import { ModelProvider } from '../../src/providers/base';
import type { CallGraphManager } from '../../src/core/callgraph/CallGraphManager';

const provider: ModelProvider = {
  id: 'test',
  name: 'Test',
  sendMessage: async () => ({ text: 'Alt ajan raporu' })
};

describe('SubagentManager: role and depth limits', () => {
  it('rejects an unknown role delegated by the manager', async () => {
    const manager = new SubagentManager(provider);
    const result = await manager.runSubagent({ role: 'bilinmeyen-rol', task: 'x' }, undefined, 1);
    assert.ok(result.includes('was found'));
  });

  it('rejects a specialist started at the top level (hierarchy)', async () => {
    const manager = new SubagentManager(provider);
    const result = await manager.runSubagent({ role: 'security', task: 'x' });
    assert.ok(result.includes('Only the @manager role'));
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
