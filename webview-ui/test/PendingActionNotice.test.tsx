import './setupDom';
import { afterEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PendingActionNotice } from '../src/components/PendingActionNotice';
import { vscode } from '../src/utils/vscode';
import type { TaskState, ToolCall } from '@shared/types';

const posted: Array<Record<string, unknown>> = [];
// Bileşen paylaşılan sarmalayıcıyı kullanır; testte yalnızca postMessage takas edilir.
vscode.postMessage = ((m: unknown) => {
  posted.push(m as Record<string, unknown>);
}) as typeof vscode.postMessage;

afterEach(() => {
  cleanup();
  posted.length = 0;
});

const baseState = (overrides: Partial<TaskState> = {}): TaskState =>
  ({
    id: 's1',
    prompt: 'görev',
    mode: 'code',
    status: 'waiting_approval',
    messages: [],
    stats: { totalTokens: 0, stepsCount: 0, filesModified: [] },
    ...overrides
  }) as unknown as TaskState;

const pendingTool = (): ToolCall =>
  ({
    id: 'tc-1',
    name: 'write_file',
    args: { path: 'src/a.ts', content: 'x' },
    explanation: 'Dosyayı güncelliyor',
    approvalReason: 'Dışa bağımlılık değişiyor',
    requiresApproval: true,
    status: 'pending'
  }) as unknown as ToolCall;

describe('PendingActionNotice: sohbette sabit onay/soru bildirimi', () => {
  it('bekleyen yoksa hiçbir şey çizmez', () => {
    const { container } = render(React.createElement(PendingActionNotice, { state: baseState() }));
    assert.equal(container.innerHTML, '');
  });

  it('bekleyen araç onayını araç adıyla ve gerekçesiyle çizer', () => {
    render(
      React.createElement(PendingActionNotice, { state: baseState({ pendingToolCall: pendingTool() }) })
    );
    assert.match(screen.getByRole('region').textContent ?? '', /Onay bekliyor/);
    assert.ok(screen.getByText('Dışa bağımlılık değişiyor'));
  });

  it('Onayla/Reddet/Farkı Gör düğmeleri doğru RPC’yi gönderir', () => {
    render(
      React.createElement(PendingActionNotice, { state: baseState({ pendingToolCall: pendingTool() }) })
    );
    fireEvent.click(screen.getByRole('button', { name: /Onayla/ }));
    fireEvent.click(screen.getByRole('button', { name: /Reddet/ }));
    fireEvent.click(screen.getByRole('button', { name: /Farkı Gör/ }));
    assert.deepEqual(
      posted.map((m) => m.type),
      ['APPROVE_TOOL', 'REJECT_TOOL', 'PREVIEW_TOOL_DIFF']
    );
    assert.deepEqual((posted[0].payload as { toolCallId: string }).toolCallId, 'tc-1');
  });

  it('bekleyen soru, yanıt kutusuna yönlendirerek çizilir', () => {
    render(
      React.createElement(PendingActionNotice, {
        state: baseState({ pendingQuestion: { toolCallId: 'q1', question: 'Hangi paketi kullanayım?' } })
      })
    );
    assert.ok(screen.getByText('Hangi paketi kullanayım?'));
    assert.match(document.body.textContent ?? '', /Yanıtını aşağıdaki kutuya yaz/);
    assert.equal(screen.queryByRole('button', { name: /Onayla/ }), null, 'soruda onay düğmesi olmaz');
  });
});
