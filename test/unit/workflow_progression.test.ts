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
 * Aşama ilerlemesinin regresyon testleri.
 *
 * Bu senaryolar gerçek bir hatayı yakaladı: tur sonunda aşama `done`'a kadar
 * döngüyle ilerliyordu; inceleme ve doğrulama aynı turda sessizce atlanıyor ve
 * aşama `build`'e hiç geri dönmüyordu.
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

const settings: UserSettings = {
  selectedProvider: 'ollama',
  selectedModel: 'llama3.1',
  apiKeys: {},
  autoApprove: { readFiles: true, writeFiles: true, executeCommands: false },
  autoVerify: false,
  maxRepairAttempts: 0,
  useIntegratedTerminal: false,
  callGraph: { enabled: false }
};

const writeResponse: ModelCompletionResponse = {
  text: '',
  toolCalls: [
    { id: 'call_1', name: 'write_file', arguments: { path: 'a.ts', content: 'export const a = 1;\n' } }
  ]
};

const roots: string[] = [];

async function workspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-wf-'));
  roots.push(root);
  await fs.mkdir(path.join(root, '.ahi'), { recursive: true });
  return root;
}

/** Spec + plan onaylı, uygulama aşamasında bir ajan kurar. */
async function buildStageAgent(root: string, acceptanceCriteria: string[]) {
  const states: TaskState[] = [];
  const core = new AgentCore(
    stub.createExtensionContext() as never,
    settings,
    (state) => states.push(state),
    () => {},
    undefined,
    { provider: new ScriptedProvider([writeResponse, { text: 'done' }]) as never }
  );

  stub.testState.workspaceRoot = root;
  const spec = await core.getSpecStore().create(root, {
    goal: 'test',
    scope: ['src'],
    acceptanceCriteria
  });
  // Gerçek akışta spec onaylanınca SpecStore'da 'approved' olur.
  await core.getSpecStore().approve(root, spec.id);
  // Endüstriyel akış: plan bir modül haritasından türetilir.
  core.getState().modules = core.modulePlanner.update({
    goal: 'test',
    modules: [
      {
        id: 'core',
        name: 'Core',
        layer: 'application',
        paths: ['src'],
        responsibility: 'Çekirdek',
        ownerRole: 'backend'
      }
    ]
  });
  const plan = core.getTaskPlanner().update({
    goal: 'test',
    steps: [{ title: 'Adım 1', status: 'pending', moduleId: 'core' }]
  });
  core.getState().plan = plan;

  const workflow = core.getState().workflow!;
  workflow.stage = 'build';
  workflow.specId = spec.id;
  workflow.specApproved = true;
  workflow.planApproved = true;
  workflow.knowledgeReady = true;

  return { core, spec };
}

