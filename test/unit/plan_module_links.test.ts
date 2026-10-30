import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { ModulePlanner } from '../../src/core/plan/ModulePlanner';
import { TaskPlanner } from '../../src/core/plan/TaskPlanner';

/**
 * Plan ↔ modül ↔ kriter bağı.
 *
 * Endüstriyel akışta plan, modül haritasından türetilir: her adım bir modüle
 * ve en az bir kabul kriterine bağlıdır. Bu bağ kurulmazsa plan, sözleşmeye
 * bağlı bir yol haritası değil, serbest bir yapılacaklar listesi olur.
 */
describe('TaskPlanner: modül ve kriter bağı', () => {
  function setup() {
    const modules = new ModulePlanner();
    modules.update({
      modules: [
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
    return {
      modules: new Set(['core']),
      criteria: new Set(['ac-1', 'ac-2']),
      planner: new TaskPlanner()
    };
  }

  it('modüle bağlı adımı kabul eder', () => {
    const { modules, criteria, planner } = setup();
    const plan = planner.update({
      goal: 'İş',
      steps: [{ title: 'Yaz', moduleId: 'core', criteria: ['ac-1'] }],
      validation: { moduleIds: modules, criteriaIds: criteria, requireModule: true, requireCriteria: true }
    });

    assert.strictEqual(plan.steps[0]?.moduleId, 'core');
    assert.deepStrictEqual(plan.steps[0]?.criteria, ['ac-1']);
  });

  it('modülsüz adımı reddeder', () => {
    const { modules, criteria, planner } = setup();
    assert.throws(
      () =>
        planner.update({
          steps: [{ title: 'Yaz' }],
          validation: { moduleIds: modules, criteriaIds: criteria, requireModule: true }
        }),
      /must reference a moduleId/
    );
  });

  it('bilinmeyen modül kimliğini reddeder', () => {
    const { modules, criteria, planner } = setup();
    assert.throws(
      () =>
        planner.update({
          steps: [{ title: 'Yaz', moduleId: 'yok' }],
          validation: { moduleIds: modules, criteriaIds: criteria }
        }),
      /unknown module/
    );
  });

  it('bilinmeyen kriter kimliğini reddeder', () => {
    const { modules, criteria, planner } = setup();
    assert.throws(
      () =>
        planner.update({
          steps: [{ title: 'Yaz', moduleId: 'core', criteria: ['ac-9'] }],
          validation: { moduleIds: modules, criteriaIds: criteria }
        }),
      /unknown acceptance criterion/
    );
  });

  it('kriter zorunluysa boş kriter listesini reddeder', () => {
    const { modules, criteria, planner } = setup();
    assert.throws(
      () =>
        planner.update({
          steps: [{ title: 'Yaz', moduleId: 'core' }],
          validation: { moduleIds: modules, criteriaIds: criteria, requireCriteria: true }
        }),
      /acceptance criterion/
    );
  });
});
