import './setupDom';
import { afterEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChatStatusBar, resolveChatStatus } from '../src/components/ChatStatusBar';
import type { TaskState } from '@shared/types';

afterEach(() => cleanup());

const baseState = (overrides: Partial<TaskState> = {}): TaskState => ({
  id: 's1',
  prompt: 'test',
  mode: 'code',
  status: 'idle',
  messages: [],
  stats: { totalTokens: 0, stepsCount: 0, filesModified: [] },
  ...overrides
});

const userMessage = { id: 'u1', role: 'user' as const, content: 'Merhaba', timestamp: 1 };

describe('ChatStatusBar: durum satırı', () => {
  it('yanıt beklenirken bunu söyler', () => {
    const status = resolveChatStatus(baseState({ status: 'running' }));
    assert.strictEqual(status.kind, 'busy');
    assert.match(status.message, /Yanıt bekleniyor/);

    render(<ChatStatusBar state={baseState({ status: 'running' })} onRetry={() => {}} />);
    assert.match(screen.getByRole('status').textContent ?? '', /Yanıt bekleniyor/);
  });

  it('araç çalışırken araç adını gösterir', () => {
    const status = resolveChatStatus(
      baseState({
        status: 'running',
        messages: [
          userMessage,
          {
            id: 'a1',
            role: 'assistant',
            content: '',
            timestamp: 2,
            isStreaming: true,
            toolCalls: [
              {
                id: 'tc1',
                name: 'read_file',
                args: {},
                requiresApproval: false,
                status: 'executing'
              }
            ]
          }
        ]
      })
    );
    assert.strictEqual(status.kind, 'busy');
    assert.match(status.message, /Araç çalışıyor: read_file \(1\/1\)/);
  });

  it('alt ajan çalışırken ajan adını ve çalıştırılan aracı gösterir', () => {
    const status = resolveChatStatus(
      baseState({
        status: 'running',
        activeSubagent: {
          role: 'architect',
          displayName: 'Mimar',
          task: 'Tasarımı incele',
          status: 'running',
          currentTool: 'read_file',
          step: 2,
          maxSteps: 8,
          isolate: true,
          startedAt: 1
        }
      })
    );
    assert.strictEqual(status.kind, 'busy');
    assert.match(status.message, /Alt Ajan \[Mimar\]: araç çalışıyor: read_file \(2\/8\) · İzole Worktree/);
  });

  it('hata durumunda yeniden gönder düğmesi sunar', () => {
    let retried = 0;
    const state = baseState({
      status: 'failed',
      messages: [
        userMessage,
        { id: 'a1', role: 'assistant', content: '', timestamp: 2, error: 'Bağlantı koptu' }
      ]
    });

    render(<ChatStatusBar state={state} onRetry={() => (retried += 1)} />);
    const text = screen.getByRole('status').textContent ?? '';
    assert.match(text, /Hata: Bağlantı koptu/);

    fireEvent.click(screen.getByRole('button', { name: /Yeniden gönder/ }));
    assert.equal(retried, 1);
  });

  it('onay beklerken onay kartını işaret eder', () => {
    const status = resolveChatStatus(
      baseState({
        status: 'waiting_approval',
        pendingApproval: { kind: 'plan', title: 'Plan', details: 'detay' }
      })
    );
    assert.strictEqual(status.kind, 'waiting');
    assert.match(status.message, /Plan onayı bekleniyor/);
    assert.strictEqual(status.canRetry, false);
  });

  it('duraklatıldığında devam ipucu verir', () => {
    const status = resolveChatStatus(baseState({ status: 'paused' }));
    assert.strictEqual(status.kind, 'paused');
    assert.strictEqual(status.canRetry, true);
  });

  it('tamamlanınca tek satırda özetler', () => {
    const state = baseState({
      status: 'completed',
      messages: [userMessage, { id: 'a1', role: 'assistant', content: 'Rapor hazır.', timestamp: 2 }],
      workflow: {
        stage: 'done',
        questionsAsked: 0,
        specApproved: true,
        planApproved: true,
        knowledgeReady: true,
        updatedAt: 1
      },
      plan: {
        goal: 'İnceleme',
        updatedAt: 1,
        steps: [
          { id: '1', title: 'Ağacı incele', status: 'completed', dependsOn: [] },
          { id: '2', title: 'Modülleri incele', status: 'completed', dependsOn: ['1'] },
          { id: '3', title: 'Raporla', status: 'completed', dependsOn: ['2'] }
        ]
      }
    });

    render(<ChatStatusBar state={state} onRetry={() => {}} />);
    const text = screen.getByRole('status').textContent ?? '';

    assert.match(text, /Bitti · Yanıt tamamlandı/);
    assert.doesNotMatch(text, /adım/, 'adım sayacı plan çubuğuna taşındı');
  });

  it('boşta hiçbir şey çizmez', () => {
    const { container } = render(<ChatStatusBar state={baseState()} onRetry={() => {}} />);
    assert.strictEqual(container.textContent, '');
  });
});
