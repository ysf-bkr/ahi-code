import './setupDom';
import { afterEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ComposerDock } from '../src/components/ComposerDock';
import type { TaskState } from '@shared/types';

afterEach(() => cleanup());

const baseState = (overrides: Partial<TaskState> = {}): TaskState => ({
  id: 's1',
  prompt: 'görev',
  mode: 'code',
  status: 'running',
  messages: [],
  stats: { totalTokens: 0, stepsCount: 0, filesModified: [] },
  plan: {
    goal: 'Projeyi incele',
    updatedAt: 1,
    steps: [
      { id: '1', title: 'Ağacı incele', status: 'completed', dependsOn: [] },
      { id: '2', title: 'Modülleri incele', status: 'in_progress', dependsOn: ['1'] },
      { id: '3', title: 'Bulguları raporla', status: 'pending', dependsOn: ['2'] }
    ]
  },
  ...overrides
});

describe('ComposerDock: yazma alanının üstündeki sabit blok', () => {
  it('plan yoksa ve onay/soru beklemiyorsa hiçbir şey çizmez', () => {
    const { container } = render(<ComposerDock state={baseState({ plan: undefined, status: 'idle' })} />);
    assert.strictEqual(container.textContent, '');
  });

  it('plan çubuğunu tıklayınca adımları sırayla listeler', () => {
    render(<ComposerDock state={baseState()} />);

    const toggle = screen.getByRole('button', { name: /Projeyi incele/ });
    assert.match(toggle.textContent ?? '', /1\/3 adım · %33/);
    assert.match(toggle.textContent ?? '', /devam ediyor/);
    assert.equal(screen.queryByRole('listitem'), null, 'kapalıyken liste gizli');

    fireEvent.click(toggle);
    const items = screen.getAllByRole('listitem');
    assert.equal(items.length, 3);
    assert.match(items[0]?.textContent ?? '', /1\. Ağacı incele/);
    assert.match(items[1]?.textContent ?? '', /2\. Modülleri incele/);
    assert.match(items[2]?.textContent ?? '', /3\. Bulguları raporla/);
    assert.match(items[1]?.textContent ?? '', /devam ediyor/);
    assert.equal(items[1]?.getAttribute('aria-label'), '2. adım devam ediyor: Modülleri incele');

    fireEvent.click(toggle);
    assert.equal(screen.queryByRole('listitem'), null, 'tekrar tıklanınca kapanır');
  });

  it('spec onay kartını composer üstünde gösterir', () => {
    render(
      <ComposerDock
        state={baseState({
          status: 'waiting_user_input',
          pendingApproval: { kind: 'spec', title: 'Spec onayı: X', details: 'Hedef: X' }
        })}
      />
    );

    assert.ok(screen.getByRole('button', { name: /Spec’i onayla/ }));
    assert.ok(screen.getByRole('button', { name: /Değişiklik iste/ }));
  });

  it('ajan sorusu kartını composer üstünde gösterir', () => {
    render(
      <ComposerDock
        state={baseState({
          status: 'waiting_user_input',
          plan: undefined,
          pendingQuestion: { toolCallId: 'q1', question: 'Hangi veritabanı?' }
        })}
      />
    );

    assert.ok(screen.getByText('Hangi veritabanı?'));
    assert.ok(screen.getByRole('textbox', { name: 'Ajanın sorusuna yanıt' }));
  });

  it('aktif alt ajan kartını composer üstünde gösterir', () => {
    render(
      <ComposerDock
        state={baseState({
          status: 'running',
          plan: undefined,
          activeSubagent: {
            role: 'backend',
            displayName: 'Backend Uzmanı',
            task: 'API endpointlerini oluştur',
            status: 'running',
            currentTool: 'write_file',
            step: 3,
            maxSteps: 8,
            isolate: true,
            worktreePath: '/project/.worktrees/backend-xyz',
            startedAt: 1
          }
        })}
      />
    );

    assert.ok(screen.getByTestId('active-subagent-card'));
    assert.ok(screen.getByText('Backend Uzmanı'));
    assert.ok(screen.getByText('API endpointlerini oluştur'));
    assert.ok(screen.getByText('İzole Worktree'));
    assert.match(screen.getByText(/write_file \(3\/8\)/).textContent ?? '', /write_file \(3\/8\)/);
  });

  it('duraklatılmış durumda kaldığı yerden devam et kartını gösterir', () => {
    render(
      <ComposerDock
        state={baseState({
          status: 'paused',
          plan: undefined
        })}
      />
    );

    assert.ok(screen.getByTestId('paused-resume-card'));
    assert.ok(screen.getByText('Görev Duraklatıldı'));
    assert.ok(screen.getByRole('button', { name: /Devam Et/ }));
  });
});
