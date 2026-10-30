import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { ModulePlanner, ModulePlanValidationError } from '../../src/core/plan/ModulePlanner';

/**
 * Endüstriyel modül haritası sözleşmeleri:
 * 1. Katman yönü korunur (alan katmanı arayüze bağlanamaz).
 * 2. Döngüsel bağımlılık reddedilir.
 * 3. Yazma sırası alt katmandan üst katmana doğrudur.
 */
describe('ModulePlanner: katmanlı modül haritası', () => {
  it('modülleri katman sırasına göre dizer', () => {
    const planner = new ModulePlanner();
    planner.update({
      goal: 'Sipariş akışı',
      modules: [
        {
          id: 'ui',
          name: 'Arayüz',
          layer: 'interface',
          paths: ['src/ui'],
          responsibility: 'Ekranı çizer',
          dependsOn: ['app']
        },
        {
          id: 'app',
          name: 'Uygulama',
          layer: 'application',
          paths: ['src/app'],
          responsibility: 'Akışı yönetir',
          dependsOn: ['domain-service']
        },
        {
          id: 'domain-service',
          name: 'Alan servisi',
          layer: 'domain',
          paths: ['src/domain'],
          responsibility: 'İş kuralları',
          dependsOn: ['shared-utils']
        },
        {
          id: 'shared-utils',
          name: 'Yardımcılar',
          layer: 'shared',
          paths: ['src/shared'],
          responsibility: 'Ortak yardımcılar'
        }
      ]
    });

    assert.deepStrictEqual(
      planner.getBuildOrder().map((module) => module.id),
      ['shared-utils', 'domain-service', 'app', 'ui']
    );
  });

  it('katman yönü ihlalini reddeder (alan → arayüz)', () => {
    const planner = new ModulePlanner();
    assert.throws(
      () =>
        planner.update({
          modules: [
            {
              id: 'domain-core',
              name: 'Alan',
              layer: 'domain',
              paths: ['src/domain'],
              responsibility: 'Kurallar',
              dependsOn: ['ui']
            },
            {
              id: 'ui',
              name: 'Arayüz',
              layer: 'interface',
              paths: ['src/ui'],
              responsibility: 'Ekran'
            }
          ]
        }),
      (error: unknown) =>
        error instanceof ModulePlanValidationError && /Layering violation/.test(error.message)
    );
  });

  it('döngüsel bağımlılığı reddeder', () => {
    const planner = new ModulePlanner();
    assert.throws(
      () =>
        planner.update({
          modules: [
            {
              id: 'a',
              name: 'A',
              layer: 'application',
              paths: ['src/a'],
              responsibility: 'A',
              dependsOn: ['b']
            },
            {
              id: 'b',
              name: 'B',
              layer: 'application',
              paths: ['src/b'],
              responsibility: 'B',
              dependsOn: ['a']
            }
          ]
        }),
      (error: unknown) =>
        error instanceof ModulePlanValidationError && /Circular module dependency/.test(error.message)
    );
  });

  it('yol ve sorumluluk alanlarını zorunlu tutar', () => {
    const planner = new ModulePlanner();
    assert.throws(
      () =>
        planner.update({
          modules: [{ id: 'x', name: 'X', layer: 'domain', paths: [], responsibility: 'X' }]
        }),
      ModulePlanValidationError
    );
    assert.throws(
      () =>
        planner.update({
          modules: [{ id: 'x', name: 'X', layer: 'domain', paths: ['src/x'], responsibility: '' }]
        }),
      ModulePlanValidationError
    );
  });

  it('bilinmeyen katmanı reddeder', () => {
    const planner = new ModulePlanner();
    assert.throws(
      () =>
        planner.update({
          modules: [{ id: 'x', name: 'X', layer: 'service', paths: ['src/x'], responsibility: 'X' }]
        }),
      ModulePlanValidationError
    );
  });

  it('prompt çıktısında yazma sırasını ve katman kuralını yazar', () => {
    const planner = new ModulePlanner();
    planner.update({
      goal: 'Sipariş',
      modules: [
        {
          id: 'ui',
          name: 'Arayüz',
          layer: 'interface',
          paths: ['src/ui'],
          responsibility: 'Ekran',
          dependsOn: ['core'],
          ownerRole: 'frontend'
        },
        {
          id: 'core',
          name: 'Çekirdek',
          layer: 'domain',
          paths: ['src/core'],
          responsibility: 'Kurallar',
          ownerRole: 'backend'
        }
      ]
    });

    const prompt = planner.formatForPrompt();
    assert.match(prompt, /MODULE MAP/);
    assert.match(prompt, /1\. \[domain\] core/);
    assert.match(prompt, /2\. \[interface\] ui/);
    assert.match(prompt, /lower layers first/i);
  });
});
