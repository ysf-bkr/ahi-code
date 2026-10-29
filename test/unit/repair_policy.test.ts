import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { decideRepair } from '../../src/core/verification/repairPolicy';

const base = {
  status: 'failed' as const,
  newFailures: ['typecheck:TS2345'],
  hasBaseline: false,
  attempts: 0,
  maxAttempts: 2
};

describe('repairPolicy: bounded verification repair', () => {
  it('retries while the budget allows it', () => {
    assert.deepStrictEqual(decideRepair(base), {
      action: 'retry',
      attempts: 1,
      reason: 'new-failures'
    });
    assert.deepStrictEqual(decideRepair({ ...base, attempts: 1 }), {
      action: 'retry',
      attempts: 2,
      reason: 'new-failures'
    });
  });

  it('aborts once the budget is exhausted', () => {
    assert.deepStrictEqual(decideRepair({ ...base, attempts: 2 }), {
      action: 'abort',
      reason: 'budget-exhausted'
    });
  });

  it('does not spend the budget on pre-existing failures', () => {
    assert.deepStrictEqual(decideRepair({ ...base, hasBaseline: true, newFailures: [] }), {
      action: 'proceed',
      reason: 'only-preexisting'
    });
  });

  it('treats failures as new when there is no baseline', () => {
    assert.strictEqual(decideRepair({ ...base, newFailures: [] }).action, 'retry');
  });

  it('proceeds when verification passed or was skipped', () => {
    assert.deepStrictEqual(decideRepair({ ...base, status: 'passed' }), {
      action: 'proceed',
      reason: 'passed'
    });
    assert.deepStrictEqual(decideRepair({ ...base, status: 'skipped' }), {
      action: 'proceed',
      reason: 'skipped'
    });
  });

  it('never retries when the configured budget is zero', () => {
    assert.strictEqual(decideRepair({ ...base, maxAttempts: 0 }).action, 'abort');
    assert.strictEqual(decideRepair({ ...base, maxAttempts: -1 }).action, 'abort');
  });
});
