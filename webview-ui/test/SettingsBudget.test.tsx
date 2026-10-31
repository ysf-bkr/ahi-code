import './setupDom';
import { afterEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { cleanup, render, screen } from '@testing-library/react';
import { SettingsView } from '../src/components/SettingsView';
import type { UserSettings } from '@shared/types';

afterEach(() => cleanup());

const settings = (overrides: Partial<UserSettings> = {}): UserSettings => ({
  selectedProvider: 'ollama',
  selectedModel: 'llama3.1',
  apiKeys: {},
  autoApprove: { readFiles: true, writeFiles: false, executeCommands: false },
  autoVerify: true,
  autonomy: 'manual',
  ...overrides
});

describe('SettingsView: sadeleştirilmiş davranış ayarları', () => {
  it('kaldırılan bütçe/sınır alanlarını artık göstermez', () => {
    render(
      <SettingsView settings={settings({ maxTokensPerTask: 5000, maxContinuations: 7 })} onBack={() => {}} />
    );

    assert.equal(screen.queryByLabelText('Token bütçesi'), null);
    assert.equal(screen.queryByLabelText('Otomatik devam sınırı'), null);
    assert.equal(screen.queryByLabelText('Onarım denemesi'), null);
    assert.equal(screen.queryByLabelText('Adım sınırı'), null);
  });

  it('model yönlendirme ve EVREN ajan hazır ayarı açıklamasını gösterir', () => {
    render(<SettingsView settings={settings()} onBack={() => {}} />);

    assert.ok(screen.getByText('Model yönlendirme'));
    assert.match(screen.getByText(/GLM-5.3/).textContent ?? '', /MiMo-V2.6-Pro/);
  });

  it('otomatik doğrulama ve istem önbellekleme anahtarlarını gösterir', () => {
    render(<SettingsView settings={settings()} onBack={() => {}} />);

    assert.ok(screen.getByText('Otomatik doğrulama'));
    assert.match(screen.getByText(/İstem önbellekleme/).textContent ?? '', /Prompt caching/);
  });
});
