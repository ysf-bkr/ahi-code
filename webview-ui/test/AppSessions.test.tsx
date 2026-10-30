import './setupDom';
import { afterEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { act, cleanup, render, screen } from '@testing-library/react';
import { App } from '../src/App';
import type { ExtensionToWebviewMessage, TaskState } from '@shared/types';

afterEach(() => cleanup());

const state = (overrides: Partial<TaskState>): TaskState => ({
  id: 's1',
  prompt: 'görev',
  mode: 'code',
  status: 'idle',
  messages: [],
  stats: { totalTokens: 0, stepsCount: 0, filesModified: [] },
  ...overrides
});

function send(message: ExtensionToWebviewMessage) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: message }));
  });
}

/**
 * Arka plan oturumu sözleşmesi (arayüz tarafı).
 *
 * Aynı anda birden çok sohbet çalışabildiği için arayüz, etkin olmayan bir
 * oturumun durum güncellemelerini çizmemeli; yalnızca arka plan çubuğunda
 * "çalışıyor" olarak göstermeli.
 */
describe('App: arka plan oturumları', () => {
  it('etkin olmayan oturumun durumunu çizmez', () => {
    render(<App />);

    send({ type: 'SESSION_ACTIVATED', payload: { sessionKey: 'session:a' } });
    send({
      type: 'TASK_STATE_UPDATE',
      payload: state({ id: 'a', messages: [{ id: 'm1', role: 'user', content: 'A sohbeti', timestamp: 1 }] }),
      sessionKey: 'session:a'
    });
    assert.ok(screen.getByText('A sohbeti'), 'etkin oturumun içeriği görünmeli');

    // Arka plan oturumundan gelen güncelleme görünen sohbeti değiştirmemeli.
    send({
      type: 'TASK_STATE_UPDATE',
      payload: state({ id: 'b', messages: [{ id: 'm2', role: 'user', content: 'B sohbeti', timestamp: 2 }] }),
      sessionKey: 'session:b'
    });
    assert.equal(screen.queryByText('B sohbeti'), null, 'arka plan sohbeti çizilmemeli');
    assert.ok(screen.getByText('A sohbeti'), 'etkin sohbet korunmalı');
  });

  it('arka planda çalışan sohbeti çubukta gösterir', () => {
    render(<App />);

    send({ type: 'SESSION_ACTIVATED', payload: { sessionKey: 'session:a' } });
    send({
      type: 'SESSIONS_CHANGED',
      payload: {
        sessions: [
          { key: 'session:a', id: 'a', prompt: 'A sohbeti', status: 'idle', running: false, messageCount: 2 },
          {
            key: 'session:b',
            id: 'b',
            prompt: 'Uzun analiz',
            status: 'running',
            running: true,
            messageCount: 4
          }
        ]
      }
    });

    assert.ok(screen.getByText(/Arka planda çalışan 1 sohbet/), 'çalışan sohbet sayılmalı');
    assert.ok(screen.getByRole('button', { name: /Uzun analiz/ }), 'sohbete geçiş düğmesi olmalı');
  });
});
