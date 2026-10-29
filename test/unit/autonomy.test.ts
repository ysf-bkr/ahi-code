import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  autonomyLevel,
  decideContinuation,
  MAX_AUTO_CONTINUATIONS,
  skipsApprovalGates
} from '../../src/core/agent/autonomy';
import { UserSettings } from '../../src/shared/types';

const base: UserSettings = {
  selectedProvider: 'ollama',
  selectedModel: 'llama3.1',
  apiKeys: {},
  autoApprove: { readFiles: true, writeFiles: false, executeCommands: false }
};

/** Otonomi seviyesi testleri.
 *
 * Kritik sözleşme: otonomi yalnızca akışı hızlandırır. Güvenlik onayları
 * (yazma/komut izni) hiçbir seviyede otomatikleşmez; o karar
 * `PermissionManager`'dadır ve bu modül onu etkilemez.
 */
describe('Autonomy: levels', () => {
  it('defaults to manual when unset or invalid', () => {
    assert.strictEqual(autonomyLevel(base), 'manual');
    assert.strictEqual(autonomyLevel({ ...base, autonomy: undefined }), 'manual');
  });

  it('reads guided and auto', () => {
    assert.strictEqual(autonomyLevel({ ...base, autonomy: 'guided' }), 'guided');
    assert.strictEqual(autonomyLevel({ ...base, autonomy: 'auto' }), 'auto');
  });

  it('skips approval gates only outside manual mode', () => {
    assert.strictEqual(skipsApprovalGates({ ...base, autonomy: 'manual' }), false);
    assert.strictEqual(skipsApprovalGates({ ...base, autonomy: 'guided' }), true);
    assert.strictEqual(skipsApprovalGates({ ...base, autonomy: 'auto' }), true);
  });
});

describe('Autonomy: continuation decisions', () => {
  const input = {
    level: 'auto' as const,
    continuations: 0,
    cancelled: false,
    finished: false,
    pendingApproval: false
  };

  it('continues an unfinished autonomous task', () => {
    assert.deepStrictEqual(decideContinuation(input), { action: 'continue', reason: 'not-finished' });
  });

  it('stops in manual and guided modes', () => {
    assert.strictEqual(decideContinuation({ ...input, level: 'manual' }).reason, 'manual-mode');
    assert.strictEqual(decideContinuation({ ...input, level: 'guided' }).reason, 'manual-mode');
  });

  it('stops when cancelled, finished, or waiting for approval', () => {
    assert.strictEqual(decideContinuation({ ...input, cancelled: true }).reason, 'cancelled');
    assert.strictEqual(decideContinuation({ ...input, finished: true }).reason, 'finished');
    assert.strictEqual(decideContinuation({ ...input, pendingApproval: true }).reason, 'pending-approval');
  });

  it('stops at the continuation budget instead of looping forever', () => {
    assert.strictEqual(
      decideContinuation({ ...input, continuations: MAX_AUTO_CONTINUATIONS }).reason,
      'budget'
    );
    assert.strictEqual(
      decideContinuation({ ...input, continuations: MAX_AUTO_CONTINUATIONS - 1 }).action,
      'continue'
    );
  });

  it('respects a custom continuation budget when configured', () => {
    assert.strictEqual(
      decideContinuation({ ...input, continuations: 5, maxContinuations: 5 }).reason,
      'budget'
    );
    assert.strictEqual(
      decideContinuation({ ...input, continuations: 4, maxContinuations: 5 }).action,
      'continue'
    );
  });
});
