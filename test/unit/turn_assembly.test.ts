import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { ChatMessage, ToolCall, UserSettings } from '@ahicode/core/shared/types';
import { PermissionManager } from '@ahicode/core/core/permission/PermissionManager';
import { buildProviderMessages, mapModelToolCalls } from '@ahicode/core/core/agent/turnAssembly';

const settings: UserSettings = {
  selectedProvider: 'ollama',
  selectedModel: 'llama3.1',
  apiKeys: {},
  autoApprove: {
    readFiles: true,
    writeFiles: false,
    executeCommands: false
  }
};

const baseCall = (overrides: Partial<ToolCall>): ToolCall => ({
  id: 'call_1',
  name: 'read_file',
  args: { path: 'src/a.ts' },
  requiresApproval: false,
  status: 'pending',
  ...overrides
});

describe('turnAssembly: provider message scaffolding', () => {
  it('puts system prompt first and preserves user message', () => {
    const messages: ChatMessage[] = [
      { id: 'm1', role: 'user', content: 'görev', timestamp: 1 },
      { id: 'm2', role: 'assistant', content: 'yanıt', timestamp: 2 }
    ];
    const providerMessages = buildProviderMessages('SİSTEM', messages);
    assert.deepStrictEqual(providerMessages[0], { role: 'system', content: 'SİSTEM' });
    assert.deepStrictEqual(providerMessages[1], { role: 'user', content: 'görev' });
    assert.deepStrictEqual(providerMessages[2], {
      role: 'assistant',
      content: 'yanıt',
      toolCalls: undefined
    });
  });

  it('oturum içi sistem notlarını konumunu koruyarak kullanıcı rolünde taşır', () => {
    const messages: ChatMessage[] = [
      { id: 'm1', role: 'user', content: 'soru', timestamp: 1 },
      { id: 'm2', role: 'system', content: 'bağlam özeti', timestamp: 2 }
    ];
    const providerMessages = buildProviderMessages('SİSTEM', messages);
    assert.strictEqual(providerMessages.length, 3);
    // Uç noktlar system rolünü yalnızca ilk mesajda kabul eder; ortadaki
    // system notu kullanıcı rolünde işaretli blok olarak taşınır.
    assert.deepStrictEqual(providerMessages[2], {
      role: 'user',
      content: '<system_context>\nbağlam özeti\n</system_context>'
    });
    // Değişmezlik: system rolü yalnızca dizinin başında olabilir.
    providerMessages.slice(1).forEach((m) => assert.notStrictEqual(m.role, 'system'));
  });

  it('sends only settled tool calls', () => {
    const messages: ChatMessage[] = [
      {
        id: 'm1',
        role: 'user',
        content: 'görev',
        timestamp: 1
      },
      {
        id: 'm2',
        role: 'assistant',
        content: '',
        timestamp: 2,
        toolCalls: [
          baseCall({ id: 'ok', status: 'completed', result: 'içerik' }),
          baseCall({ id: 'pend', status: 'pending' }),
          baseCall({ id: 'exec', status: 'executing' }),
          baseCall({ id: 'err', status: 'error', error: 'patladı' })
        ]
      }
    ];
    const providerMessages = buildProviderMessages('SİSTEM', messages);

    const assistant = providerMessages.find((m) => m.role === 'assistant');
    assert.ok(assistant, 'assistant message not found');
    // Pending ve executing durumdaki çağrılar atılır; sonuçlanmış çağrılar gönderilir.
    assert.deepStrictEqual(
      (assistant.toolCalls || []).map((tc) => tc.id),
      ['ok', 'err']
    );

    const toolMessages = providerMessages.filter((m) => m.role === 'tool');
    assert.deepStrictEqual(
      toolMessages.map((m) => m.toolCallId),
      ['ok', 'err']
    );
    assert.strictEqual(toolMessages[0]?.content, 'içerik');
    assert.match(toolMessages[1]?.content || '', /\[TOOL ERROR\]: patladı/);
  });

  it('skips empty assistant messages', () => {
    const messages: ChatMessage[] = [
      { id: 'm1', role: 'user', content: 'soru', timestamp: 1 },
      { id: 'm2', role: 'assistant', content: '', timestamp: 2 }
    ];
    const providerMessages = buildProviderMessages('SİSTEM', messages);
    assert.strictEqual(providerMessages.length, 2);
    assert.strictEqual(
      providerMessages.some((m) => m.role === 'assistant'),
      false
    );
  });

  it('stream message with text is sent even without tool call', () => {
    const messages: ChatMessage[] = [{ id: 'm2', role: 'assistant', content: 'sadece metin', timestamp: 2 }];
    const providerMessages = buildProviderMessages('SİSTEM', messages);
    assert.strictEqual(providerMessages.length, 2);
    assert.deepStrictEqual(providerMessages[1], {
      role: 'assistant',
      content: 'sadece metin',
      toolCalls: undefined
    });
  });
});

describe('turnAssembly: model tool call mapping', () => {
  it('fills description, approval requirement and reason', () => {
    const manager = new PermissionManager(settings);
    const mapped = mapModelToolCalls(
      [
        { id: 'c1', name: 'write_file', arguments: { path: 'src/a.ts', content: 'x' } },
        { id: 'c2', name: 'read_file', arguments: { path: 'src/b.ts' } }
      ],
      manager
    );

    assert.strictEqual(mapped.length, 2);
    assert.strictEqual(mapped[0]?.status, 'pending');
    // writeFiles otomatik onayı kapalı: onay bir gerekçeyle istenir.
    assert.strictEqual(mapped[0]?.requiresApproval, true);
    assert.ok(mapped[0]?.approvalReason, 'approval reason should be written');
    assert.ok(mapped[0]?.explanation, 'tool description should be written');
    // readFiles auto-approve is on: no approval needed.
    assert.strictEqual(mapped[1]?.requiresApproval, false);
    assert.strictEqual(mapped[1]?.approvalReason, undefined);
  });

  it('risky command always requires approval', () => {
    const permissive: UserSettings = {
      ...settings,
      autoApprove: { readFiles: true, writeFiles: true, executeCommands: true }
    };
    const manager = new PermissionManager(permissive);
    const mapped = mapModelToolCalls(
      [{ id: 'c1', name: 'execute_command', arguments: { command: 'bash -c "rm -rf ~"' } }],
      manager
    );
    assert.strictEqual(mapped[0]?.requiresApproval, true);

    const safe = mapModelToolCalls(
      [{ id: 'c2', name: 'execute_command', arguments: { command: 'npm test' } }],
      manager
    );
    assert.strictEqual(safe[0]?.requiresApproval, false);
  });
});
