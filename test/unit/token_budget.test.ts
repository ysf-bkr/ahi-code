import { describe, it, beforeEach, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { AgentCore } from '../../src/core/agent/AgentCore';
import { ModelCompletionResponse, ModelProvider, ProviderMessage } from '@ahicode/core/providers/base';
import { TaskState, UserSettings } from '@ahicode/core/shared/types';

/**
 * Token bütçesi sözleşmesi (`ahiCode.maxTokensPerTask`).
 *
 * 1. Bütçe kontrolü bir sonraki model çağrısından ÖNCE yapılır: duraklatılan
 *    turda model çağrısı yapılmaz, yarım işlenmiş araç çağrısı ve boşa
 *    harcanan yanıt kalmaz.
 * 2. Kullanım bilgisi ancak yanıtın sonunda geldiği için aşım en fazla bir
 *    model yanıtıyla sınırlıdır.
 * 3. 0 (varsayılan) sınırsız demektir; bütçe aşılmadıkça görev normal biter.
 */
class CountingProvider implements ModelProvider {
  public readonly id = 'counting';
  public readonly name = 'Counting';
  public calls = 0;

  constructor(private readonly responses: ModelCompletionResponse[]) {}

  async sendMessage(_messages: ProviderMessage[]): Promise<ModelCompletionResponse> {
    const response = this.responses[this.calls] ?? { text: 'done' };
    this.calls++;
    return response;
  }
}

interface StubModule {
  testState: { workspaceRoot?: string };
  resetTestState(): void;
  createExtensionContext(): unknown;
}

const stub = vscode as unknown as StubModule;

const baseSettings: UserSettings = {
  selectedProvider: 'ollama',
  selectedModel: 'llama3.1',
  apiKeys: {},
  autoApprove: { readFiles: true, writeFiles: false, executeCommands: false },
  autoVerify: false,
  maxRepairAttempts: 0,
  useIntegratedTerminal: false,
  sandbox: { mode: 'none', image: 'node:20-bookworm', network: false }
};

const roots: string[] = [];

async function workspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-token-budget-'));
  roots.push(root);
  await fs.mkdir(path.join(root, '.ahi'), { recursive: true });
  return root;
}

function createAgent(provider: ModelProvider, root: string, overrides: Partial<UserSettings> = {}) {
  const states: TaskState[] = [];
  const notifications: string[] = [];
  const core = new AgentCore(
    stub.createExtensionContext() as never,
    { ...baseSettings, ...overrides },
    (state) => states.push(state),
    (notification) => notifications.push(notification.message),
    undefined,
    { provider }
  );
  stub.testState.workspaceRoot = root;
  return { core, states, notifications };
}

// Salt-okunur araç çağrısı: onay gerektirmez, bütçe kontrolünü tur içinde
// ikinci model çağrısına taşımak için kullanılır.
const listCall: ModelCompletionResponse = {
  text: '',
  toolCalls: [{ id: 'ls_1', name: 'list_directory', arguments: { path: '.' } }],
  usage: { promptTokens: 90, completionTokens: 60, totalTokens: 150 }
};

describe('Token bütçesi (maxTokensPerTask)', () => {
  beforeEach(() => {
    stub.resetTestState();
  });

  after(async () => {
    await Promise.all(roots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('bütçe aşıldığında sonraki model çağrısından önce duraklatır', async () => {
    const root = await workspace();
    const provider = new CountingProvider([listCall, { text: 'bitti' }]);
    const { core, notifications } = createAgent(provider, root, {
      autonomy: 'guided',
      maxTokensPerTask: 100
    });

    await core.handleSendMessage('dosyaları listele');

    assert.strictEqual(core.getState().status, 'paused', 'görev duraklatılmış olmalı');
    assert.strictEqual(
      provider.calls,
      1,
      'ikinci model çağrısı yapılmamalı: duraklatılan turda token harcanmaz'
    );
    assert.strictEqual(core.getState().stats.totalTokens, 150, 'kullanım toplanmalı');
    assert.ok(
      notifications.some((message) => message.includes('Token bütçesi')),
      'kullanıcıya neden duraklatıldığı bildirilmeli'
    );
    // Yarım tur kalmamalı: duraklatma, akış mesajı eklenmeden önce olur.
    const lastMessage = core.getState().messages[core.getState().messages.length - 1];
    assert.ok(lastMessage, 'en az bir mesaj olmalı');
    assert.notStrictEqual(
      lastMessage?.role === 'assistant' && lastMessage?.content === '' && lastMessage?.isStreaming,
      true,
      'boş bir akış mesajı bırakılmamalı'
    );
  });

  it('0 (sınırsız) bütçede görevi duraklatmaz', async () => {
    const root = await workspace();
    const provider = new CountingProvider([listCall, { text: 'bitti' }]);
    const { core, notifications } = createAgent(provider, root, {
      autonomy: 'guided',
      maxTokensPerTask: 0
    });

    await core.handleSendMessage('dosyaları listele');

    assert.strictEqual(core.getState().status, 'completed', 'görev normal bitmeli');
    assert.strictEqual(provider.calls, 2, 'tur tamamlanmalı');
    assert.ok(
      !notifications.some((message) => message.includes('Token bütçesi')),
      'sınırsız bütçede bütçe uyarısı olmamalı'
    );
  });

  it('bütçe aşılmadığında görevi duraklatmaz', async () => {
    const root = await workspace();
    const provider = new CountingProvider([listCall, { text: 'bitti' }]);
    const { core } = createAgent(provider, root, {
      autonomy: 'guided',
      maxTokensPerTask: 100_000
    });

    await core.handleSendMessage('dosyaları listele');

    assert.strictEqual(core.getState().status, 'completed', 'görev normal bitmeli');
    assert.strictEqual(provider.calls, 2, 'tur tamamlanmalı');
  });
});
