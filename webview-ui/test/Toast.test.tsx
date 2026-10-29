import './setupDom';
import { afterEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Toast } from '../src/components/Toast';

afterEach(() => cleanup());

describe('Toast', () => {
  it('mesajı ve düzeyi gösterir', () => {
    render(<Toast toast={{ id: 't1', level: 'warning', message: 'Onay bekleniyor' }} onDismiss={() => {}} />);
    assert.ok(screen.getByRole('status'));
    assert.ok(screen.getByText('Onay bekleniyor'));
  });

  it('erişilebilir kapatma düğmesi sunar', () => {
    render(<Toast toast={{ id: 't1', level: 'info', message: 'Kaydedildi' }} onDismiss={() => {}} />);
    assert.ok(screen.getByRole('button', { name: 'Bildirimi kapat' }));
  });

  it('kapatma geri çağrısını tetikler', () => {
    let dismissed = 0;
    render(
      <Toast toast={{ id: 't1', level: 'error', message: 'Hata' }} onDismiss={() => (dismissed += 1)} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Bildirimi kapat' }));
    assert.equal(dismissed, 1);
  });

  it('ekran okuyucular için canlı bölge olarak işaretler', () => {
    render(<Toast toast={{ id: 't1', level: 'info', message: 'x' }} onDismiss={() => {}} />);
    const node = screen.getByRole('status');
    assert.equal(node.getAttribute('aria-live'), 'polite');
  });
});
