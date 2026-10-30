import './setupDom';
import { afterEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ModuleStrip } from '../src/components/ModuleStrip';
import type { ModulePlan } from '@shared/types';

afterEach(() => cleanup());

const modulePlan: ModulePlan = {
  goal: 'Sipariş akışı',
  updatedAt: 1,
  modules: [
    {
      id: 'ui',
      name: 'Sipariş ekranı',
      layer: 'interface',
      paths: ['src/ui/order.tsx'],
      responsibility: 'Ekranı çizer',
      dependsOn: ['app'],
      ownerRole: 'frontend',
      criteria: ['ac-1']
    },
    {
      id: 'core',
      name: 'Sipariş kuralları',
      layer: 'domain',
      paths: ['src/domain/order.ts'],
      responsibility: 'İş kuralları',
      dependsOn: [],
      ownerRole: 'backend',
      criteria: ['ac-2']
    }
  ]
};

describe('ModuleStrip: katmanlı modül haritası', () => {
  it('modülleri katman sırasına göre listeler ve rolü gösterir', () => {
    render(<ModuleStrip modules={modulePlan} building />);

    assert.match(screen.getByText(/2 modül/).textContent ?? '', /2 modül/);
    fireEvent.click(screen.getByRole('button', { name: /Sipariş akışı/ }));

    const items = screen.getAllByRole('listitem');
    assert.equal(items.length, 2);
    // Alan katmanı arayüzden önce yazılır.
    assert.match(items[0].textContent ?? '', /Sipariş kuralları/);
    assert.match(items[0].textContent ?? '', /@backend/);
    assert.match(items[1].textContent ?? '', /Sipariş ekranı/);
    assert.match(items[1].textContent ?? '', /@frontend/);
  });

  it('plan gelmeden "kod öncesi" uyarısını gösterir', () => {
    render(<ModuleStrip modules={modulePlan} building={false} />);
    assert.ok(screen.getByText('kod öncesi'));
  });

  it('modül haritası yoksa hiçbir şey çizmez', () => {
    const { container } = render(<ModuleStrip building />);
    assert.equal(container.firstChild, null);
  });
});
