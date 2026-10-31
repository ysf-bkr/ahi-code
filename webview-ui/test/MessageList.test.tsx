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

  it('biten tur açık doğar; yanıtlar görünür, başlıktan daraltılabilir', () => {
    render(<MessageList messages={turnMessages(false)} />);

    const body = document.getElementById('turn-t1');
    assert.equal(body?.hidden, false, 'biten turun yanıtları görünür doğmalı');
    assert.ok(screen.getByText('İlk adım tamamlandı.'));

    const toggle = document.querySelector('[aria-controls="turn-t1"]') as HTMLElement;
    fireEvent.click(toggle);
    assert.equal(document.getElementById('turn-t1')?.hidden, true, 'kullanıcı daraltabilmeli');
    // Daralınca içerik DOM'da kalır (hidden); başlıktaki özet ayrı bir span'dır.
    assert.ok(screen.getByText('İkinci adım tamamlandı.', { selector: 'span.truncate' }));
  });

  it('çalışan turu açık tutar', () => {
    render(<MessageList messages={turnMessages(true)} />);

    const body = document.getElementById('turn-t1');
    assert.equal(body?.hidden, false, 'süren yanıt görünür kalmalı');
  });

  const withToolCall = (status: 'completed' | 'pending'): ChatMessage[] => [
    { id: 'u1', role: 'user', content: 'dosyayı oku', timestamp: 1, turnId: 't1' },
    {
      id: 'a1',
      role: 'assistant',
      content: 'Dosyayı okudum.',
      timestamp: 2,
      turnId: 't1',
      toolCalls: [
        {
          id: 'call_1',
          name: 'read_file',
          args: { path: 'src/a.ts' },
          requiresApproval: status === 'pending',
          status,
          result: status === 'completed' ? 'içerik' : undefined
        }
      ]
    }
  ];

  const toolStepsDetails = (): HTMLDetailsElement | undefined =>
    Array.from(document.querySelectorAll('details')).find((el) =>
      el.querySelector('summary')?.textContent?.includes('Araç adımları')
    );

  it('araç adımları varsayılan kapalıdır; yanıt metni görünür kalır', () => {
    render(<MessageList messages={withToolCall('completed')} />);

    assert.ok(screen.getByText('Dosyayı okudum.'), 'yanıt metni görünür olmalı');
    const details = toolStepsDetails();
    assert.ok(details, 'araç adımları bölümü bulunmalı');
    assert.equal(details.open, false, 'adım listesi kapalı gelmeli');
  });

  it('onay bekleyen adım varsa araç adımları kendiliğinden açıktır', () => {
    const messages = withToolCall('pending');
    render(<MessageList messages={messages} pendingToolCall={messages[1]?.toolCalls?.[0]} />);

    const details = toolStepsDetails();
    assert.ok(details, 'araç adımları bölümü bulunmalı');
    assert.equal(details.open, true, 'onay kartı görünür doğmalı');
  });

  it('uzun adım listesi kendi içinde kaydırılır — akordeon sayfayı boy vermez', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: `call_${i}`,
      name: 'read_file' as const,
      args: { path: `src/f${i}.ts` },
      requiresApproval: false,
      status: 'completed' as const,
      result: 'içerik'
    }));
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'denetimi', timestamp: 1, turnId: 't1' },
      { id: 'a1', role: 'assistant', content: 'Bitti.', timestamp: 2, turnId: 't1', toolCalls: many }
    ];
    render(<MessageList messages={messages} />);

    const details = toolStepsDetails();
    assert.ok(details);
    details.open = true;
    const list = details.querySelector('summary')?.parentElement?.querySelector('div.overflow-y-auto');
    assert.ok(list, 'adım listesi kaydırma alanı olmalı (max-h + overflow-y-auto)');
    assert.match(list.className, /max-h-/, 'yükseklik sınırı taşınmalı');
    assert.match(list.className, /overscroll-contain/, 'kaydırma sohbeti ezmemeli');
  });
});

describe('MessageList: hatalı turu aynı sohbette yeniden deneme', () => {
  const failedTurn = (): ChatMessage[] => [
    { id: 'u1', role: 'user', content: 'Uzun görev', timestamp: 1, turnId: 't1' },
    { id: 'a1', role: 'assistant', content: '', timestamp: 2, turnId: 't1', error: 'API error [400]' }
  ];

  it('son tur hatalıysa "Tekrar dene" aynı istem ve mesaj kimliğiyle geri çağrılır', () => {
    const retries: Array<[string, string]> = [];
    render(
      <MessageList messages={failedTurn()} onRetryMessage={(content, id) => retries.push([content, id])} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Son yanıtı bu sohbette yeniden dene' }));
    assert.deepEqual(retries, [['Uzun görev', 'u1']]);
  });

  it('hata yoksa yeniden dene düğmesi gösterilmez', () => {
    render(
      <MessageList
        messages={[
          { id: 'u1', role: 'user', content: 'görev', timestamp: 1, turnId: 't1' },
          { id: 'a1', role: 'assistant', content: 'yanıt', timestamp: 2, turnId: 't1' }
        ]}
        onRetryMessage={() => assert.fail('çağrılmamalı')}
      />
    );
    assert.equal(screen.queryByRole('button', { name: 'Son yanıtı bu sohbette yeniden dene' }), null);
  });

  it('hatalı tur son tur değilse düğme gösterilmez', () => {
    render(
      <MessageList
        messages={[
          ...failedTurn(),
          { id: 'u2', role: 'user', content: 'sonraki', timestamp: 3, turnId: 't2' },
          { id: 'a2', role: 'assistant', content: 'tamam', timestamp: 4, turnId: 't2' }
        ]}
        onRetryMessage={() => assert.fail('çağrılmamalı')}
      />
    );
    assert.equal(screen.queryByRole('button', { name: 'Son yanıtı bu sohbette yeniden dene' }), null);
  });
});

describe('MessageList: uzun sohbet sayfalama', () => {
  const manyTurns = (count: number): ChatMessage[] => {
    const list: ChatMessage[] = [];
    for (let i = 1; i <= count; i++) {
      list.push({ id: `u${i}`, role: 'user', content: `istem-${i}`, timestamp: i, turnId: `t${i}` });
      list.push({
        id: `a${i}`,
        role: 'assistant',
        content: `yanıt-${i}`,
        timestamp: i + 0.5,
        turnId: `t${i}`
      });
    }
    return list;
  };

  it('yalnızca en yeni turlar çizilir; yukarı kaydırınca eski turlar gelir', () => {
    render(<MessageList messages={manyTurns(30)} />);

    assert.equal(screen.queryByText('istem-1'), null, 'en eski turlar başta çizilmemeli');
    assert.ok(screen.getByText('istem-30'), 'en yeni tur görünmeli');
    assert.ok(screen.getByText(/Yukarıda 5 eski tur var/), 'gizli tur bilgisi gösterilmeli');

    fireEvent.scroll(screen.getByRole('log'));
    assert.ok(screen.getByText('istem-1'), 'yukarı kaydırınca en eski tur gelmeli');
    assert.equal(
      screen.queryByText(/Yukarıda \d+ eski tur var/),
      null,
      'tüm turlar gelince bilgi kaybolmalı'
    );
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
