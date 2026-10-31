import './setupDom';
import { afterEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GitChangesPayload, TaskState } from '@shared/types';
import { vscode } from '../src/utils/vscode';
import { ChangesView } from '../src/components/ChangesView';

const originalPostMessage = vscode.postMessage;

afterEach(() => {
  cleanup();
  vscode.postMessage = originalPostMessage;
});

const TASK_STATE: TaskState = {
  id: 't1',
  prompt: 'görev',
  mode: 'code',
  status: 'idle',
  messages: [],
  stats: {
    totalTokens: 0,
    stepsCount: 0,
    filesModified: ['src/app.ts']
  }
};

const GIT_CHANGES: GitChangesPayload = {
  isRepository: true,
  branch: 'main',
  files: [
    { path: 'src/new.ts', indexStatus: '?', workTreeStatus: '?' },
    { path: 'src/edited.ts', indexStatus: 'M', workTreeStatus: ' ' }
  ],
  commits: [{ hash: 'abc1234', subject: 'İlk commit' }]
};

/** Görünümü render eder ve extension host'un yapacağı gibi Git durumunu besler. */
async function renderWithGitChanges(): Promise<Array<{ type: string; payload?: unknown }>> {
  const sent: Array<{ type: string; payload?: unknown }> = [];
  vscode.postMessage = (message: unknown) => {
    const typed = message as { type: string };
    sent.push(typed);
    if (typed.type === 'GET_GIT_CHANGES') {
      setTimeout(() => {
        window.postMessage({ type: 'GIT_CHANGES_LOADED', payload: GIT_CHANGES }, '*');
      }, 0);
    }
  };

  render(<ChangesView state={TASK_STATE} onBack={() => {}} />);
  await waitFor(() => assert.ok(screen.getByText('src/new.ts')));
  return sent;
}

describe('ChangesView: görev ve Git değişiklikleri', () => {
  it('görev dosyalarını ve Git çalışma ağacını birlikte gösterir', async () => {
    await renderWithGitChanges();

    assert.ok(screen.getByText('src/app.ts'), 'görev dosyası listelenmeli');
    assert.ok(screen.getByText('src/new.ts'), 'izlenmeyen Git dosyası listelenmeli');
    assert.ok(screen.getByText('src/edited.ts'), 'değiştirilen Git dosyası listelenmeli');
    assert.ok(screen.getByText('abc1234'), 'commit listelenmeli');
    assert.ok(screen.getByText(/İlk commit/));
  });

  it('dosya adına tıklamak OPEN_FILE mesajı gönderir', async () => {
    const sent = await renderWithGitChanges();

    fireEvent.click(screen.getByText('src/app.ts'));
    const openFile = sent.find((message) => message.type === 'OPEN_FILE');
    assert.deepEqual(openFile?.payload, { filePath: 'src/app.ts' });
  });

  it('Fark düğmesi SHOW_FILE_DIFF mesajı gönderir', async () => {
    const sent = await renderWithGitChanges();

    fireEvent.click(screen.getAllByTitle('Dosya farkını VS Code diff görünümünde aç')[0]!);
    const diff = sent.find((message) => message.type === 'SHOW_FILE_DIFF');
    assert.deepEqual(diff?.payload, { filePath: 'src/app.ts' });
  });

  it('commite tıklamak SHOW_COMMIT mesajı gönderir', async () => {
    const sent = await renderWithGitChanges();

    fireEvent.click(screen.getByText('abc1234'));
    const showCommit = sent.find((message) => message.type === 'SHOW_COMMIT');
    assert.deepEqual(showCommit?.payload, { commitHash: 'abc1234' });
  });

  it('değişim tarihi, saati ve boyut gösterilir; commit tarihi görünür', async () => {
    const stamp = new Date(2026, 5, 12, 14, 32).getTime();
    vscode.postMessage = (message: unknown) => {
      const typed = message as { type: string };
      if (typed.type !== 'GET_GIT_CHANGES') return;
      setTimeout(() => {
        window.postMessage(
          {
            type: 'GIT_CHANGES_LOADED',
            payload: {
              isRepository: true,
              branch: 'main',
              files: [
                {
                  path: 'src/timed.ts',
                  indexStatus: 'M',
                  workTreeStatus: ' ',
                  modifiedAt: stamp,
                  sizeBytes: 2048
                }
              ],
              commits: [
                { hash: 'def5678', subject: 'Tarihli', date: new Date(2026, 5, 11, 9, 5).toISOString() }
              ]
            }
          },
          '*'
        );
      }, 0);
    };

    render(<ChangesView state={TASK_STATE} onBack={() => {}} />);
    await waitFor(() => assert.ok(screen.getByText('src/timed.ts')));
    // 12 Haziran 2026 → "12 Haz 2026 14:32" biçimi beklenir.
    assert.ok(screen.getByText(/12 Haz 2026 14:32/), 'dosya değişim zamanı gösterilmeli');
    assert.ok(screen.getByText(/2,0 KB/), 'dosya boyutu gösterilmeli');
    assert.ok(screen.getByText(/11 Haz 2026 09:05/), 'commit tarihi gösterilmeli');
  });

  it('Git deposu yoksa açıklayıcı durum gösterir', async () => {
    vscode.postMessage = (message: unknown) => {
      const typed = message as { type: string };
      if (typed.type !== 'GET_GIT_CHANGES') return;
      setTimeout(() => {
        window.postMessage(
          {
            type: 'GIT_CHANGES_LOADED',
            payload: { isRepository: false, branch: '', files: [], commits: [] }
          },
          '*'
        );
      }, 0);
    };

    render(<ChangesView state={TASK_STATE} onBack={() => {}} />);
    await waitFor(() => assert.ok(screen.getByText('Git deposu bulunamadı')));
  });
});
