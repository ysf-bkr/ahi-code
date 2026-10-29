import './setupDom';
import { afterEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NavigationSidebar } from '../src/components/NavigationSidebar';
import { MenuDestination } from '../src/components/MenuView';

afterEach(() => cleanup());

describe('NavigationSidebar: Sabit ve Açılıp Kapanabilen Yan Menü', () => {
  it('tüm 7 hedef için ikonları render eder', () => {
    render(
      <NavigationSidebar
        isOpen={false}
        onToggle={() => {}}
        activeDestination="chat"
        onSelect={() => {}}
        changedFileCount={0}
      />
    );

    assert.ok(screen.getByRole('complementary', { name: 'Sabit yan menü' }));
    assert.ok(screen.getByTitle(/Sohbet/));
    assert.ok(screen.getByTitle(/Değişiklikler/));
    assert.ok(screen.getByTitle(/Görev Geçmişi/));
    assert.ok(screen.getByTitle(/Ajanlar & Beceriler/));
    assert.ok(screen.getByTitle(/MCP Sunucuları/));
    assert.ok(screen.getByTitle(/Ayarlar/));
    assert.ok(screen.getByTitle(/Hakkında/));
  });

  it('açıkken başlıkları gösterir ve daralt düğmesi sunar', () => {
    let toggled = false;
    render(
      <NavigationSidebar
        isOpen={true}
        onToggle={() => {
          toggled = true;
        }}
        activeDestination="chat"
        onSelect={() => {}}
        changedFileCount={3}
      />
    );

    assert.ok(screen.getByText('Sohbet'));
    assert.ok(screen.getByText('Değişiklikler'));
    assert.ok(screen.getByText('Görev Geçmişi'));
    assert.ok(screen.getByText('3'), 'değişen dosya rozeti gösterilmeli');

    const toggleBtn = screen.getByRole('button', { name: 'Menüyü daralt' });
    fireEvent.click(toggleBtn);
    assert.strictEqual(toggled, true);
  });

  it('herhangi bir ikona tıklayınca doğrudan o ekrana geçiş bildirimi gönderir', () => {
    const selections: MenuDestination[] = [];
    render(
      <NavigationSidebar
        isOpen={false}
        onToggle={() => {}}
        activeDestination="chat"
        onSelect={(dest) => selections.push(dest)}
        changedFileCount={0}
      />
    );

    fireEvent.click(screen.getByTitle(/Ayarlar/));
    fireEvent.click(screen.getByTitle(/Görev Geçmişi/));
    assert.deepEqual(selections, ['settings', 'history']);
  });
});
