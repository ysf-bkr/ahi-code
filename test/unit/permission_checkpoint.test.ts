import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { PermissionManager } from '../../src/core/permission/PermissionManager';
import { CheckpointManager } from '../../src/core/checkpoint/CheckpointManager';
import { ContextManager } from '../../src/core/context/ContextManager';
import { TaskState, UserSettings } from '../../src/shared/types';
import { ProviderMessage } from '../../src/providers/base';
import { SnapshotManager } from '../../src/core/snapshot/SnapshotManager';

const baseSettings: UserSettings = {
  selectedProvider: 'ollama',
  selectedModel: 'llama3.1',
  apiKeys: {},
  autoApprove: {
    readFiles: true,
    writeFiles: false,
    executeCommands: false
  }
};

function makeState(): TaskState {
  return {
    id: 'test_session',
    prompt: 'test',
    mode: 'code',
    status: 'running',
    messages: [
      { id: 'm1', role: 'user', content: 'ilk mesaj', timestamp: 1 },
      { id: 'm2', role: 'assistant', content: 'yanıt', timestamp: 2 }
    ],
    stats: { totalTokens: 10, stepsCount: 2, filesModified: ['src/a.ts'] }
  };
}

describe('PermissionManager: glob and permission priority', () => {
  let tmpDir: string;
  let manager: PermissionManager;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-perm-'));
    await fs.mkdir(path.join(tmpDir, '.ahi'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.ahi', 'permissions.json'),
      JSON.stringify({
        allow: {
          readFiles: ['src/**/*'],
          writeFiles: ['src/**/*'],
          commands: ['npm test*']
        },
        deny: {
          readFiles: ['secret/**/*'],
          writeFiles: ['**/*.pem'],
          commands: ['git push*']
        }
      }),
      'utf-8'
    );

    manager = new PermissionManager(baseSettings);
    await manager.loadProjectPermissions(tmpDir);
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('project allow list cannot widen the global manual write preference', () => {
    // Genel ayarlarda yazma manuel kalır; bu yüzden eşleşen bir `allow.writeFiles`
    // girdisi bile onay istemini kapatmamalı.
    assert.strictEqual(manager.requiresApproval('write_file', { path: 'src/index.ts' }), true);
  });

  it('**/*.pem deny rule blocks file in subfolder', () => {
    const res = manager.isToolBlocked('write_file', { path: 'certs/server.pem' });
    assert.strictEqual(res.blocked, true);
  });

  it('sensitive files are protected by default', () => {
    assert.strictEqual(manager.isToolBlocked('write_file', { path: '.env.local' }).blocked, true);
  });

  it('sensitive file protection ignores case', () => {
    for (const name of ['.ENV', '.Env.local', 'certs/SERVER.PEM', '.GIT/config']) {
      assert.strictEqual(manager.isToolBlocked('read_file', { path: name }).blocked, true, name);
      assert.strictEqual(manager.isToolBlocked('write_file', { path: name }).blocked, true, name);
    }
  });

  it('deny.readFiles blocks read tool', () => {
    const res = manager.isToolBlocked('read_file', { path: 'secret/keys.txt' });
    assert.strictEqual(res.blocked, true);
  });

  it('deny rules cannot be bypassed with ./ and absolute workspace path', () => {
    assert.strictEqual(manager.isToolBlocked('read_file', { path: './secret/keys.txt' }).blocked, true);
    assert.strictEqual(
      manager.isToolBlocked('read_file', { path: path.join(tmpDir, 'secret', 'keys.txt') }).blocked,
      true
    );
    assert.strictEqual(manager.isToolBlocked('write_file', { path: './.git/config' }).blocked, true);
    assert.strictEqual(manager.isToolBlocked('read_file', { path: '.env' }).blocked, true);
  });

  it('symlinks inside the workspace cannot bypass sensitive and deny rules (F03)', async () => {
    if (process.platform === 'win32') return; // symlink oluşturmak ayrıcalık ister

    // alias.txt -> .env ; linked-secret.txt -> secret/keys.txt ; pem-link.txt -> certs/server.pem
    await fs.writeFile(path.join(tmpDir, '.env'), 'FAKE_SECRET=1', 'utf-8');
    await fs.mkdir(path.join(tmpDir, 'secret'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'secret', 'keys.txt'), 'gizli', 'utf-8');
    await fs.mkdir(path.join(tmpDir, 'certs'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'certs', 'server.pem'), 'x', 'utf-8');
    await fs.symlink(path.join(tmpDir, '.env'), path.join(tmpDir, 'alias.txt'));
    await fs.symlink(path.join(tmpDir, 'secret', 'keys.txt'), path.join(tmpDir, 'linked-secret.txt'));
    await fs.symlink(path.join(tmpDir, 'certs', 'server.pem'), path.join(tmpDir, 'pem-link.txt'));

    // Okuma: doğrudan hedefle aynı karar.
    assert.strictEqual(manager.isToolBlocked('read_file', { path: 'alias.txt' }).blocked, true);
    assert.strictEqual(manager.isToolBlocked('read_file', { path: 'linked-secret.txt' }).blocked, true);
    // Yazma: hassas hedef (.env) ve deny kapsamındaki hedef (*.pem) symlink
    // üzerinden de engellenmeli.
    assert.strictEqual(manager.isToolBlocked('write_file', { path: 'alias.txt' }).blocked, true);
    assert.strictEqual(manager.isToolBlocked('write_file', { path: 'pem-link.txt' }).blocked, true);
    // Henüz var olmayan hedef: en yakın üst dizin kanonikleştirilir.
    assert.strictEqual(manager.isToolBlocked('read_file', { path: 'secret/yeni-olmayan.txt' }).blocked, true);
  });

  it('allow komut deseni master anahtar kapalıyken onayı kaldırmaz, deny komutu engeller', () => {
    assert.strictEqual(
      manager.requiresApproval('execute_command', { command: 'npm test -- --runInBand' }),
      true
    );
    assert.strictEqual(
      manager.isToolBlocked('execute_command', { command: 'git push origin main' }).blocked,
      true
    );
    // Eğik çizgi içeren komut argümanları doğru eşleşmeli (ör. git push origin/main)
    assert.strictEqual(
      manager.isToolBlocked('execute_command', { command: 'git push origin/main' }).blocked,
      true
    );
  });

  it('allow list narrows auto-approved commands when the master switch is on', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-project-narrow-'));
    try {
      const ahiDir = path.join(workspace, '.ahi');
      await fs.mkdir(ahiDir, { recursive: true });
      await fs.writeFile(
        path.join(ahiDir, 'permissions.json'),
        JSON.stringify({ allow: { writeFiles: ['src/**/*'], commands: ['npm test*'] } }),
        'utf-8'
      );

      const settingsManager = new PermissionManager({
        ...baseSettings,
        autoApprove: { readFiles: true, writeFiles: true, executeCommands: true }
      });
      await settingsManager.loadProjectPermissions(workspace);

      // Listed paths stay automatic; anything else asks again.
      assert.strictEqual(settingsManager.requiresApproval('write_file', { path: 'src/app.ts' }), false);
      assert.strictEqual(settingsManager.requiresApproval('write_file', { path: 'package.json' }), true);
      assert.strictEqual(settingsManager.requiresApproval('execute_command', { command: 'npm test' }), false);
      assert.strictEqual(
        settingsManager.requiresApproval('execute_command', { command: 'npm run lint' }),
        true
      );
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('allow pattern cannot be bypassed with command chaining', () => {
    assert.strictEqual(
      manager.requiresApproval('execute_command', { command: 'npm test; cat ~/.ssh/id_rsa' }),
      true
    );
  });

  it('global auto-approve preferences can be updated at runtime', () => {
    const settingsManager = new PermissionManager(baseSettings);
    assert.strictEqual(settingsManager.requiresApproval('write_file', { path: 'src/app.ts' }), true);

    settingsManager.updateSettings({
      ...baseSettings,
      autoApprove: {
        ...baseSettings.autoApprove,
        writeFiles: true,
        executeCommands: true
      }
    });

    assert.strictEqual(settingsManager.requiresApproval('write_file', { path: 'src/app.ts' }), false);
    assert.strictEqual(settingsManager.requiresApproval('execute_command', { command: 'npm test' }), false);
    assert.strictEqual(
      settingsManager.requiresApproval('execute_command', { command: 'npm test && echo done' }),
      false
    );
    assert.strictEqual(
      settingsManager.requiresApproval('execute_command', { command: 'npm test; rm -rf build' }),
      true
    );
  });

  it('project permission file can narrow global auto-approve', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-project-perm-'));
    try {
      const ahiDir = path.join(workspace, '.ahi');
      await fs.mkdir(ahiDir, { recursive: true });
      await fs.writeFile(
        path.join(ahiDir, 'permissions.json'),
        JSON.stringify({ autoApprove: { writeFiles: false } }),
        'utf-8'
      );

      const settingsManager = new PermissionManager({
        ...baseSettings,
        autoApprove: { ...baseSettings.autoApprove, writeFiles: true }
      });
      await settingsManager.loadProjectPermissions(workspace);

      assert.strictEqual(settingsManager.requiresApproval('write_file', { path: 'src/app.ts' }), true);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('project permission file cannot widen global auto-approve', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-project-widen-'));
    try {
      const ahiDir = path.join(workspace, '.ahi');
      await fs.mkdir(ahiDir, { recursive: true });
      await fs.writeFile(
        path.join(ahiDir, 'permissions.json'),
        JSON.stringify({ autoApprove: { writeFiles: true, executeCommands: true } }),
        'utf-8'
      );

      // Genel ayarlar yazma ve komutları manuel tutar.
      const settingsManager = new PermissionManager(baseSettings);
      await settingsManager.loadProjectPermissions(workspace);

      assert.strictEqual(settingsManager.requiresApproval('write_file', { path: 'src/app.ts' }), true);
      assert.strictEqual(settingsManager.requiresApproval('execute_command', { command: 'npm test' }), true);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('broad wildcard command patterns cannot be used for auto-approve', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-project-wildcard-'));
    try {
      const ahiDir = path.join(workspace, '.ahi');
      await fs.mkdir(ahiDir, { recursive: true });
      await fs.writeFile(
        path.join(ahiDir, 'permissions.json'),
        JSON.stringify({ allow: { commands: ['*'], writeFiles: ['**/*'] } }),
        'utf-8'
      );

      const settingsManager = new PermissionManager(baseSettings);
      await settingsManager.loadProjectPermissions(workspace);

      assert.strictEqual(
        settingsManager.requiresApproval('execute_command', { command: 'rm -rf build' }),
        true
      );
      assert.strictEqual(settingsManager.requiresApproval('write_file', { path: 'src/app.ts' }), true);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('untrusted workspace ignores project permissions', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-project-untrusted-'));
    try {
      const ahiDir = path.join(workspace, '.ahi');
      await fs.mkdir(ahiDir, { recursive: true });
      await fs.writeFile(
        path.join(ahiDir, 'permissions.json'),
        JSON.stringify({
          allow: { commands: ['npm test*'], writeFiles: ['src/**/*'] },
          autoApprove: { writeFiles: true, executeCommands: true }
        }),
        'utf-8'
      );

      const settingsManager = new PermissionManager(baseSettings);
      await settingsManager.loadProjectPermissions(workspace, false);

      assert.strictEqual(settingsManager.requiresApproval('execute_command', { command: 'npm test' }), true);
      assert.strictEqual(settingsManager.requiresApproval('write_file', { path: 'src/app.ts' }), true);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});

describe('CheckpointManager: snapshot binding and rewind order', () => {
  it('snapshot bound to checkpoint is called during rewind', async () => {
    const manager = new CheckpointManager();
    const state = makeState();

    const first = manager.createCheckpoint(state, 1);
    manager.addSnapshotToLatestCheckpoint('snap_1');

    state.messages.push({ id: 'm3', role: 'user', content: 'ikinci', timestamp: 3 });
    manager.createCheckpoint(state, 2);
    manager.addSnapshotToLatestCheckpoint('snap_2');

    const calls: string[] = [];
    const snapshotStub = {
      revertSnapshot: async (id: string) => {
        calls.push(id);
        return { success: true, message: 'ok', filePath: 'x' };
      }
    } as unknown as SnapshotManager;

    const res = await manager.rewindToCheckpoint(first.id, state, snapshotStub);
    assert.strictEqual(res.success, true);
    assert.deepStrictEqual(calls, ['snap_2', 'snap_1']);
    assert.strictEqual(state.messages.length, 2);
    assert.strictEqual(state.status, 'idle');
  });
});

describe('ContextManager: message order', () => {
  it('keeps a mid-conversation system message in place instead of hoisting it', () => {
    const manager = new ContextManager({ contextWindowTokens: 120 });
    const messages: ProviderMessage[] = [
      { role: 'system', content: 'main instructions' },
      { role: 'user', content: 'first question '.repeat(30) },
      { role: 'system', content: 'mid-conversation note' },
      { role: 'assistant', content: 'answer '.repeat(30) },
      { role: 'user', content: 'second question' }
    ];

    const pruned = manager.pruneMessages(messages);
    const firstSystem = pruned.findIndex((m) => m.role === 'system');
    const noteIndex = pruned.findIndex((m) => m.content === 'mid-conversation note');
    const lastUser = pruned.findIndex((m) => m.content === 'second question');

    assert.strictEqual(firstSystem, 0, 'the leading system prompt must stay first');
    assert.ok(noteIndex > 0, 'the mid-conversation system message must be kept');
    assert.ok(noteIndex < lastUser, 'the mid-conversation system message must keep its order');
  });
});

describe('ContextManager: tool call and result never break', () => {
  it('every tool message has matching assistant call even when context window shrinks', () => {
    const manager = new ContextManager({ contextWindowTokens: 300 });
    const messages: ProviderMessage[] = [{ role: 'system', content: 'sistem' }];

    for (let i = 0; i < 8; i++) {
      messages.push({ role: 'user', content: `soru ${i} `.repeat(40) });
      messages.push({
        role: 'assistant',
        content: `yanıt ${i}`,
        toolCalls: [{ id: `call_${i}`, name: 'read_file', arguments: { path: 'a.ts' } }]
      });
      messages.push({ role: 'tool', toolCallId: `call_${i}`, content: `sonuç ${i} `.repeat(80) });
    }

    const pruned = manager.pruneMessages(messages);

    for (let i = 0; i < pruned.length; i++) {
      const msg = pruned[i];
      if (!msg) continue;
      if (msg.role === 'tool') {
        const previous = pruned
          .slice(0, i)
          .reverse()
          .find((m) => m.role === 'assistant' && m.toolCalls?.some((tc) => tc.id === msg.toolCallId));
        assert.ok(previous, `Orphan tool message left: ${msg.toolCallId}`);
      }
    }
  });
});
