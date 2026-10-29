import './setupDom';
import { afterEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TaskSummary } from '@shared/types';
import { vscode } from '../src/utils/vscode';
import { HistoryView } from '../src/components/HistoryView';

const originalPostMessage = vscode.postMessage;

afterEach(() => {
  cleanup();
  vscode.postMessage = originalPostMessage;
});

const SESSIONS: TaskSummary[] = [
  {
    id: 's1',
    prompt: 'Ödeme akışını ekle',
    timestamp: 1_700_000_300_000,
    messageCount: 12,
    status: 'completed'
  },
  {
    id: 's2',
    prompt: 'Login hatasını düzelt',
    timestamp: 1_700_000_200_000,
    messageCount: 4,
    status: 'failed'
  },
  {
    id: 's3',
    prompt: 'Ödeme testlerini yaz',
    timestamp: 1_700_000_100_000,
    messageCount: 30,
    status: 'cancelled'
  }
];

/** Renders the view and feeds it a session list, as the extension host would. */
async function renderWithSessions(sessions: TaskSummary[] = SESSIONS): Promise<void> {
  vscode.postMessage = (message: unknown) => {
    const typed = message as { type: string };
    if (typed.type !== 'GET_TASK_HISTORY') return;
    setTimeout(() => {
      window.postMessage({ type: 'TASK_HISTORY_LOADED', payload: { history: sessions } }, '*');
    }, 0);
  };

  render(<HistoryView onBack={() => {}} />);
  await waitFor(() => assert.ok(screen.getByText('Ödeme akışını ekle')));
}

describe('HistoryView: arama', () => {
  it('metne göre filtreler', async () => {
    await renderWithSessions();

    fireEvent.change(screen.getByLabelText('Oturumlarda ara'), { target: { value: 'ödeme' } });
    assert.ok(screen.getByText('Ödeme akışını ekle'));
    assert.ok(screen.getByText('Ödeme testlerini yaz'));
    assert.equal(screen.queryByText('Login hatasını düzelt'), null);
  });

  it('arama temizlenince tüm oturumlar döner', async () => {
    await renderWithSessions();

    const input = screen.getByLabelText('Oturumlarda ara');
    fireEvent.change(input, { target: { value: 'login' } });
    assert.equal(screen.queryByText('Ödeme akışını ekle'), null);

    fireEvent.change(input, { target: { value: '' } });
    assert.ok(screen.getByText('Ödeme akışını ekle'));
  });

  it('eşleşme yoksa temizleme düğmesi gösterir', async () => {
    await renderWithSessions();

    fireEvent.change(screen.getByLabelText('Oturumlarda ara'), { target: { value: 'yok-boyle-bir-sey' } });
    assert.ok(screen.getByText('Eşleşen oturum bulunamadı'));
    assert.ok(screen.getByRole('button', { name: 'Filtreleri temizle' }));
  });
});

describe('HistoryView: durum filtresi', () => {
  it('yalnızca tamamlanan oturumları gösterir', async () => {
    await renderWithSessions();

    fireEvent.click(screen.getByRole('button', { name: /^Tamamlanan/ }));
    assert.ok(screen.getByText('Ödeme akışını ekle'));
    assert.equal(screen.queryByText('Login hatasını düzelt'), null);
    assert.equal(screen.queryByText('Ödeme testlerini yaz'), null);
  });

  it('başarısız oturumları filtreler', async () => {
    await renderWithSessions();

    fireEvent.click(screen.getByRole('button', { name: /^Başarısız/ }));
    assert.ok(screen.getByText('Login hatasını düzelt'));
    assert.equal(screen.queryByText('Ödeme akışını ekle'), null);
  });

  it('Tümü filtresi her şeyi geri getirir', async () => {
    await renderWithSessions();

    fireEvent.click(screen.getByRole('button', { name: /^Başarısız/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Tümü/ }));
    assert.ok(screen.getByText('Ödeme akışını ekle'));
    assert.ok(screen.getByText('Login hatasını düzelt'));
  });
});

describe('HistoryView: sıralama ve özet', () => {
  it('en yeniden en eskiye geçer', async () => {
    await renderWithSessions();

    const titles = () =>
      screen
        .getAllByText(/Ödeme|Login/)
        .map((node) => node.textContent)
        .filter(Boolean) as string[];

    assert.equal(titles()[0], 'Ödeme akışını ekle');

    fireEvent.click(screen.getByTitle('Sıralamayı değiştir'));
    assert.equal(titles()[0], 'Ödeme testlerini yaz');
  });

  it('en uzun oturumu başa alır', async () => {
    await renderWithSessions();

    const sortButton = screen.getByTitle('Sıralamayı değiştir');
    fireEvent.click(sortButton); // oldest
    fireEvent.click(sortButton); // largest

    const titles = screen
      .getAllByText(/Ödeme|Login/)
      .map((node) => node.textContent)
      .filter(Boolean) as string[];
    assert.equal(titles[0], 'Ödeme testlerini yaz');
  });

  it('oturum sayısını ve mesaj toplamını gösterir', async () => {
    await renderWithSessions();
    assert.ok(screen.getByText(/3 oturum/));
    assert.ok(screen.getByText(/46 mesaj/));
  });
});

describe('HistoryView: eylemler', () => {
  it('oturuma tıklayınca LOAD_TASK gönderir', async () => {
    const sent: string[] = [];
    vscode.postMessage = (message: unknown) => {
      const typed = message as { type: string };
      sent.push(typed.type);
      if (typed.type === 'GET_TASK_HISTORY') {
        setTimeout(() => {
          window.postMessage({ type: 'TASK_HISTORY_LOADED', payload: { history: SESSIONS } }, '*');
        }, 0);
      }
    };
    render(<HistoryView onBack={() => {}} />);
    await waitFor(() => assert.ok(screen.getByText('Ödeme akışını ekle')));

    fireEvent.click(screen.getByText('Ödeme akışını ekle'));
    assert.ok(sent.includes('LOAD_TASK'));
  });

  it('yeni sohbet düğmesi NEW_SESSION gönderir', async () => {
    const sent: string[] = [];
    vscode.postMessage = (message: unknown) => {
      const typed = message as { type: string };
      sent.push(typed.type);
      if (typed.type === 'GET_TASK_HISTORY') {
        setTimeout(() => {
          window.postMessage({ type: 'TASK_HISTORY_LOADED', payload: { history: SESSIONS } }, '*');
        }, 0);
      }
    };
    render(<HistoryView onBack={() => {}} />);
    await waitFor(() => assert.ok(screen.getByText('Ödeme akışını ekle')));

    fireEvent.click(screen.getByRole('button', { name: /Yeni sohbet/ }));
    assert.ok(sent.includes('NEW_SESSION'));
  });

  it('boş listede yönlendirici metin gösterir', async () => {
    vscode.postMessage = (message: unknown) => {
      const typed = message as { type: string };
      if (typed.type !== 'GET_TASK_HISTORY') return;
      setTimeout(() => {
        window.postMessage({ type: 'TASK_HISTORY_LOADED', payload: { history: [] } }, '*');
      }, 0);
    };
    render(<HistoryView onBack={() => {}} />);
    await waitFor(() => assert.ok(screen.getByText('Henüz oturum yok')));
  });
});
