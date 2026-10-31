import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { PermissionManager } from '@ahicode/core/core/permission/PermissionManager';
import { UserSettings } from '@ahicode/core/shared/types';

/**
 * Akış üst verisi araçları (`write_spec`, `update_acceptance_criteria`)
 * yalnızca `.ahi/specs/` altına yazar. Yazma otomatik onayı kapalıyken bile
 * onay istememelidirler; aksi hâlde spec onay kartı hiç görünmez ve ajan
 * `write_spec` için 10 dakikalık onay zaman aşımını bekler (gerçek hata).
 */
const manualWriteSettings: UserSettings = {
  selectedProvider: 'ollama',
  selectedModel: 'llama3.1',
  apiKeys: {},
  autoApprove: { readFiles: true, writeFiles: false, executeCommands: false }
};

describe('PermissionManager: flow metadata approval', () => {
  it('does not ask approval for write_spec when write auto-approve is off', () => {
    const manager = new PermissionManager(manualWriteSettings);
    assert.strictEqual(
      manager.requiresApproval('write_spec', { goal: 'x', acceptanceCriteria: ['y'] }),
      false
    );
  });

  it('does not ask approval for update_acceptance_criteria', () => {
    const manager = new PermissionManager(manualWriteSettings);
    assert.strictEqual(manager.requiresApproval('update_acceptance_criteria', { updates: [] }), false);
  });

  it('still asks approval for real source writes', () => {
    const manager = new PermissionManager(manualWriteSettings);
    assert.strictEqual(manager.requiresApproval('write_file', { path: 'src/a.ts' }), true);
    assert.strictEqual(manager.requiresApproval('edit_file', { path: 'src/a.ts' }), true);
  });

  it('never auto-approves sensitive paths', () => {
    const manager = new PermissionManager({
      ...manualWriteSettings,
      autoApprove: { readFiles: true, writeFiles: true, executeCommands: true }
    });
    const blocked = manager.isToolBlocked('write_file', { path: '.env' });
    assert.strictEqual(blocked.blocked, true);
  });
});

describe('PermissionManager: delegation approval by autonomy', () => {
  it('asks approval for delegation in manual mode', () => {
    const manager = new PermissionManager(manualWriteSettings);
    assert.strictEqual(manager.requiresApproval('invoke_subagent', { role: 'backend', task: 'x' }), true);
    assert.strictEqual(manager.requiresApproval('run_parallel_tasks', { tasks: [] }), true);
  });

  it('lets delegation flow in guided and auto modes', () => {
    for (const autonomy of ['guided', 'auto'] as const) {
      const manager = new PermissionManager({ ...manualWriteSettings, autonomy });
      assert.strictEqual(
        manager.requiresApproval('invoke_subagent', { role: 'backend', task: 'x' }),
        false,
        `delegation must not stall ${autonomy} mode`
      );
      assert.strictEqual(manager.requiresApproval('run_parallel_tasks', { tasks: [] }), false);
    }
  });

  it('otonom seviye yazmayı ve güvenli komutu otomatikleştirir, ağ aracını değil', () => {
    // Sözleşme değişikliği (kullanıcı şikâyeti): "Otonom" seçiliyken rutin
    // dosya yazma ve güvenli komutlar artık onay istemez; uç ağ aracı her
    // seviyede sormaya devam eder. Ayrıntı: autonomy_permissions.test.ts
    const manager = new PermissionManager({ ...manualWriteSettings, autonomy: 'auto' });
    assert.strictEqual(manager.requiresApproval('write_file', { path: 'src/a.ts' }), false);
    assert.strictEqual(manager.requiresApproval('execute_command', { command: 'npm test' }), false);
    // Ağ araçları her modda onay ister.
    assert.strictEqual(manager.requiresApproval('web_fetch', { url: 'https://x' }), true);
  });

  it('explains delegation approval instead of calling it always-manual', () => {
    const manager = new PermissionManager(manualWriteSettings);
    const reason = manager.explainApproval('invoke_subagent', { role: 'backend', task: 'x' });
    assert.match(String(reason), /otonomi açıkken akışı durdurmaz/);
  });
});
