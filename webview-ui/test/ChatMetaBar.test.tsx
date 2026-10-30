import './setupDom';
import { afterEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChatMetaBar, dailyUsagePercent, formatTokens } from '../src/components/ChatMetaBar';
import { groupMessages, summarizeTurn } from '../src/components/MessageList';
import type { ChatMessage, EvrenQuota, UserSettings } from '@shared/types';

afterEach(() => cleanup());

const settings = (overrides: Partial<UserSettings> = {}): UserSettings => ({
  selectedProvider: 'evren',
  selectedModel: 'auto',
  apiKeys: {},
  autoApprove: { readFiles: true, writeFiles: false, executeCommands: false },
  ...overrides
});

const quota = (overrides: Partial<EvrenQuota> = {}): EvrenQuota => ({
  usedTokens: 100,
  windowCap: 1000,
  windowMinutes: 5,
  resetAt: null,
  dailyUsedTokens: 11_188_415,
  dailyLimitTokens: 15_000_000,
  dailyRemainingTokens: 3_811_585,
  dailyResetAt: null,
  level: 'warn',
  remainingCredits: '0',
  concurrentRequests: 0,
  concurrencyLimit: 32,
  ...overrides
});

describe('ChatMetaBar: model seçimi ve EVREN kotası', () => {
  it('token sayılarını kısa biçimde yazar', () => {
    assert.equal(formatTokens(15_000_000), '15M');
    assert.equal(formatTokens(11_188_415), '11.2M');
    assert.equal(formatTokens(3_811_585), '3.8M');
    assert.equal(formatTokens(950), '950');
    assert.equal(formatTokens(null), '—');
  });

  it('günlük kullanım yüzdesini hesaplar ve sınırı aşan değeri kırpar', () => {
    assert.equal(dailyUsagePercent(quota()), 75);
    assert.equal(dailyUsagePercent(quota({ dailyUsedTokens: 30_000_000 })), 100);
    assert.equal(dailyUsagePercent(quota({ dailyLimitTokens: null })), null);
  });

  it('model seçimini ve günlük kotayı gösterir', () => {
    const changes: string[] = [];
    render(
      <ChatMetaBar
        settings={settings()}
        models={['auto', 'evren-large']}
        quota={quota()}
        onRefreshQuota={() => {}}
        onModelChange={(model) => changes.push(model)}
      />
    );

    assert.match(screen.getByText(/Günlük %75/).textContent ?? '', /11\.2M\/15M/);

    const select = screen.getByLabelText('Model seçimi') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'evren-large' } });
    assert.deepStrictEqual(changes, ['evren-large']);
  });

  it('EVREN dışındaki sağlayıcılarda kota satırı göstermez', () => {
    render(
      <ChatMetaBar
        settings={settings({ selectedProvider: 'ollama', selectedModel: 'llama3.1' })}
        models={['llama3.1']}
        onRefreshQuota={() => {}}
        onModelChange={() => {}}
      />
    );

    assert.equal(screen.queryByText(/Günlük %/), null);
    assert.ok(screen.getByText('Ollama'));
  });
});

describe('MessageList: tur gruplama', () => {
  const message = (overrides: Partial<ChatMessage>): ChatMessage => ({
    id: 'm1',
    role: 'assistant',
    content: '',
    timestamp: 1,
    ...overrides
  });

  it('aynı turn kimliğine sahip adımları tek turda toplar', () => {
    const turns = groupMessages([
      message({ id: 'u1', role: 'user', content: 'görev', turnId: 't1' }),
      message({ id: 'a1', content: 'adım 1', turnId: 't1' }),
      message({ id: 'a2', content: 'adım 2', turnId: 't1' }),
      message({ id: 'u2', role: 'user', content: 'yeni görev', turnId: 't2' }),
      message({ id: 'a3', content: 'yanıt', turnId: 't2' })
    ]);

    assert.equal(turns.length, 2);
    assert.equal(turns[0].assistant.length, 2);
    assert.equal(turns[1].user?.content, 'yeni görev');
  });

  it('turn kimliği olmayan eski kayıtlarda kullanıcı mesajını sınır kabul eder', () => {
    const turns = groupMessages([
      message({ id: 'u1', role: 'user', content: 'eski görev' }),
      message({ id: 'a1', content: 'yanıt 1' }),
      message({ id: 'u2', role: 'user', content: 'ikinci görev' }),
      message({ id: 'a2', content: 'yanıt 2' })
    ]);

    assert.equal(turns.length, 2);
    assert.equal(turns[0].assistant.length, 1);
    assert.equal(turns[1].assistant.length, 1);
  });

  it('başlık özetini yanıt metninden üretir', () => {
    const [turn] = groupMessages([
      message({ id: 'u1', role: 'user', content: 'görev', turnId: 't1' }),
      message({ id: 'a1', content: '## Rapor\n\nProje **temiz** görünüyor.', turnId: 't1' })
    ]);

    const summary = summarizeTurn(turn);
    assert.match(summary, /Rapor/);
    assert.match(summary, /temiz/);
    assert.equal(summary.includes('#'), false);
  });
});
