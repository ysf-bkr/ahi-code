import './setupDom';
import { afterEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { act, cleanup, render, screen } from '@testing-library/react';
import { App } from '../src/App';
import type { ExtensionToWebviewMessage } from '@shared/types';

afterEach(() => cleanup());

function send(message: ExtensionToWebviewMessage) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: message }));
  });
}

/**
 * Bildirim yerleşimi sözleşmesi.
 *
 * Bildirim eskiden bestecinin üstüne mutlak konumlu bir katman olarak
 * çiziliyordu ve tam o noktada canlı plan/görev çubuğu durduğu için planı
 * kapatıyordu. Artık bildirim normal akışta, plan çubuğundan ÖNCE yer kaplar;
 * DOM sırası bunun kalıcı bekçisidir.
 */
describe('App: bildirim plan çubuğunu kapatmaz', () => {
  it('bildirim, plan çubuğunun üstünde ve DOM akışında ondan önce gelir', () => {
    const { container } = render(<App />);

    send({ type: 'SESSION_ACTIVATED', payload: { sessionKey: 'session:a' } });
    send({
      type: 'TASK_STATE_UPDATE',
      payload: {
        id: 'a',
        prompt: 'görev',
        mode: 'code',
        status: 'running',
        messages: [],
        stats: { totalTokens: 0, stepsCount: 0, filesModified: [] },
        plan: {
          goal: 'Projeyi incele',
          updatedAt: 1,
          steps: [{ id: '1', title: 'Ağacı incele', status: 'in_progress', dependsOn: [] }]
        }
      },
      sessionKey: 'session:a'
    });
    assert.ok(screen.getByText('Projeyi incele'), 'plan çubuğu çizilmeli');

    send({ type: 'NOTIFICATION', payload: { level: 'info', message: 'Bilgi tabanı hazır' } });

    const toast = screen.getByText('Bilgi tabanı hazır');
    const planBar = screen.getByText('Projeyi incele');
    const order = planBar.compareDocumentPosition(toast);
    assert.ok(
      order & Node.DOCUMENT_POSITION_PRECEDING,
      'bildirim DOM akışında plan çubuğundan önce gelmeli (üstte çizilir, üstüne uçmaz)'
    );
    assert.ok(container.textContent?.includes('Bilgi tabanı hazır'));
  });
});