describe('AgentCore: aşama ilerlemesi', () => {
  beforeEach(() => {
    stub.resetTestState();
  });

  after(async () => {
    await Promise.all(roots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('tur sonunda yalnızca BİR sonraki aşamaya geçer', async () => {
    const root = await workspace();
    const { core } = await buildStageAgent(root, ['a']);

    await core.handleSendMessage('dosya oluştur');

    assert.strictEqual(
      core.getState().workflow?.stage,
      'review',
      'build aşamasından doğrudan verify/done’a atlanmamalı'
    );
  });

  it('doğrulama kapısı kapalıyken build aşamasına geri döner ve nedenini yazar', async () => {
    const root = await workspace();
    const { core, spec } = await buildStageAgent(root, ['a', 'b']);

    // Kriterler işaretlenmedi: "bitti" kapısı kapalı olmalı.
    assert.strictEqual(core.getSpecStore().isComplete(spec.id), false);

    core.getState().workflow!.stage = 'verify';
    await core.workflow.runVerifyStage(true);

    const workflow = core.getState().workflow!;
    assert.strictEqual(workflow.stage, 'build', 'kapı kapalıyken uygulamaya dönülmeli');
    assert.ok(
      workflow.blockedReason?.includes('kabul kriterleri'),
      `eksik kriter gerekçesi yazılmalı: ${workflow.blockedReason}`
    );
    // Hangi kriterlerin eksik olduğu somut olarak belirtilmeli.
    assert.ok(
      workflow.blockedReason?.includes('ac-'),
      `kriter kimliği belirtilmeli: ${workflow.blockedReason}`
    );
  });

  it('kriterler tamam ve doğrulama geçtiyse done’a ulaşır', async () => {
    const root = await workspace();
    const { core, spec } = await buildStageAgent(root, ['a']);

    for (const criterion of spec.acceptanceCriteria) {
      await core.getSpecStore().setCriterionDone(root, spec.id, criterion.id, true);
    }
    core.getState().stats.verification = { status: 'passed', attempts: 0, summary: 'ok' };

    core.getState().workflow!.stage = 'verify';
    const result = await core.setWorkflowStage('done');

    assert.strictEqual(result.ok, true, result.reason);
    assert.strictEqual(core.getState().workflow?.stage, 'done');
  });

  it('doğrulama geçmeden done kapısı açılmaz', async () => {
    const root = await workspace();
    const { core, spec } = await buildStageAgent(root, ['a']);

    for (const criterion of spec.acceptanceCriteria) {
      await core.getSpecStore().setCriterionDone(root, spec.id, criterion.id, true);
    }
    core.getState().stats.verification = { status: 'failed', attempts: 1, summary: 'fail' };

    core.getState().workflow!.stage = 'verify';
    const result = await core.setWorkflowStage('done');

    assert.strictEqual(result.ok, false);
    assert.ok(result.reason?.includes('Verification') || result.reason?.includes('doğrulama'));
  });

  it('test komutu bulunamadığı için atlanan doğrulama görevi kapatmaz', async () => {
    const root = await workspace();
    const { core, spec } = await buildStageAgent(root, ['a']);

    for (const criterion of spec.acceptanceCriteria) {
      await core.getSpecStore().setCriterionDone(root, spec.id, criterion.id, true);
    }
    // Projede test/lint komutu yok: doğrulama atlandı. Bu "geçti" sayılmamalı,
    // yoksa hiç test çalışmadan görev sessizce kapanır.
    core.getState().stats.verification = {
      status: 'skipped',
      attempts: 0,
      summary: 'no test command',
      skippedReason: 'no-commands'
    };

    core.getState().workflow!.stage = 'verify';
    const blocked = await core.setWorkflowStage('done');
    assert.strictEqual(blocked.ok, false, 'komut yokluğu bitti kapısını kapatmalı');
    assert.strictEqual(core.workflow.verificationPassed(), false);

    // Çalışma alanı hiç yoksa doğrulama imkânsızdır; bu tek istisna kabul edilir.
    core.getState().stats.verification = {
      status: 'skipped',
      attempts: 0,
      summary: 'no workspace',
      skippedReason: 'no-workspace'
    };
    assert.strictEqual(core.workflow.verificationPassed(), true);
  });
});

describe('modeTools: çağrı haritası her aşamada açık', () => {
  it('plan modu salt-okunur harita araçlarını içerir', async () => {
    const { PLAN_MODE_TOOLS, INTAKE_MODE_TOOLS } = await import('../../src/core/agent/modeTools');
    const tools = [
      'get_callers',
      'get_callees',
      'call_graph_impact',
      'find_related_code',
      'call_graph_status'
    ];

    for (const tool of tools) {
      assert.ok(PLAN_MODE_TOOLS.has(tool as never), `plan modunda eksik: ${tool}`);
      assert.ok(INTAKE_MODE_TOOLS.has(tool as never), `intake modunda eksik: ${tool}`);
    }
  });

  it('plan modu yazma ve komut araçlarını içermez', async () => {
    const { PLAN_MODE_TOOLS } = await import('../../src/core/agent/modeTools');
    for (const tool of ['write_file', 'edit_file', 'execute_command', 'git_commit']) {
      assert.strictEqual(PLAN_MODE_TOOLS.has(tool as never), false, tool);
    }
  });
});
