import { describe, it, beforeEach, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { createSharedServices } from '../../src/core/agent/AgentCore';
import { SessionRegistry } from '../../src/core/agent/SessionRegistry';
import { UserSettings } from '../../src/shared/types';

/**
 * Arka plan oturumları sözleşmesi.
 *
 * Kullanıcı başka bir sohbete geçtiğinde ya da yeni sohbet açtığında önceki
 * tur durmamalı: her sohbet kendi çekirdeğinde çalışır. Bu testler o davranışı
 * kilitler; aksi halde "sohbet değiştirince iş kesiliyor" hatası geri döner.
 */
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
  autoApprove: { readFiles: true, writeFiles: false, executeCommands: false },
  autoVerify: false,
  maxRepairAttempts: 0,
  useIntegratedTerminal: false,
  sandbox: { mode: 'none', image: 'node:20-bookworm', network: false }
};

const roots: string[] = [];

async function workspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-sessions-'));
  roots.push(root);
  await fs.mkdir(path.join(root, '.ahi'), { recursive: true });
  return root;
}

/** Test için kayıt defteri + paylaşılan servisler. */
function setup(root: string) {
  const context = stub.createExtensionContext() as never;
  stub.testState.workspaceRoot = root;
  const shared = createSharedServices(context, () => settings);
  const registry = new SessionRegistry({
    context,
    settings: () => settings,
    shared,
    onStateUpdate: () => {},
    onNotify: () => {},
    onStreamChunk: () => {}
  });
  return { registry, shared };
}

describe('SessionRegistry: arka planda çalışan oturumlar', () => {
  beforeEach(() => {
    stub.resetTestState();
  });

  after(async () => {
    await Promise.all(roots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('yeni sohbet açmak önceki oturumun çekirdeğini kapatmaz', async () => {
    const root = await workspace();
    const { registry } = setup(root);

    registry.openNewSession();
    const firstKey = registry.active as string;

    registry.openNewSession();
    const secondKey = registry.active as string;

    assert.notStrictEqual(secondKey, firstKey, 'yeni sohbet etkin olmalı');
    assert.ok(registry.getCore(firstKey), 'önceki oturum bellekte kalmalı');
    assert.ok(registry.getCore(secondKey));
    assert.strictEqual(registry.snapshots().length, 2, 'iki oturum birlikte yaşamalı');
  });

  it('geçmişten bir oturuma dönmek aynı çekirdeği yeniden kullanır', async () => {
    const root = await workspace();
    const { registry, shared } = setup(root);

    const first = registry.openNewSession();
    const firstKey = registry.active as string;
    const sessionId = 'session_background_1';

    // İlk mesajdan sonra oturum kalıcı kimliğini alır.
    first.state = { ...first.getState(), id: sessionId, prompt: 'ilk görev' };
    await shared.historyManager.saveTask(first.getState());

    registry.openNewSession();
    assert.notStrictEqual(registry.active, firstKey, 'yeni sohbet etkin olmalı');

    const reopened = registry.activate(sessionId);

    assert.ok(reopened, 'geçmişteki oturum açılmalı');
    assert.strictEqual(reopened, first, 'bellekteki çekirdek yeniden kullanılmalı');
    assert.strictEqual(registry.active, firstKey, 'etkin oturum ilk sohbete dönmeli');
  });

  it('bellekte olmayan oturum geçmişten yüklenir', async () => {
    const root = await workspace();
    const { registry, shared } = setup(root);

    const sessionId = 'session_only_in_history';
    await shared.historyManager.saveTask({
      id: sessionId,
      prompt: 'eski görev',
      mode: 'code',
      status: 'completed',
      messages: [
        { id: 'm1', role: 'user', content: 'eski görev', timestamp: 1 },
        { id: 'm2', role: 'assistant', content: 'bitti', timestamp: 2 }
      ],
      stats: { totalTokens: 0, stepsCount: 0, filesModified: [] }
    });

    const core = registry.activate(sessionId);

    assert.ok(core, 'geçmişten yüklenmeli');
    assert.strictEqual(core?.getState().id, sessionId);
    assert.strictEqual(core?.getState().messages.length, 2);
  });

  it('etkin oturumu kapatmak diğer oturumları kapatmaz', async () => {
    const root = await workspace();
    const { registry } = setup(root);

    registry.openNewSession();
    const firstKey = registry.active as string;
    registry.openNewSession();
    const secondKey = registry.active as string;

    await registry.close(secondKey);

    assert.strictEqual(registry.getCore(secondKey), undefined, 'kapatılan çekirdek gider');
    assert.ok(registry.getCore(firstKey), 'diğer oturum kapanmamalı');
  });

  it('paylaşılan MCP/LSP servislerinin ömrü çekirdeğe değil kayıt defterine bağlıdır', async () => {
    const root = await workspace();
    const { registry } = setup(root);

    const first = registry.openNewSession();
    const second = registry.openNewSession();

    // İki çekirdek de paylaşılan servisleri kullanır; hiçbiri tek başına
    // MCP sunucularını durdurmamalı.
    assert.strictEqual(first.ownsSharedServices, false);
    assert.strictEqual(second.ownsSharedServices, false);
  });

  it('tüm oturumlar kapatıldığında kayıt defteri boşalır', async () => {
    const root = await workspace();
    const { registry } = setup(root);

    registry.openNewSession();
    registry.openNewSession();
    registry.disposeAll();

    assert.strictEqual(registry.snapshots().length, 0);
    assert.strictEqual(registry.active, undefined);
  });
});
