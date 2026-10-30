import './setupDom';
import { afterEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vscode } from '../src/utils/vscode';
import { AgentsView } from '../src/components/AgentsView';

const originalPostMessage = vscode.postMessage;

afterEach(() => {
  cleanup();
  vscode.postMessage = originalPostMessage;
});

/** Görünümü render eder ve extension host'un yapacağı gibi özelleştirmeleri besler. */
async function renderAgentsView(): Promise<Array<{ type: string; payload?: unknown }>> {
  const sent: Array<{ type: string; payload?: unknown }> = [];
  vscode.postMessage = (message: unknown) => {
    const typed = message as { type: string };
    sent.push(typed);
    if (typed.type === 'GET_CUSTOMIZATIONS') {
      setTimeout(() => {
        window.postMessage(
          {
            type: 'CUSTOMIZATIONS_LOADED',
            payload: {
              hasAgentsMd: false,
              skills: [],
              agents: [
                {
                  name: 'devops-engineer',
                  role: 'devops',
                  description: 'Dağıtım otomasyonu',
                  path: '.agents/agents/devops-engineer.md',
                  tools: ['read_file']
                }
              ]
            }
          },
          '*'
        );
      }, 0);
    }
  };

  render(<AgentsView onBack={() => {}} />);
  await waitFor(() => assert.ok(screen.getByText('devops-engineer')));
  return sent;
}

describe('AgentsView: yerleşik ajanlar ve görev başlatma', () => {
  it('yerleşik ajan kartları ortak listeden render edilir', async () => {
    await renderAgentsView();

    assert.ok(screen.getByText('Yönetici'));
    assert.ok(screen.getByText('Mimar'));
    assert.ok(screen.getByText('Backend Uzmanı'));
    assert.ok(screen.getByText('Kalite Uzmanı'));
    assert.ok(screen.getByText('Güvenlik Uzmanı'));
  });

  it('yönetici seçilince görev formu açılır ve Başlat mesajı gönderir', async () => {
    const sent = await renderAgentsView();

    fireEvent.click(screen.getByText('Yönetici'));
    const taskInput = screen.getByLabelText('Alt ajan görevi');
    fireEvent.change(taskInput, { target: { value: 'Mimariyi incele ve raporla' } });

    fireEvent.click(screen.getByRole('button', { name: 'Başlat' }));
    const start = sent.find((message) => message.type === 'START_SUBAGENT');
    assert.deepEqual(start?.payload, {
      role: 'manager',
      task: 'Mimariyi incele ve raporla',
      isolate: false
    });
  });

  it('izole worktree seçeneği payload ile iletilir', async () => {
    const sent = await renderAgentsView();

    fireEvent.click(screen.getByText('Yönetici'));
    fireEvent.change(screen.getByLabelText('Alt ajan görevi'), {
      target: { value: 'Yardımcı fonksiyonu yaz' }
    });
    fireEvent.click(screen.getByLabelText(/Ayrı Git worktree içinde çalıştır/));

    fireEvent.click(screen.getByRole('button', { name: 'Başlat' }));
    const start = sent.find((message) => message.type === 'START_SUBAGENT');
    assert.deepEqual(start?.payload, {
      role: 'manager',
      task: 'Yardımcı fonksiyonu yaz',
      isolate: true
    });
  });

  it('uzman ajanlar için görev formu açılabilir ve aktif durumdadır', async () => {
    await renderAgentsView();

    const taskBtns = screen.getAllByRole('button', { name: 'Görev' });
    assert.ok(taskBtns.length > 0, 'en az bir görev butonu olmalı');
    assert.ok(!taskBtns[0]!.hasAttribute('disabled'), 'uzman ajanın görev butonu aktif olmalı');
  });

  it('aktif alt ajan varsa durum kartı gösterir ve başlatmayı engeller', async () => {
    vscode.postMessage = (message: unknown) => {
      const typed = message as { type: string };
      if (typed.type === 'GET_CUSTOMIZATIONS') {
        setTimeout(() => {
          window.postMessage(
            {
              type: 'CUSTOMIZATIONS_LOADED',
              payload: {
                hasAgentsMd: false,
                skills: [],
                agents: []
              }
            },
            '*'
          );
        }, 0);
      }
    };

    render(
      <AgentsView
        onBack={() => {}}
        state={{
          id: 's1',
          prompt: 'test',
          mode: 'code',
          status: 'running',
          messages: [],
          stats: { totalTokens: 0, stepsCount: 0, filesModified: [] },
          activeSubagent: {
            role: 'security',
            displayName: 'Güvenlik Uzmanı',
            task: 'Açıkları tara',
            status: 'running',
            currentTool: 'search_files',
            step: 1,
            maxSteps: 8,
            isolate: false,
            startedAt: 1
          }
        }}
      />
    );

    await waitFor(() => assert.ok(screen.getByText(/Aktif Alt Ajan: Güvenlik Uzmanı/)));
    assert.ok(screen.getByText('Açıkları tara'));
    assert.ok(screen.getByText(/search_files \(1\/8\)/));

    fireEvent.click(screen.getByText('Yönetici'));
    const startBtn = screen.getByRole('button', { name: 'Başlat' });
    assert.ok(startBtn.hasAttribute('disabled'));
  });

  it('yerleşik ajanı özelleştirme mesajı gönderir', async () => {
    const sent = await renderAgentsView();

    const customizeBtns = screen.getAllByRole('button', { name: 'Özelleştir' });
    assert.ok(customizeBtns.length > 0, 'en az bir özelleştir butonu olmalı');
    fireEvent.click(customizeBtns[0]!);

    const customizeMsg = sent.find((m) => m.type === 'CUSTOMIZE_BUILTIN_AGENT');
    assert.ok(customizeMsg, 'CUSTOMIZE_BUILTIN_AGENT mesajı gönderilmeli');
  });
});
