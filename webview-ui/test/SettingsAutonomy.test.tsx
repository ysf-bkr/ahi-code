import './setupDom';
import { afterEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

describe('SettingsView: otonomi seçimi', () => {
  it('üç seviyeyi de gösterir ve mevcut olanı işaretler', () => {
    render(<SettingsView settings={settings({ autonomy: 'guided' })} onBack={() => {}} />);

    assert.ok(screen.getByText('Elle'));
    assert.ok(screen.getByText('Yönlendirilmiş'));
    assert.ok(screen.getByText('Otonom'));

    const guided = screen.getByRole('button', { name: /Yönlendirilmiş/ });
    assert.equal(guided.getAttribute('aria-pressed'), 'true');

    const manual = screen.getByRole('button', { name: /Elle/ });
    assert.equal(manual.getAttribute('aria-pressed'), 'false');
  });

  it('seçim değiştiğinde otonomi güncellenir', () => {
    render(<SettingsView settings={settings()} onBack={() => {}} />);

    const auto = screen.getByRole('button', { name: /Otonom/ });
    fireEvent.click(auto);

    const updated = screen.getByRole('button', { name: /Otonom/ });
    assert.equal(updated.getAttribute('aria-pressed'), 'true');
  });

  it('güvenlik onaylarının otonomiden bağımsız olduğunu yazar', () => {
    render(<SettingsView settings={settings({ autonomy: 'auto' })} onBack={() => {}} />);

    assert.match(screen.getByText(/Otonomi yalnızca/).textContent ?? '', /Dosya yazma, komut çalıştırma/);
  });
});
