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
 * Otonomi akışı: "baştan sona kendi başına bitir".
 *
 * İki sözleşme test edilir:
 * 1. `guided`/`auto` modunda spec ve plan kartı ajanı durdurmaz.
 * 2. `auto` modda olağan dosya yazma onay beklemeden yürür (seviyenin sözü);
 *    hassas dosya/riskli komut gibi gerçek güvenlik sınırları ise ayrı
 *    testlerde (autonomy_permissions.test.ts) her seviyede sorulur.
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-autonomy-'));
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

const specCall: ModelCompletionResponse = {
  text: '',
  toolCalls: [
    {
      id: 'spec_1',
      name: 'write_spec',
      arguments: {
        goal: 'Ekran ekle',
        scope: ['webview-ui'],
        acceptanceCriteria: [
          'Ekran görünür ve düğme çalışır',
          'Geçersiz girdide hata mesajı gösterilir',
          'Boş liste sınırında çökmez'
        ]
      }
    }
  ]
};

const moduleCall: ModelCompletionResponse = {
  text: '',
  toolCalls: [
    {
      id: 'modules_1',
      name: 'update_module_plan',
      arguments: {
        goal: 'Ekran ekle',
        modules: [
          {
            id: 'ui-screen',
            name: 'Ekran',
            layer: 'interface',
            paths: ['webview-ui/src/App.tsx'],
            responsibility: 'Ekranı çizer',
            ownerRole: 'frontend',
            criteria: ['ac-1']
          }
        ]
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
        steps: [
          {
            title: 'Bileşeni yaz',
            files: ['webview-ui/src/App.tsx'],
            moduleId: 'ui-screen',
            criteria: ['ac-1']
          }
        ]
      }
    }
  ]
};

