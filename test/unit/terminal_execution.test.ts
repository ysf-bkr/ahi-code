import { describe, it, beforeEach, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { AgentCore } from '../../src/core/agent/AgentCore';
import { runInIntegratedTerminal } from '../../src/core/agent/terminalExecution';
import { ModelProvider } from '@ahicode/core/providers/base';
import { UserSettings } from '@ahicode/core/shared/types';

/**
 * Tümleşik terminal yürütücüsü.
 *
 * Bu dosya, `AgentCore.runInIntegratedTerminal` kendi kendini çağırdığı için
 * (sonsuz özyineleme) varsayılan ayarda her komutun düşmesini engelleyen
 * regresyon testini taşır. Testler gerçek kabuk entegrasyonuna ihtiyaç
 * duymaz: sahte terminal, entegrasyon yokken izlenen yolu doğrular.
 */

interface FakeTerminal {
  name: string;
  exitStatus: unknown;
  shellIntegration: unknown;
  sent: string[];
}

interface StubModule {
  testState: {
    trusted: boolean;
    workspaceRoot?: string;
    terminals: FakeTerminal[];
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
  useIntegratedTerminal: true,
  sandbox: { mode: 'none', image: 'node:20-bookworm', network: false }
};

const provider: ModelProvider = {
  id: 'scripted',
  name: 'Scripted',
  async sendMessage() {
    return { text: 'done' };
  }
};

const roots: string[] = [];

async function createWorkspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-terminal-'));
  roots.push(root);
  return root;
}

describe('Integrated terminal execution', () => {
  beforeEach(() => {
    stub.resetTestState();
  });

  after(async () => {
    await Promise.all(roots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('runs the command in a terminal even without shell integration', async () => {
    const root = await createWorkspace();

    const result = await runInIntegratedTerminal('echo hi', root, { terminalName: 'AhiCode' });

    const terminals = stub.testState.terminals;
    assert.strictEqual(terminals.length, 1);
    // Entegrasyon olmadığında cd öneki tek tırnakla taşınır: komut doğru
    // dizinde başlar ve yol metni kabuk enjeksiyonuna açık değildir (F02/F08).
    assert.deepStrictEqual(terminals[0]?.sent, [`cd '${root}' && echo hi`]);
    assert.match(result, /could not be captured/);
  });

  it('reuses an open terminal instead of opening a new one per command', async () => {
    const root = await createWorkspace();

    await runInIntegratedTerminal('echo one', root, { terminalName: 'AhiCode' });
    await runInIntegratedTerminal('echo two', root, { terminalName: 'AhiCode' });

    assert.strictEqual(stub.testState.terminals.length, 1);
    assert.deepStrictEqual(stub.testState.terminals[0]?.sent, [
      `cd '${root}' && echo one`,
      `cd '${root}' && echo two`
    ]);
  });

  it('opens a new terminal when the workspace root changes', async () => {
    const first = await createWorkspace();
    const second = await createWorkspace();

    await runInIntegratedTerminal('echo a', first, { terminalName: 'AhiCode' });
    await runInIntegratedTerminal('echo b', second, { terminalName: 'AhiCode' });

    // Farklı kök için terminal yeniden kullanılmaz: komut asla yanlış dizine
    // düşmez (F08).
    const terminals = stub.testState.terminals;
    assert.strictEqual(terminals.length, 2);
    assert.deepStrictEqual(terminals[0]?.sent, [`cd '${first}' && echo a`]);
    assert.deepStrictEqual(terminals[1]?.sent, [`cd '${second}' && echo b`]);
  });

  it('rejects a pre-aborted signal before touching the terminal', async () => {
    const root = await createWorkspace();
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      () =>
        runInIntegratedTerminal('echo nope', root, {
          terminalName: 'AhiCode',
          signal: controller.signal
        }),
      /cancelled by the user/
    );
    assert.strictEqual(stub.testState.terminals.length, 0);
  });

  it('escapes workspace paths containing shell metacharacters (F02)', async () => {
    // Adında komut enjeksiyonu içeren klasör: `$()` ve backtick tek tırnak
    // içinde etkisiz kalır.
    const root = await createWorkspace();
    const hostile = `${root}/workspace$(touch audit-marker)`;
    await fs.mkdir(hostile, { recursive: true });

    await runInIntegratedTerminal('echo hi', hostile, { terminalName: 'AhiCode' });

    const terminals = stub.testState.terminals;
    const sent = terminals[0]?.sent ?? [];
    assert.ok(sent.length === 1, 'tek bir satır gönderilmeli');
    assert.ok((sent[0] || '').startsWith("cd '"), 'yol tek tırnakla taşınmalı');
    assert.ok(!(sent[0] || '').includes(`"${hostile}"`), 'çift tırnaklı yol kullanılmamalı');
  });

  it('AgentCore delegates to the terminal runner instead of recursing', async () => {
    const root = await createWorkspace();
    stub.testState.workspaceRoot = root;
    const core = new AgentCore(
      stub.createExtensionContext() as never,
      settings,
      () => {},
      () => {},
      undefined,
      { provider }
    );

    // Özyineleme olsaydı bu çağrı RangeError ile düşerdi.
    const result = await core.runInIntegratedTerminal('echo delegated', root);

    const terminals = stub.testState.terminals;
    assert.strictEqual(terminals.length, 1);
    assert.deepStrictEqual(terminals[0]?.sent, [`cd '${root}' && echo delegated`]);
    assert.match(result, /could not be captured/);
  });
});
