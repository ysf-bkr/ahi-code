import { describe, it, beforeEach, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { AgentCore } from '../../src/core/agent/AgentCore';
import { ModelCompletionResponse, ModelProvider, ProviderMessage } from '@ahicode/core/providers/base';
import { UserSettings } from '@ahicode/core/shared/types';

/**
 * Sohbet turu sözleşmeleri:
 * 1. Düzenleme, istemi ikinci kez eklemek yerine o turdan sonrasını atar.
 * 2. Bir kullanıcı istemi ve tüm asistan adımları aynı `turnId`'yi taşır;
 *    arayüz bunları tek yanıt bloğunda toplar.
 */
class ScriptedProvider implements ModelProvider {
  public readonly id = 'scripted';
  public readonly name = 'Scripted';
  public readonly received: ProviderMessage[][] = [];
  private index = 0;

  constructor(private readonly responses: ModelCompletionResponse[]) {}

  async sendMessage(messages: ProviderMessage[]): Promise<ModelCompletionResponse> {
    this.received.push([...messages]);
    const response = this.responses[this.index] ?? { text: 'done' };
    this.index++;
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-chat-turns-'));
  roots.push(root);
  await fs.mkdir(path.join(root, '.ahi'), { recursive: true });
  return root;
}

function createAgent(provider: ModelProvider, root: string) {
  const core = new AgentCore(
    stub.createExtensionContext() as never,
    baseSettings,
    () => {},
    () => {},
    undefined,
    { provider }
  );
  stub.testState.workspaceRoot = root;
  return core;
}

describe('Sohbet turları: düzenleme ve gruplama', () => {
  beforeEach(() => {
    stub.resetTestState();
  });

  after(async () => {
    await Promise.all(roots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('düzenleme eski turu atar ve istemi yalnızca bir kez ekler', async () => {
    const root = await workspace();
    const core = createAgent(
      new ScriptedProvider([{ text: 'ilk yanıt' }, { text: 'ikinci yanıt' }, { text: 'düzeltilmiş yanıt' }]),
      root
    );

    await core.handleSendMessage('ilk istem');
    await core.handleSendMessage('ikinci istem');

    const firstUser = core.getState().messages.find((message) => message.content === 'ilk istem');
    assert.ok(firstUser, 'ilk istem kaydedilmeli');

    await core.editMessage(firstUser.id, 'düzeltilmiş istem');

    const messages = core.getState().messages;
    const userMessages = messages.filter((message) => message.role === 'user');

    assert.deepStrictEqual(
      userMessages.map((message) => message.content),
      ['düzeltilmiş istem'],
      'düzenleme sonrası yalnızca düzeltilmiş istem kalmalı'
    );
    assert.equal(
      messages.some((message) => message.content === 'ikinci istem'),
      false,
      'düzenlenen turdan sonraki mesajlar atılmalı'
    );
    assert.equal(
      messages.filter((message) => message.role === 'assistant').at(-1)?.content,
      'düzeltilmiş yanıt'
    );
  });

  it('kullanıcı istemi ve asistan yanıtları aynı turn kimliğini paylaşır', async () => {
    const root = await workspace();
    const core = createAgent(new ScriptedProvider([{ text: 'yanıt' }]), root);

    await core.handleSendMessage('görev');

    const messages = core.getState().messages;
    const user = messages.find((message) => message.role === 'user');
    assert.ok(user?.turnId, 'kullanıcı mesajı tur kimliği taşımalı');

    const assistants = messages.filter((message) => message.role === 'assistant');
    assert.ok(assistants.length > 0);
    for (const message of assistants) {
      assert.equal(message.turnId, user.turnId, 'asistan adımları aynı tura bağlanmalı');
    }
  });

  it('yeni sohbet açıkken çalışan görevi durdurur', async () => {
    const root = await workspace();
    const core = createAgent(new ScriptedProvider([{ text: 'yanıt' }]), root);

    await core.handleSendMessage('görev');
    await core.createNewSession();

    assert.equal(core.getState().messages.length, 0, 'yeni sohbet mesajları temizler');
    assert.equal(core.getState().status, 'idle');
  });
});
