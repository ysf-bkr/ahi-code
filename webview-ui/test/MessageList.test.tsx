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
    // The edit action only appears when the host provides an editor callback.
    assert.equal(screen.queryByRole('button', { name: 'Mesajı düzenle ve yeniden gönder' }), null);
    // No matching checkpoint was passed: no rewind button.
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
    // First click arms the inline confirmation (window.confirm never works in
    // the sandboxed webview, so a two-step button is used instead). The
    // accessible name stays on the aria-label; the visible label changes.
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
