import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { PermissionManager } from '../../src/core/permission/PermissionManager';
import { UserSettings } from '../../src/shared/types';

function settings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    selectedProvider: 'ollama',
    selectedModel: 'llama3.1',
    apiKeys: {},
    autoApprove: { readFiles: true, writeFiles: false, executeCommands: false },
    ...overrides
  };
}

describe('PermissionManager.explainApproval: approval reason visible', () => {
  it('no reason when no approval needed', () => {
    const manager = new PermissionManager(settings());
    assert.strictEqual(manager.explainApproval('read_file', { path: 'src/a.ts' }), undefined);
  });

  it('says so when write approval is off in settings', () => {
    const manager = new PermissionManager(settings());
    assert.match(
      manager.explainApproval('write_file', { path: 'src/a.ts' }) ?? '',
      /Dosya yazma\/düzenleme.*kapalı/
    );
  });

  it('gives reason when project file narrows even if global is open', async () => {
    const manager = new PermissionManager(
      settings({ autoApprove: { readFiles: true, writeFiles: true, executeCommands: true } })
    );
    // A project file that narrows write approvals back to manual.
    await manager.loadProjectPermissions(process.cwd(), true);

    const reason = manager.explainApproval('execute_command', { command: 'npm test' });
    // The repo's own permissions.json no longer narrows, so with everything
    // enabled the command must not require approval at all.
    assert.strictEqual(
      manager.requiresApproval('execute_command', { command: 'npm test' }),
      false,
      'project file should no longer narrow'
    );
    assert.strictEqual(reason, undefined);
  });

  it('always gives approval reason for risky commands', () => {
    const manager = new PermissionManager(
      settings({ autoApprove: { readFiles: true, writeFiles: true, executeCommands: true } })
    );
    assert.match(
      manager.explainApproval('execute_command', { command: 'rm -rf build' }) ?? '',
      /Riskli komutlar.*her zaman/
    );
  });

  it('gives design reason for web tools', () => {
    const manager = new PermissionManager(
      settings({ autoApprove: { readFiles: true, writeFiles: true, executeCommands: true } })
    );
    assert.match(manager.explainApproval('web_fetch', { url: 'https://x.test' }) ?? '', /her zaman/);
  });
});

describe('MCP initialize timeout', () => {
  it('uses long initialize timeout constant', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync('src/core/mcp/McpClient.ts', 'utf-8')
    );
    // The first `npx -y <pkg>` run downloads the package; 15s was not enough.
    assert.match(source, /INITIALIZE_TIMEOUT_MS = 120_000/);
    assert.match(source, /INITIALIZE_TIMEOUT_MS\s*\);/);
    // The timeout message now explains the likely cause.
    assert.match(source, /npx downloads the package on the first run/);
  });
});
