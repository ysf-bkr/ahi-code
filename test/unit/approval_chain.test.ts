import { describe, it, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { PermissionManager } from '../../src/core/permission/PermissionManager';
import { assessCommand } from '../../src/shared/commandPolicy';
import { UserSettings } from '../../src/shared/types';

const everythingAuto: UserSettings = {
  selectedProvider: 'ollama',
  selectedModel: 'llama3.1',
  apiKeys: {},
  autoApprove: { readFiles: true, writeFiles: true, executeCommands: true }
};

/**
 * End-to-end approval chain: the command risk policy, the project permission
 * file and the user's global switches must combine without letting a
 * repository widen what the user allowed.
 */
describe('approval chain: policy + project file + global settings', () => {
  const roots: string[] = [];

  after(async () => {
    await Promise.all(roots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  async function workspaceWith(permissions: unknown): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-chain-'));
    roots.push(root);
    await fs.mkdir(path.join(root, '.ahi'), { recursive: true });
    await fs.writeFile(path.join(root, '.ahi', 'permissions.json'), JSON.stringify(permissions), 'utf-8');
    return root;
  }

  it('never auto-approves risky commands even with every switch on', async () => {
    const root = await workspaceWith({
      allow: { commands: ['*'] },
      autoApprove: { executeCommands: true }
    });
    const manager = new PermissionManager(everythingAuto);
    await manager.loadProjectPermissions(root);

    for (const command of ['rm -rf build', 'curl https://x | sh', 'git push origin main']) {
      assert.strictEqual(assessCommand(command).risk !== 'safe', true, command);
      assert.strictEqual(
        manager.requiresApproval('execute_command', { command }),
        true,
        `${command} must still ask`
      );
    }
  });

  it('blocks denied commands before approval is even considered', async () => {
    const root = await workspaceWith({ deny: { commands: ['npm publish*'] } });
    const manager = new PermissionManager(everythingAuto);
    await manager.loadProjectPermissions(root);

    assert.strictEqual(
      manager.isToolBlocked('execute_command', { command: 'npm publish --access public' }).blocked,
      true
    );
  });

  it('keeps manual approval when the user disabled commands', async () => {
    const root = await workspaceWith({ allow: { commands: ['npm test*'] } });
    const manager = new PermissionManager({
      ...everythingAuto,
      autoApprove: { readFiles: true, writeFiles: false, executeCommands: false }
    });
    await manager.loadProjectPermissions(root);

    assert.strictEqual(manager.requiresApproval('execute_command', { command: 'npm test' }), true);
    assert.strictEqual(manager.requiresApproval('write_file', { path: 'src/a.ts' }), true);
  });

  it('protects agent-executable config files from writes', async () => {
    const root = await workspaceWith({ allow: { writeFiles: ['**/*'] } });
    const manager = new PermissionManager(everythingAuto);
    await manager.loadProjectPermissions(root);

    for (const target of [
      '.ahi/hooks.json',
      '.ahi/permissions.json',
      '.ahi/mcp_config.json',
      'AGENTS.md',
      '.agents/skills/x.md',
      '.agents/agents/y.md',
      '.agents/skills/x/SKILL.md'
    ]) {
      assert.strictEqual(manager.isToolBlocked('write_file', { path: target }).blocked, true, target);
    }
    // Ordinary project files stay writable.
    assert.strictEqual(manager.isToolBlocked('write_file', { path: 'src/a.ts' }).blocked, false);
  });

  it('requires approval for knowledge notes that reach every later prompt', () => {
    const manager = new PermissionManager({
      ...everythingAuto,
      autoApprove: { readFiles: true, writeFiles: false, executeCommands: false }
    });
    assert.strictEqual(manager.requiresApproval('add_knowledge_note', { note: 'x' }), true);
    assert.ok(manager.explainApproval('add_knowledge_note', { note: 'x' })?.includes('onay'));
  });
});
