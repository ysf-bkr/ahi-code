import { describe, it, beforeEach, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { AgentCore } from '../../src/core/agent/AgentCore';
import { ModelCompletionResponse, ModelProvider, ProviderMessage } from '../../src/providers/base';
import { TaskState, UserSettings } from '../../src/shared/types';

/**
 * Tur içi aşama geçişlerinin araç listesine yansıması.
 *
 * Gerçek hata: `agentLoop` araç listesini turun başında bir kez hesaplıyordu.
 * Otonom modda spec ve plan aynı tur içinde otomatik onaylanıp aşama `build`'e
 * geçtiğinde, araç listesi hâlâ salt-okunur kalıyordu; modelin ilk yazma
 * denemesi "Tool is not allowed at this stage" hatası alıyordu — oysa aşama
 * artık `build`'di. Bu test o hatayı yakalar.
 */
class ScriptedProvider implements ModelProvider {
  public readonly id = 'scripted';
  public readonly name = 'Scripted';
  public readonly requests: ProviderMessage[][] = [];
  private index = 0;

  constructor(private readonly responses: ModelCompletionResponse[]) {}

  async sendMessage(messages: ProviderMessage[]): Promise<ModelCompletionResponse> {
    this.requests.push(messages);
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

const settings: UserSettings = {
  selectedProvider: 'ollama',
  selectedModel: 'llama3.1',
  apiKeys: {},
  autoApprove: { readFiles: true, writeFiles: true, executeCommands: false },
  autoVerify: false,
  maxRepairAttempts: 0,
  useIntegratedTerminal: false,
  autonomy: 'auto',
  sandbox: { mode: 'none', image: 'node:20-bookworm', network: false }
};

const roots: string[] = [];

async function workspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-stage-'));
  roots.push(root);
  await fs.mkdir(path.join(root, '.ahi'), { recursive: true });
  return root;
}

const specCall: ModelCompletionResponse = {
  text: '',
  toolCalls: [
    {
      id: 'c_spec',
      name: 'write_spec',
      arguments: { goal: 'Dosya ekle', scope: ['src'], acceptanceCriteria: ['Dosya var'] }
    }
  ]
};

const planCall: ModelCompletionResponse = {
  text: '',
  toolCalls: [
    {
      id: 'c_plan',
      name: 'update_plan',
      arguments: { goal: 'Dosya ekle', steps: [{ title: 'Yaz', files: ['src/a.ts'] }] }
    }
  ]
};

const writeCall: ModelCompletionResponse = {
  text: '',
  toolCalls: [
    {
      id: 'c_write',
      name: 'write_file',
      arguments: { path: 'src/a.ts', content: 'export const a = 1;\n' }
    }
  ]
};

describe('Ajan döngüsü: tur içi aşama geçişi', () => {
  beforeEach(() => {
    stub.resetTestState();
  });

  after(async () => {
    await Promise.all(roots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('auto modda spec+plan sonrası aynı turda yazma açılır', async () => {
    const root = await workspace();
    const states: TaskState[] = [];
    const core = new AgentCore(
      stub.createExtensionContext() as never,
      settings,
      (state) => states.push(state),
      () => {},
      undefined,
      { provider: new ScriptedProvider([specCall, planCall, writeCall, { text: 'bitti' }]) }
    );
    stub.testState.workspaceRoot = root;

    await core.handleSendMessage('dosya ekle');

    const workflow = core.getState().workflow;
    // Spec ve plan otomatik onaylanıp aşama build'e geçti; tur sonunda
    // değişiklik olduğu için ilerleme bir adım daha atıp review'a geldi.
    assert.ok(
      workflow?.stage === 'build' || workflow?.stage === 'review',
      `aşama build'i geçmeli, gerçek: ${workflow?.stage}`
    );
    assert.strictEqual(workflow?.planApproved, true);

    // Dosya gerçekten yazılmış olmalı; araç listesi bayat olsaydı
    // "not allowed at this stage" hatası alırdık ve dosya oluşmazdı.
    const written = await fs.readFile(path.join(root, 'src/a.ts'), 'utf-8').catch(() => null);
    assert.ok(written, 'write_file aynı tur içinde çalışmalı (araç listesi taze olmalı)');

    await core.cancelTask();
  });
});
