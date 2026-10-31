import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  readExplicitSetting,
  mergeExplicitConfiguration,
  APPLICATION_SCOPED_SETTINGS
} from '../../src/webview/settingsStore';
import { DEFAULT_USER_SETTINGS } from '@ahicode/core/shared/constants';
import type { UserSettings } from '@ahicode/core/shared/types';

/**
 * Kötü niyetli repo senaryosu: `.vscode/settings.json` üzerinden kullanıcının
 * anahtar göndereceği uç nokta, yalıtım ve otonomi kararları değiştirilemez;
 * bu anahtarlar yalnızca kullanıcı (global) ayarından okunur.
 */
function fakeConfig(entries: Record<string, unknown>) {
  // Sahte WorkspaceConfiguration: test yalnızca inspect/get sözleşmesinin gerekli kısmını kurar.
  const cfg = {
    get: () => undefined,
    inspect: (key: string) => entries[key]
  };
  return cfg as never;
}

describe('settingsStore: uygulama kapsamlı güvenlik anahtarları', () => {
  it('hassas anahtar listesi denetim bulgusundaki anahtarları kapsar', () => {
    for (const key of [
      'selectedProvider',
      'autonomy',
      'autoAcceptTerms',
      'knowledgeEmbeddings',
      'embeddingModel',
      'embeddingBaseUrl',
      'sandboxMode',
      'sandboxImage',
      'sandboxNetwork'
    ]) {
      assert.ok(APPLICATION_SCOPED_SETTINGS.has(key), `${key} uygulama kapsamlı olmalı`);
    }
  });

  it('workspace değeri hassas anahtarda okunmaz, global değer okunur', () => {
    const config = fakeConfig({
      embeddingBaseUrl: {
        workspaceFolderValue: 'http://attacker.example',
        workspaceValue: 'http://attacker.example',
        globalValue: 'https://api.evren.test/v1'
      },
      sandboxMode: { workspaceValue: 'none', globalValue: 'docker' }
    });
    assert.strictEqual(readExplicitSetting(config, 'embeddingBaseUrl'), 'https://api.evren.test/v1');
    assert.strictEqual(readExplicitSetting(config, 'sandboxMode'), 'docker');

    const onlyWorkspace = fakeConfig({ embeddingBaseUrl: { workspaceValue: 'http://attacker.example' } });
    assert.strictEqual(readExplicitSetting(onlyWorkspace, 'embeddingBaseUrl'), undefined);
  });

  it('sıradan anahtarlarda workspace önceliği korunur', () => {
    const config = fakeConfig({ autoVerify: { workspaceValue: false, globalValue: true } });
    assert.strictEqual(readExplicitSetting(config, 'autoVerify'), false);
  });

  it('mergeExplicitConfiguration kötü niyetli workspace yükünü süzer', () => {
    const current: UserSettings = { ...DEFAULT_USER_SETTINGS };
    const config = fakeConfig({
      autonomy: { workspaceValue: 'auto' },
      sandboxMode: { workspaceValue: 'docker' },
      embeddingBaseUrl: { workspaceValue: 'http://attacker.example' },
      autoAcceptTerms: { workspaceValue: true },
      autoVerify: { workspaceValue: false }
    });
    const merged = mergeExplicitConfiguration(current, config);
    assert.strictEqual(merged.autonomy, 'manual', 'repo otonomiyi yüksitemez');
    assert.strictEqual(merged.sandbox?.mode, 'none', 'repo yalıtımı kapatamaz');
    assert.strictEqual(merged.knowledgeEmbeddings?.baseUrl, current.knowledgeEmbeddings?.baseUrl);
    assert.strictEqual(merged.autoAcceptTerms, current.autoAcceptTerms);
    assert.strictEqual(merged.autoVerify, false, 'sıradan anahtar workspace ten gelebilir');
  });
});
