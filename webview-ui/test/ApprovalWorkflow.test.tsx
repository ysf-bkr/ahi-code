import './setupDom';
import { afterEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TaskState } from '@shared/types';
import { vscode } from '../src/utils/vscode';
import { ApprovalCard } from '../src/components/ApprovalCard';
import { ChatInput } from '../src/components/ChatInput';
import { ChatStatusBar } from '../src/components/ChatStatusBar';

const originalPostMessage = vscode.postMessage;

afterEach(() => {
  cleanup();
  vscode.postMessage = originalPostMessage;
});

function createTaskState(overrides: Partial<TaskState> = {}): TaskState {
  return {
    id: 'task-1',
    prompt: '',
    mode: 'code',
    status: 'idle',
    messages: [],
    stats: { totalTokens: 0, stepsCount: 0, filesModified: [] },
    ...overrides
  };
}

function recordMessages(): Array<{ type: string; payload?: unknown }> {
  const sent: Array<{ type: string; payload?: unknown }> = [];
  vscode.postMessage = (message: unknown) => {
    sent.push(message as { type: string; payload?: unknown });
  };
  return sent;
}

describe('ApprovalCard', () => {
  it('spec onayı gönderir', () => {
    const sent = recordMessages();
    render(<ApprovalCard approval={{ kind: 'spec', title: 'Spec onayı: X', details: 'Hedef: X' }} />);

    fireEvent.click(screen.getByRole('button', { name: /Spec\u2019i onayla/ }));
    assert.deepEqual(
      sent.map((message) => message.type),
      ['APPROVE_SPEC']
    );
  });

  it('plan onayı gönderir', () => {
    const sent = recordMessages();
    render(<ApprovalCard approval={{ kind: 'plan', title: 'Plan onayı: X', details: '1. adım' }} />);

    fireEvent.click(screen.getByRole('button', { name: /Planı onayla/ }));
    assert.deepEqual(
      sent.map((message) => message.type),
      ['APPROVE_PLAN']
    );
  });

  it('gerekçeyle reddetme gönderir', () => {
    const sent = recordMessages();
    render(<ApprovalCard approval={{ kind: 'spec', title: 'Spec onayı: X', details: 'Hedef: X' }} />);

    fireEvent.click(screen.getByRole('button', { name: /Değişiklik iste/ }));
    fireEvent.change(screen.getByLabelText('Reddetme gerekçesi'), {
      target: { value: 'Kapsamı daralt' }
    });
    fireEvent.click(screen.getByRole('button', { name: /Reddet ve geri dön/ }));

    assert.deepEqual(sent, [{ type: 'REJECT_APPROVAL', payload: { reason: 'Kapsamı daralt' } }]);
  });

  it('onay metnini gösterir', () => {
    render(
      <ApprovalCard
        approval={{
          kind: 'spec',
          title: 'Spec onayı: Yeniden deneme',
          details: 'Kabul kriterleri:\n☐ Testler geçer'
        }}
      />
    );
    assert.ok(screen.getByText(/Testler geçer/));
    assert.ok(screen.getByText(/Onaylamadan plan yapılmaz/));
  });
});

describe('ChatInput: onay beklerken', () => {
  it('göndermeyi engeller ve durdurma teklif etmez', () => {
    const sent = recordMessages();
    const state = createTaskState({
      status: 'waiting_user_input',
      pendingApproval: { kind: 'spec', title: 'Spec onayı', details: 'x' }
    });

    render(<ChatInput state={state} onSend={() => {}} onModeChange={() => {}} />);

    const submit = screen.getByRole('button', { name: /Önce onay kartını yanıtlayın/ });
    assert.equal((submit as HTMLButtonElement).disabled, true);
    assert.equal(sent.length, 0);
  });

  it('onay yokken normal gönderim çalışır', () => {
    const sent = recordMessages();
    const onSend: string[] = [];
    render(
      <ChatInput state={createTaskState()} onSend={(text) => onSend.push(text)} onModeChange={() => {}} />
    );

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'merhaba' } });
    fireEvent.click(screen.getByRole('button', { name: /Mesajı gönder/ }));

    assert.deepEqual(onSend, ['merhaba']);
    assert.equal(sent.length, 0);
  });
});

describe('ChatStatusBar: tek durum satırı', () => {
  it('aşama ve adım konumunu tek satırda özetler', () => {
    render(
      <ChatStatusBar
        state={createTaskState({
          status: 'running',
          workflow: {
            stage: 'build',
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
              { id: '1', title: 'Bir', status: 'completed', dependsOn: [] },
              { id: '2', title: 'İki', status: 'in_progress', dependsOn: ['1'] },
              { id: '3', title: 'Üç', status: 'pending', dependsOn: ['2'] }
            ]
          }
        })}
        onRetry={() => {}}
      />
    );

    const text = screen.getByRole('status').textContent ?? '';
    assert.match(text, /Uygulama · Yanıt bekleniyor/);
    // The step position moved to the clickable plan bar in the composer dock.
    assert.doesNotMatch(text, /adım/);
  });
});
