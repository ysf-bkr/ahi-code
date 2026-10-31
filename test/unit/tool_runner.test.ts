import { describe, it, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { runToolCall } from '@ahicode/core/core/toolRunner';
import { PermissionManager } from '@ahicode/core/core/permission/PermissionManager';
import { SnapshotManager } from '@ahicode/core/core/snapshot/SnapshotManager';
import { TaskPlanner } from '@ahicode/core/core/plan/TaskPlanner';
import { ToolCall, ToolName, UserSettings } from '@ahicode/core/shared/types';

/**
 * VS Code'dan bağımsız araç yürütücüsü. CLI ve testler aynı kapı zincirini
 * kullanır: yetki → argüman → engel → onay → snapshot → çalıştır.
 */
const settings: UserSettings = {
  selectedProvider: 'ollama',
  selectedModel: 'llama3.1',
  apiKeys: {},
  autoApprove: { readFiles: true, writeFiles: false, executeCommands: false },
  autoVerify: false,
  useIntegratedTerminal: false
};

const roots: string[] = [];

async function workspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-runner-'));
  roots.push(root);
  await fs.mkdir(path.join(root, '.ahi'), { recursive: true });
  return root;
}

function call(name: ToolName, args: Record<string, unknown>): ToolCall {
  return { id: `call_${name}`, name, args, requiresApproval: false, status: 'pending' };
}

describe('runToolCall: gating chain', () => {
  // Her test kendi geçici dizinini temizler: `beforeEach` içinde listeyi
  // sıfırlamak önceki testlerin dizinlerini sızdırıyordu (proje dışı çöp).
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('rejects an unknown tool without throwing', async () => {
    const root = await workspace();
    const result = await runToolCall(call('nope' as ToolName, {}), {
      workspaceRoot: root,
      permissionManager: new PermissionManager(settings),
      snapshotManager: new SnapshotManager(),
      context: { workspaceRoot: root }
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.stoppedAt, 'unknown-tool');
  });

  it('enforces the allowed tool set', async () => {
    const root = await workspace();
    const result = await runToolCall(call('write_file', { path: 'a.ts', content: 'x' }), {
      workspaceRoot: root,
      permissionManager: new PermissionManager(settings),
      snapshotManager: new SnapshotManager(),
      context: { workspaceRoot: root },
      allowedTools: new Set<ToolName>(['read_file'])
    });
    assert.strictEqual(result.stoppedAt, 'disallowed');
  });

  it('rejects invalid arguments before execution', async () => {
    const root = await workspace();
    const result = await runToolCall(call('read_file', {}), {
      workspaceRoot: root,
      permissionManager: new PermissionManager(settings),
      snapshotManager: new SnapshotManager(),
      context: { workspaceRoot: root }
    });
    assert.strictEqual(result.stoppedAt, 'arguments');
  });

  it('blocks sensitive paths even when approvals are open', async () => {
    const root = await workspace();
    const result = await runToolCall(call('write_file', { path: '.env', content: 'SECRET=1' }), {
      workspaceRoot: root,
      permissionManager: new PermissionManager({
        ...settings,
        autoApprove: { readFiles: true, writeFiles: true, executeCommands: true }
      }),
      snapshotManager: new SnapshotManager(),
      context: { workspaceRoot: root }
    });
    assert.strictEqual(result.stoppedAt, 'blocked');
  });

  it('asks for approval and rejects when the user declines', async () => {
    const root = await workspace();
    let asked = 0;
    const result = await runToolCall(call('write_file', { path: 'src/a.ts', content: 'x' }), {
      workspaceRoot: root,
      permissionManager: new PermissionManager(settings),
      snapshotManager: new SnapshotManager(),
      context: { workspaceRoot: root },
      approve: async () => {
        asked++;
        return false;
      }
    });
    assert.strictEqual(asked, 1);
    assert.strictEqual(result.stoppedAt, 'rejected');
    await assert.rejects(() => fs.access(path.join(root, 'src/a.ts')));
  });

  it('writes the file when approved and makes it revertible', async () => {
    const root = await workspace();
    const snapshots = new SnapshotManager();
    const result = await runToolCall(
      call('write_file', { path: 'src/a.ts', content: 'export const a = 1;\n' }),
      {
        workspaceRoot: root,
        permissionManager: new PermissionManager(settings),
        snapshotManager: snapshots,
        context: { workspaceRoot: root },
        approve: async () => true
      }
    );

    assert.strictEqual(result.ok, true);
    assert.match(await fs.readFile(path.join(root, 'src/a.ts'), 'utf-8'), /export const a/);
    assert.strictEqual(snapshots.getSnapshots().length, 1, 'yazma öncesi snapshot alınmalı');
  });

  it('routes update_plan into the planner instead of the filesystem', async () => {
    const root = await workspace();
    const planner = new TaskPlanner();
    const result = await runToolCall(call('update_plan', { goal: 'hedef', steps: [{ title: 'Adım 1' }] }), {
      workspaceRoot: root,
      permissionManager: new PermissionManager(settings),
      snapshotManager: new SnapshotManager(),
      planner,
      context: { workspaceRoot: root }
    });

    assert.strictEqual(result.ok, true);
    assert.ok(planner.hasPlan());
    assert.match(result.output, /Task plan updated/);
  });

  it('reports tool errors as results, not exceptions', async () => {
    const root = await workspace();
    const result = await runToolCall(call('read_file', { path: 'missing.ts' }), {
      workspaceRoot: root,
      permissionManager: new PermissionManager(settings),
      snapshotManager: new SnapshotManager(),
      context: { workspaceRoot: root }
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.stoppedAt, 'error');
  });
});
