import './setupDom';
import { afterEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { cleanup, render, screen } from '@testing-library/react';
import { MessageStatus, resolveMessagePhase } from '../src/components/MessageStatus';
import type { ChatMessage, ToolCall } from '@shared/types';

afterEach(() => cleanup());

const toolCall = (overrides: Partial<ToolCall>): ToolCall => ({
  id: 'tc1',
  name: 'read_file',
  args: { path: 'src/index.ts' },
  requiresApproval: false,
  status: 'pending',
  ...overrides
});

const message = (overrides: Partial<ChatMessage>): ChatMessage => ({
  id: 'm1',
  role: 'assistant',
  content: '',
  timestamp: Date.now(),
  ...overrides
});

describe('MessageStatus: dürüst durum', () => {
  it('akış yokken "yazıyor" demez', () => {
    const info = resolveMessagePhase(message({ isStreaming: false, toolCalls: [toolCall({})] }));
    assert.strictEqual(info?.phase, 'working');
  });

  it('araç çalışırken araç adını ve adımı gösterir', () => {
    const info = resolveMessagePhase(
      message({
        isStreaming: true,
        content: 'dosyayı okuyorum',
        toolCalls: [
          toolCall({ id: 'a', name: 'list_directory', status: 'completed' }),
          toolCall({ id: 'b', name: 'read_file', status: 'executing' })
        ]
      })
    );
    assert.strictEqual(info?.phase, 'working');
    assert.strictEqual(info?.tool, 'read_file');
    assert.strictEqual(info?.step, 2);
    assert.strictEqual(info?.totalSteps, 2);

    render(
      <MessageStatus
        message={message({
          isStreaming: true,
          content: 'dosyayı okuyorum',
          toolCalls: [toolCall({ status: 'executing' })]
        })}
      />
    );
    assert.ok(screen.getByRole('status'));
    assert.match(screen.getByRole('status').textContent ?? '', /çalışıyor: read_file \(1\/1\)/);
  });

  it('metin akarken "yazıyor", içerik yokken "düşünüyor" der', () => {
    assert.strictEqual(resolveMessagePhase(message({ isStreaming: true, content: 'x' }))?.phase, 'writing');
    assert.strictEqual(resolveMessagePhase(message({ isStreaming: true }))?.phase, 'thinking');
  });

  it('hata durumunu hataya çevirir', () => {
    const info = resolveMessagePhase(message({ error: 'Bağlantı koptu' }));
    assert.strictEqual(info?.phase, 'error');
    assert.strictEqual(info?.detail, 'Bağlantı koptu');
  });

  it('biten aracı turunu tamamlandı olarak gösterir', () => {
    const info = resolveMessagePhase(message({ toolCalls: [toolCall({ status: 'completed' })] }));
    assert.strictEqual(info?.phase, 'done');
  });

  it('gösterilecek bir şey yoksa hiçbir şey çizmez', () => {
    const { container } = render(<MessageStatus message={message({})} />);
    assert.strictEqual(container.textContent, '');
  });
});
