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

describe('SettingsView: bütçe ayarları', () => {
  it('token bütçesi ve otomatik devam sınırı alanlarını gösterir', () => {
    render(
      <SettingsView settings={settings({ maxTokensPerTask: 5000, maxContinuations: 7 })} onBack={() => {}} />
    );

    const token = screen.getByLabelText('Token bütçesi') as HTMLInputElement;
    const continuations = screen.getByLabelText('Otomatik devam sınırı') as HTMLInputElement;
    assert.equal(token.value, '5000');
    assert.equal(continuations.value, '7');
  });

  it('varsayılan değerleri gösterir (0 = sınırsız, 12 devam)', () => {
    render(<SettingsView settings={settings()} onBack={() => {}} />);

    assert.equal((screen.getByLabelText('Token bütçesi') as HTMLInputElement).value, '0');
    assert.equal((screen.getByLabelText('Otomatik devam sınırı') as HTMLInputElement).value, '12');
  });

  it('değer değişince form güncellenir', () => {
    render(<SettingsView settings={settings()} onBack={() => {}} />);

    fireEvent.change(screen.getByLabelText('Token bütçesi'), { target: { value: '8000' } });
    fireEvent.change(screen.getByLabelText('Otomatik devam sınırı'), { target: { value: '20' } });

    assert.equal((screen.getByLabelText('Token bütçesi') as HTMLInputElement).value, '8000');
    assert.equal((screen.getByLabelText('Otomatik devam sınırı') as HTMLInputElement).value, '20');
  });

  it('token bütçesi için sınırsız ipucunu gösterir', () => {
    render(<SettingsView settings={settings()} onBack={() => {}} />);

    assert.match(screen.getByText(/Görev başına toplam token sınırı/).textContent ?? '', /0 = sınırsız/);
  });
});
