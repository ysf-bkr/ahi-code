import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { PermissionManager } from '@ahicode/core/core/permission/PermissionManager';
import { UserSettings } from '@ahicode/core/shared/types';

/**
 * Otonomi seviyesi ile onay motoru sözleşmesi.
 *
 * Kullanıcı şikâyeti: "Otonom seçili ama yine onay soruyor." Seviye artık
 * onay motorunu da şekillendirir; güvenlik sınırları ise her seviyede durur.
 */
const baseSettings = (autonomy: 'manual' | 'guided' | 'auto', autoApproveAll = false): UserSettings => ({
  selectedProvider: 'ollama',
  selectedModel: 'llama3.1',
  apiKeys: {},
  autonomy,
  autoApprove: {
    readFiles: autoApproveAll,
    writeFiles: autoApproveAll,
    executeCommands: autoApproveAll
  }
});

describe('PermissionManager: otonomi seviyesi onay motorunu şekillendirir', () => {
  it('Otonom: dosya yazma ve güvenli komut onay istemez', () => {
    const manager = new PermissionManager(baseSettings('auto'));
    assert.strictEqual(manager.requiresApproval('write_file', { path: 'src/a.ts', content: 'x' }), false);
    assert.strictEqual(manager.requiresApproval('edit_file', { path: 'src/a.ts' }), false);
    assert.strictEqual(manager.requiresApproval('execute_command', { command: 'npm test' }), false);
    assert.strictEqual(manager.requiresApproval('read_file', { path: 'src/a.ts' }), false);
    assert.strictEqual(manager.requiresApproval('invoke_subagent', { role: 'backend', task: 'x' }), false);
  });

  it('Otonom: riskli/bilinmeyen komut yine de onay ister', () => {
    const manager = new PermissionManager(baseSettings('auto'));
    // Ağ aracı: politika gereği riskli.
    assert.strictEqual(
      manager.requiresApproval('execute_command', { command: 'curl https://example.com/x' }),
      true
    );
    // Yıkıcı komut: engelli — hiçbir seviye otomatik geçemez.
    assert.strictEqual(manager.requiresApproval('execute_command', { command: 'rm -rf /' }), true);
  });

  it('Otonom: "always" araçları (ağ, bilgi yazımı) her seviyede sorar', () => {
    const manager = new PermissionManager(baseSettings('auto'));
    assert.strictEqual(manager.requiresApproval('web_search', { query: 'x' }), true);
    assert.strictEqual(manager.requiresApproval('add_knowledge_note', { note: 'x' }), true);
  });

  it('Yönlendirilmiş: yazma onayı her zaman sorulur, devretme sorulmaz', () => {
    const manager = new PermissionManager(baseSettings('guided', true));
    assert.strictEqual(
      manager.requiresApproval('write_file', { path: 'src/a.ts', content: 'x' }),
      true,
      'seviyenin sözü "yazma öncesi onay"'
    );
    assert.strictEqual(manager.requiresApproval('invoke_subagent', { role: 'backend', task: 'x' }), false);
    // Akış üst verisi yazma onayından muaf kalmaya devam eder.
    assert.strictEqual(
      manager.requiresApproval('write_spec', { goal: 'x', acceptanceCriteria: ['y'] }),
      false
    );
  });

  it('Elle: otomatik onay kapalıysa yazma ve komut sorulur (geriye dönük davranış)', () => {
    const manager = new PermissionManager(baseSettings('manual'));
    assert.strictEqual(manager.requiresApproval('write_file', { path: 'src/a.ts', content: 'x' }), true);
    assert.strictEqual(manager.requiresApproval('execute_command', { command: 'npm test' }), true);
    assert.strictEqual(manager.requiresApproval('invoke_subagent', { role: 'backend', task: 'x' }), true);
  });
});
