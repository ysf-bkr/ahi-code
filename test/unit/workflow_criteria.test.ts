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
 * Kabul kriterleri dürüstlük sözleşmesi.
 *
 * Doğrulama geçtiğinde bile kriterler kendiliğinden işaretlenmez: bir kriter
 * yalnızca modelin açık `update_acceptance_criteria` kararıyla tamamlandı
 * sayılır. "Testler geçer" gibi metni doğrulamayla örtüşen bir kriter otomatik
 * işaretlenirse görev gerçekte tamamlanmamışken "bitti" kapanır — bu regresyon
 * testi o davranışı yasaklar.
 */
class ScriptedProvider implements ModelProvider {
  public readonly id = 'scripted';
  public readonly name = 'Scripted';
  private index = 0;

  constructor(private readonly responses: ModelCompletionResponse[]) {}

  async sendMessage(_messages: ProviderMessage[]): Promise<ModelCompletionResponse> {
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-criteria-flow-'));
  roots.push(root);
  await fs.mkdir(path.join(root, '.ahi'), { recursive: true });
  return root;
}

function createAgent(provider: ModelProvider, root: string, overrides: Partial<UserSettings> = {}) {
  const states: TaskState[] = [];
  const core = new AgentCore(
    stub.createExtensionContext() as never,
    { ...baseSettings, ...overrides },
    (state) => states.push(state),
    () => undefined,
    undefined,
    { provider }
  );
  stub.testState.workspaceRoot = root;
  return { core, states };
}

const specCall: ModelCompletionResponse = {
  text: '',
  toolCalls: [
    {
      id: 'spec_1',
      name: 'write_spec',
      arguments: {
        goal: 'Ekran ekle',
        scope: ['webview-ui'],
        // İkinci kriter bilinçli olarak doğrulama sözleri içeriyor.
        acceptanceCriteria: ['Ekran görünür', 'Testler geçer']
      }
    }
  ]
};

const planCall: ModelCompletionResponse = {
  text: '',
  toolCalls: [
    {
      id: 'plan_1',
      name: 'update_plan',
      arguments: {
        goal: 'Ekran ekle',
        steps: [{ title: 'Bileşeni yaz', files: ['webview-ui/src/App.tsx'] }]
      }
    }
  ]
};

const markFirstCriterionOnly: ModelCompletionResponse = {
  text: '',
  toolCalls: [
    {
      id: 'criteria_1',
      name: 'update_acceptance_criteria',
      arguments: { criteria: [{ id: 'ac-1', done: true }] }
    }
  ]
};

describe('Kabul kriterleri: doğrulama geçse de otomatik işaretlenmez', () => {
  beforeEach(() => {
    stub.resetTestState();
  });

  after(async () => {
    await Promise.all(roots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('işaretlenmemiş kriter kalırsa doğrulama geçmiş olsa bile görev kapanmaz', async () => {
    const root = await workspace();
    const { core } = createAgent(
      new ScriptedProvider([specCall, planCall, markFirstCriterionOnly, { text: 'bitti' }]),
      root,
      { autonomy: 'guided' }
    );

    // Doğrulama "geçti" sayılır (atlandı değil): tek engel işaretsiz kriter olmalı.
    core.getState().stats.verification = {
      status: 'skipped',
      attempts: 0,
      summary: 'otomatik doğrulama kapalı'
    };

    // Tur 1: spec + plan onayları otomatik, ilk kriter işaretlenir, tur biter.
    await core.handleSendMessage('ekran ekle');
    assert.strictEqual(core.getState().workflow?.stage, 'review', 'tur sonunda inceleme aşamasına geçmeli');

    // Tur 2: inceleme → doğrulama; bitti kapısı işaretsiz kriter yüzünden kapalı kalmalı.
    await core.handleSendMessage('devam et');

    const criteria = core.getState().spec?.acceptanceCriteria ?? [];
    const testCriterion = criteria.find((criterion) => criterion.id === 'ac-2');
    assert.ok(testCriterion, 'ikinci kriter spec içinde olmalı');
    assert.strictEqual(
      testCriterion?.done,
      false,
      '"Testler geçer" kriteri doğrulama geçti diye otomatik işaretlenmemeli'
    );
    assert.strictEqual(
      criteria.find((criterion) => criterion.id === 'ac-1')?.done,
      true,
      'modelin açıkça işaretlediği kriter tamamlanmış kalmalı'
    );

    const workflow = core.getState().workflow;
    assert.notStrictEqual(workflow?.stage, 'done', 'görev kapanmamalı');
    assert.match(workflow?.blockedReason ?? '', /kabul kriterleri/, 'engel dürüstçe bildirilmeli');
  });
});
