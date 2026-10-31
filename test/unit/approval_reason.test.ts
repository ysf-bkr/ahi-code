import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { PermissionManager } from '@ahicode/core/core/permission/PermissionManager';
import { UserSettings } from '@ahicode/core/shared/types';

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
    // Yazma onaylarını yeniden manuele daraltan bir proje dosyası.
    await manager.loadProjectPermissions(process.cwd(), true);

    const reason = manager.explainApproval('execute_command', { command: 'npm test' });
    // Deponun kendi permissions.json'u artık daraltmıyor; bu yüzden her şey
    // açıkken komut hiç onay gerektirmemeli.
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
      fs.readFileSync('packages/core/src/core/mcp/McpClient.ts', 'utf-8')
    );
    // İlk `npx -y <pkg>` çalışması paketi indirir; 15s yeterli olmadı.
    assert.match(source, /INITIALIZE_TIMEOUT_MS = 120_000/);
    assert.match(source, /INITIALIZE_TIMEOUT_MS\s*\);/);
    // Zaman aşımı mesajı artık olası nedeni açıklıyor.
    assert.match(source, /npx downloads the package on the first run/);
  });
});