describe('Autonomy: approval gates', () => {
  beforeEach(() => {
    stub.resetTestState();
  });

  after(async () => {
    await Promise.all(roots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('manual mode pauses for spec approval', async () => {
    const root = await workspace();
    const { core, states } = createAgent(new ScriptedProvider([specCall, { text: 'bitti' }]), root);

    await core.handleSendMessage('ekran ekle');

    assert.strictEqual(core.getState().pendingApproval?.kind, 'spec');
    assert.strictEqual(core.getState().status, 'waiting_user_input');
    assert.ok(states.some((state) => state.pendingApproval?.kind === 'spec'));
  });

  it('guided mode skips the spec gate and continues to planning', async () => {
    const root = await workspace();
    const { core } = createAgent(new ScriptedProvider([specCall, { text: 'bitti' }]), root, {
      autonomy: 'guided'
    });

    await core.handleSendMessage('ekran ekle');

    assert.strictEqual(core.getState().pendingApproval, undefined, 'otonom modda spec kartı beklenmemeli');
    const workflow = core.getState().workflow;
    assert.strictEqual(workflow?.specApproved, true);
    assert.notStrictEqual(core.getState().status, 'waiting_user_input');
  });

  it('auto mode skips the plan gate and assigns owner roles', async () => {
    const root = await workspace();
    const { core } = createAgent(
      new ScriptedProvider([specCall, moduleCall, planCall, { text: 'bitti' }]),
      root,
      {
        autonomy: 'auto'
      }
    );

    await core.handleSendMessage('ekran ekle');

    assert.strictEqual(core.getState().pendingApproval, undefined, 'plan kartı da beklenmemeli');
    const plan = core.getTaskPlanner().getPlan();
    assert.ok(plan, 'plan oluşmalı');
    assert.strictEqual(plan?.steps[0]?.ownerRole, 'frontend', 'rol dosya yolundan atanmalı');
    assert.strictEqual(plan?.steps[0]?.ownerRoleSource, 'routing');

    // Otonom mod arka planda devam turları zamanlar; testi belirlenimci tut.
    await core.cancelTask();
  });

  it('auto mode runs a routine write without an approval card', async () => {
    const root = await workspace();
    const writeCall: ModelCompletionResponse = {
      text: '',
      toolCalls: [
        {
          id: 'write_1',
          name: 'write_file',
          arguments: { path: 'src/new.ts', content: 'export const a = 1;\n' }
        }
      ]
    };
    const { core, states } = createAgent(new ScriptedProvider([writeCall, { text: 'bitti' }]), root, {
      autonomy: 'auto'
      // autoApprove.writeFiles bilinçli kapalı: seviyenin kendisi otomatik onaylar.
    });

    const workflow = core.getState().workflow ?? {};
    // Doğrudan uygulama aşamasına al: kapılar zaten otomatik.
    core.getState().workflow = {
      stage: 'build',
      questionsAsked: 0,
      specApproved: true,
      planApproved: true,
      knowledgeReady: true,
      updatedAt: Date.now(),
      ...workflow
    };
    core.getState().workflow!.stage = 'build';
    core.getState().workflow!.specApproved = true;
    core.getState().workflow!.planApproved = true;

    await core.handleSendMessage('dosya oluştur');

    assert.ok(
      !states.some((state) => state.status === 'waiting_approval'),
      'Otonom modda olağan dosya yazma onay kartıyla durmamalı'
    );
    const written = await fs.stat(path.join(root, 'src/new.ts')).then(
      () => true,
      () => false
    );
    assert.ok(written, 'yazma onaysız uygulanmış olmalı');
  });

  it('does not auto-continue in guided mode', async () => {
    const root = await workspace();
    const { core } = createAgent(new ScriptedProvider([{ text: 'bitti' }]), root, { autonomy: 'guided' });

    await core.handleSendMessage('bir şey');
    // Kısa bir bekleme: otonom devam tetiklenirse ikinci tur başlar.
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.strictEqual(core.getState().stats.stepsCount, 1, 'guided modda tek tur çalışmalı');
  });

  it('auto mode keeps working after a turn instead of stopping at status=completed', async () => {
    const root = await workspace();
    const writeCall: ModelCompletionResponse = {
      text: '',
      toolCalls: [
        { id: 'w1', name: 'write_file', arguments: { path: 'src/a.ts', content: 'export const a = 1;\n' } }
      ]
    };
    const { core } = createAgent(
      new ScriptedProvider([writeCall, { text: 'ilk tur' }, { text: 'ikinci tur' }]),
      root,
      {
        autonomy: 'auto',
        autoApprove: { readFiles: true, writeFiles: true, executeCommands: false }
      }
    );
    const workflow = core.getState().workflow!;
    workflow.stage = 'build';
    workflow.specApproved = true;
    workflow.planApproved = true;
    workflow.knowledgeReady = true;
    core.getState().workflow = workflow;

    await core.handleSendMessage('dosya oluştur');
    // Devam turu zamanlayıcıyla başlar; kısa bir bekleme yeterli.
    await new Promise((resolve) => setTimeout(resolve, 150));

    assert.ok(
      core.autoContinuations >= 1,
      'auto modda tur sonunda devam turu başlamalı (status=completed bunu durdurmamalı)'
    );
    assert.ok(core.getState().stats.stepsCount >= 2, 'en az iki tur çalışmalı');
    await core.cancelTask();
  });

  it('does not block on a follow-up question in autonomous mode', async () => {
    const root = await workspace();
    const questionCall: ModelCompletionResponse = {
      text: '',
      toolCalls: [
        {
          id: 'q1',
          name: 'ask_followup_question',
          arguments: { question: 'Hangi dosyaya yazayım?' }
        }
      ]
    };
    const { core, states } = createAgent(new ScriptedProvider([questionCall, { text: 'devam' }]), root, {
      autonomy: 'guided'
    });

    await core.handleSendMessage('ekran ekle');

    assert.strictEqual(
      states.some((state) => state.status === 'waiting_user_input'),
      false,
      'otonom modda soru kullanıcıyı beklememeli'
    );
    assert.notStrictEqual(core.getState().status, 'waiting_user_input');
  });

  it('still asks the user in manual mode', async () => {
    const root = await workspace();
    const questionCall: ModelCompletionResponse = {
      text: '',
      toolCalls: [{ id: 'q2', name: 'ask_followup_question', arguments: { question: 'Hangisi?' } }]
    };
    const { core } = createAgent(new ScriptedProvider([questionCall, { text: 'devam' }]), root);

    const run = core.handleSendMessage('ekran ekle');
    const asked = await waitFor(() => core.getState().status === 'waiting_user_input');
    assert.ok(asked, 'elle modda soru kullanıcıya sorulmalı');
    await core.provideUserReply('ilk dosya');
    await run;
  });

  it('does not revive a cancelled autonomous task', async () => {
    const root = await workspace();
    const { core } = createAgent(new ScriptedProvider([specCall, planCall, { text: 'bitti' }]), root, {
      autonomy: 'auto'
    });

    await core.handleSendMessage('ekran ekle');
    await core.cancelTask();
    const stepsAfterCancel = core.getState().stats.stepsCount;

    // Bekleyen devam zamanlayıcısı iptal edilmiş görevi yeniden başlatmamalı.
    await new Promise((resolve) => setTimeout(resolve, 80));

    assert.strictEqual(core.getState().status, 'cancelled');
    assert.strictEqual(core.getState().stats.stepsCount, stepsAfterCancel);
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}
