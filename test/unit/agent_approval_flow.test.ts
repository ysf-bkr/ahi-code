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
 * Scripted model: returns the queued responses in order and records what the
 * agent loop sent, so the approval/cancel flow can be asserted end to end.
 */
class ScriptedProvider implements ModelProvider {
  public readonly id = 'scripted';
  public readonly name = 'Scripted';
  public readonly requests: ProviderMessage[][] = [];
  private index = 0;

  constructor(
    private readonly responses: ModelCompletionResponse[],
    private readonly onRequest?: (index: number) => void
  ) {}

  async sendMessage(messages: ProviderMessage[]): Promise<ModelCompletionResponse> {
    this.requests.push(messages);
    this.onRequest?.(this.index);
    const response = this.responses[this.index] ?? { text: 'done' };
    this.index++;
    return response;
  }
}

interface StubModule {
  testState: {
    trusted: boolean;
    workspaceRoot?: string;
    warningAnswers: string[];
    infoMessages: string[];
    errorMessages: string[];
  };
  resetTestState(): void;
  createExtensionContext(): unknown;
}

const stub = vscode as unknown as StubModule;

const settings: UserSettings = {
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

/** Waits for a predicate on the emitted state, with a hard timeout. */
async function waitForState(
  states: TaskState[],
  predicate: (state: TaskState) => boolean,
  timeoutMs = 5_000
): Promise<TaskState> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const match = states.filter(predicate).at(-1);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `Timed out waiting for state. Last statuses: ${states
      .slice(-5)
      .map((state) => state.status)
      .join(', ')}`
  );
}

async function createWorkspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-agent-'));
  roots.push(root);
  await fs.mkdir(path.join(root, '.ahi'), { recursive: true });
  return root;
}

/** Puts the session past the spec/plan gates so mutating tools are offered. */
function enterBuildStage(core: AgentCore): void {
  const workflow = core.getState().workflow;
  if (!workflow) return;
  workflow.stage = 'build';
  workflow.specApproved = true;
  workflow.planApproved = true;
  workflow.knowledgeReady = true;
  workflow.updatedAt = Date.now();
}

function createAgent(provider: ModelProvider, workspaceRoot: string) {
  const states: TaskState[] = [];
  const notifications: string[] = [];
  const core = new AgentCore(
    stub.createExtensionContext() as never,
    settings,
    (state) => states.push(state),
    (notification) => notifications.push(notification.message),
    undefined,
    { provider }
  );
  stub.testState.workspaceRoot = workspaceRoot;
  return { core, states, notifications };
}

const writeToolCall: ModelCompletionResponse = {
  text: '',
  toolCalls: [
    {
      id: 'call_write_1',
      name: 'write_file',
      arguments: { path: 'src/created.ts', content: 'export const x = 1;\n' }
    }
  ]
};

describe('AgentCore: approval and cancellation', () => {
  beforeEach(() => {
    stub.resetTestState();
  });

  after(async () => {
    await Promise.all(roots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('pauses for approval before writing and writes only after approval', async () => {
    const root = await createWorkspace();
    const provider = new ScriptedProvider([writeToolCall, { text: 'Wrote the file.' }]);
    const { core, states } = createAgent(provider, root);
    enterBuildStage(core);

    const run = core.handleSendMessage('create src/created.ts');
    const pending = await waitForState(states, (state) => state.status === 'waiting_approval');

    assert.strictEqual(pending.pendingToolCall?.name, 'write_file');
    assert.ok(pending.pendingToolCall?.approvalReason, 'the UI must explain why approval is needed');
    // Nothing is written before the user answers.
    await assert.rejects(() => fs.access(path.join(root, 'src', 'created.ts')));

    await core.approveTool(pending.pendingToolCall?.id ?? '');
    await run;

    const content = await fs.readFile(path.join(root, 'src', 'created.ts'), 'utf-8');
    assert.strictEqual(content, 'export const x = 1;\n');
    assert.strictEqual(core.getState().status, 'completed');
  });

  it('does not write when the approval is rejected', async () => {
    const root = await createWorkspace();
    const provider = new ScriptedProvider([writeToolCall, { text: 'Understood, no changes.' }]);
    const { core, states } = createAgent(provider, root);
    enterBuildStage(core);

    const run = core.handleSendMessage('create src/created.ts');
    const pending = await waitForState(states, (state) => state.status === 'waiting_approval');
    await core.rejectTool(pending.pendingToolCall?.id ?? '', 'not now');
    await run;

    await assert.rejects(() => fs.access(path.join(root, 'src', 'created.ts')));
    const rejected = core.getState().messages.flatMap((message) => message.toolCalls ?? []);
    assert.strictEqual(rejected.at(-1)?.status, 'rejected');
  });

  it('cancelling while an approval is pending stops the turn', async () => {
    const root = await createWorkspace();
    const provider = new ScriptedProvider([writeToolCall, { text: 'should never run' }]);
    const { core, states } = createAgent(provider, root);
    enterBuildStage(core);

    const run = core.handleSendMessage('create src/created.ts');
    await waitForState(states, (state) => state.status === 'waiting_approval');

    await core.cancelTask();
    await run;

    assert.strictEqual(core.getState().status, 'cancelled');
    await assert.rejects(() => fs.access(path.join(root, 'src', 'created.ts')));
  });

  it('plan mode never offers a write tool for approval', async () => {
    const root = await createWorkspace();
    const provider = new ScriptedProvider([writeToolCall, { text: 'Plan only.' }]);
    const { core, states } = createAgent(provider, root);

    await core.handleSendMessage('plan the change', 'plan');
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.ok(
      !states.some((state) => state.status === 'waiting_approval'),
      'plan mode must not reach the approval gate for a write tool'
    );
    await assert.rejects(() => fs.access(path.join(root, 'src', 'created.ts')));

    const offeredTools = provider.requests[0] ?? [];
    const systemPrompt = offeredTools.find((message) => message.role === 'system')?.content ?? '';
    assert.ok(systemPrompt.length > 0, 'the agent must send a system prompt');
  });

  it('blocks a tool call that the model hallucinated for a locked stage', async () => {
    const root = await createWorkspace();
    const provider = new ScriptedProvider([
      {
        text: '',
        toolCalls: [{ id: 'call_cmd_1', name: 'execute_command', arguments: { command: 'touch hacked.txt' } }]
      },
      { text: 'Stopped.' }
    ]);
    const { core } = createAgent(provider, root);

    await core.handleSendMessage('run a command', 'plan');
    await new Promise((resolve) => setTimeout(resolve, 50));

    await assert.rejects(() => fs.access(path.join(root, 'hacked.txt')));
    const toolCalls = core.getState().messages.flatMap((message) => message.toolCalls ?? []);
    const commandCall = toolCalls.find((call) => call.name === 'execute_command');
    assert.ok(commandCall, 'the attempted call should be recorded');
    assert.strictEqual(commandCall?.status, 'error');
    assert.ok(commandCall?.error?.includes('not allowed'), commandCall?.error);
  });
});
