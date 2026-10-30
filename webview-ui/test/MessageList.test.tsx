import './setupDom';
import { afterEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessageList } from '../src/components/MessageList';
import { vscode } from '../src/utils/vscode';
import type { ChatMessage, CheckpointSummary } from '@shared/types';

const originalPostMessage = vscode.postMessage;

afterEach(() => {
  cleanup();
  vscode.postMessage = originalPostMessage;
});

const userMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'u1',
  role: 'user',
  content: 'Projeyi incele ve raporla',
  timestamp: Date.parse('2026-10-26T10:30:00'),
  ...overrides
});

const checkpoints = (timestamp: number): CheckpointSummary[] => [
  { id: 'cp_old', turnIndex: 0, timestamp: timestamp - 999_999, preview: 'eski mesaj' },
  { id: 'cp_match', turnIndex: 1, timestamp: timestamp + 50, preview: 'Projeyi incele ve raporla' },
  { id: 'cp_later', turnIndex: 2, timestamp: timestamp + 60_000, preview: 'Projeyi incele ve raporla' }
];

describe('MessageList: kullanıcı mesajı eylemleri', () => {
  it('balonun altında zaman damgası ve eylem düğmeleri vardır', () => {
    render(<MessageList messages={[userMessage()]} />);
    const text = screen.getByText('10:30');
    assert.ok(text, 'zaman damgası balonun altında olmalı');

    assert.ok(screen.getByRole('button', { name: 'Mesajı kopyala' }));
    // Düzenleme eylemi yalnızca host bir düzenleyici geri çağrısı verdiğinde görünür.
    assert.equal(screen.queryByRole('button', { name: 'Mesajı düzenle ve yeniden gönder' }), null);
    // Eşleşen checkpoint iletilmedi: geri alma düğmesi yok.
    assert.equal(screen.queryByRole('button', { name: /Bu mesajdan sonraki değişiklikleri geri al/ }), null);
  });

  it('Düzenle, mesaj içeriğini düzenleyiciye geri koyar', () => {
    const edits: string[] = [];
    render(<MessageList messages={[userMessage()]} onEditMessage={(content) => edits.push(content)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Mesajı düzenle ve yeniden gönder' }));
    assert.deepEqual(edits, ['Projeyi incele ve raporla']);
  });

  it('eşleşen kontrol noktası varsa Geri al düğmesi çıkar ve mesaj gönderir', () => {
    const sent: Array<{ type: string; payload?: unknown }> = [];
    vscode.postMessage = (message: unknown) => {
      sent.push(message as { type: string; payload?: unknown });
    };
    const message = userMessage();
    render(<MessageList messages={[message]} checkpoints={checkpoints(message.timestamp)} />);

    const rewind = screen.getByRole('button', { name: /Bu mesajdan sonraki değişiklikleri geri al/ });
    // İlk tıklama satır içi onayı kurar (window.confirm sandbox'lı webview'de
    // hiç çalışmaz, bu yüzden iki adımlı düğme kullanılır). Erişilebilir ad
    // aria-label'da kalır; görünen etiket değişir.
    fireEvent.click(rewind);
    assert.ok(screen.getByText('Emin misin?'), 'onay metni görünmeli');
    assert.deepEqual(sent, []);
    fireEvent.click(rewind);
    assert.deepEqual(sent, [{ type: 'REWIND_TO_CHECKPOINT', payload: { checkpointId: 'cp_match' } }]);
  });

  it('onay reddedilirse geri alma mesajı gönderilmez', () => {
    const sent: unknown[] = [];
    vscode.postMessage = (message: unknown) => sent.push(message);
    const message = userMessage();
    render(<MessageList messages={[message]} checkpoints={checkpoints(message.timestamp)} />);

    fireEvent.click(screen.getByRole('button', { name: /Bu mesajdan sonraki değişiklikleri geri al/ }));
    assert.deepEqual(sent, []);
  });

  it('Kopyala düğmesi mesajı panoya yazar', async () => {
    const written: string[] = [];
    Object.assign(navigator, {
      clipboard: { writeText: (text: string) => Promise.resolve(written.push(text)) }
    });
    render(<MessageList messages={[userMessage()]} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mesajı kopyala' }));
    });
    assert.deepEqual(written, ['Projeyi incele ve raporla']);
  });
});

describe('MessageList: tur akordeonu', () => {
  const turnMessages = (streaming: boolean): ChatMessage[] => [
    { id: 'u1', role: 'user', content: 'görev', timestamp: 1, turnId: 't1' },
    {
      id: 'a1',
      role: 'assistant',
      content: 'İlk adım tamamlandı.',
      timestamp: 2,
      turnId: 't1',
      isStreaming: streaming
    },
    { id: 'a2', role: 'assistant', content: 'İkinci adım tamamlandı.', timestamp: 3, turnId: 't1' }
  ];

  it('biten turu kapatır, yanıtları tek blokta toplar ve özet gösterir', () => {
    render(<MessageList messages={turnMessages(false)} />);

    const body = document.getElementById('turn-t1');
    assert.ok(body, 'tur gövdesi bulunmalı');
    assert.equal(body?.hidden, true, 'biten tur daraltılmış olmalı');
    // İçerik DOM'da kalır; kullanıcı başlığa tıklayınca açılır.
    assert.ok(screen.getByText('İlk adım tamamlandı.'));
    assert.equal(
      screen.getAllByText('İkinci adım tamamlandı.').length,
      2,
      'başlıkta son yanıtın özeti de görünmeli'
    );
  });

  it('çalışan turu açık tutar', () => {
    render(<MessageList messages={turnMessages(true)} />);

    const body = document.getElementById('turn-t1');
    assert.equal(body?.hidden, false, 'süren yanıt görünür kalmalı');
  });
});

describe('MessageList: boş durum ve ayar kontrolü', () => {
  it('ayarlar yapılandırılmamışsa uyarı kartı gösterir', () => {
    let settingsOpened = false;
    render(
      <MessageList
        messages={[]}
        isConfigured={false}
        onOpenSettings={() => {
          settingsOpened = true;
        }}
      />
    );

    assert.ok(screen.getByText('Model Ayarları Yapılandırılmadı'));
    fireEvent.click(screen.getByRole('button', { name: 'Ayarları Yapılandır' }));
    assert.equal(settingsOpened, true, 'ayarları açma düğmesi çalışmalı');
  });

  it('ayarlar yapılandırılmışsa hızlı başlangıç önerilerini gösterir', () => {
    const selected: string[] = [];
    render(
      <MessageList messages={[]} isConfigured={true} onSuggestionClick={(prompt) => selected.push(prompt)} />
    );

    assert.ok(screen.getByText('Hızlı başlangıç'));
    fireEvent.click(screen.getByRole('button', { name: /Projeyi analiz et/ }));
    assert.equal(selected.length, 1);
  });
});
