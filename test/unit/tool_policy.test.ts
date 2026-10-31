import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { ALL_TOOLS } from '@ahicode/core/tools';
import { policyFor, targetPathFor } from '@ahicode/core/core/permission/toolPolicy';

/**
 * Politika girdisi olmayan bir araç `unknown`'a düşer; bu da her şey için
 * onay gerektirir. Güvenli ama gözden kaçması kolay olduğundan, bu test
 * kayıt defterine politikasız araç eklemeyi build hatası yapar.
 */
describe('toolPolicy: every tool has an explicit policy', () => {
  it('covers all registered tools', () => {
    const missing = Object.keys(ALL_TOOLS).filter((name) => policyFor(name as never) === 'unknown');
    assert.deepStrictEqual(missing, [], `Add a policy for: ${missing.join(', ')}`);
  });

  it('classifies read-only and mutating tools correctly', () => {
    assert.strictEqual(policyFor('read_file'), 'read');
    assert.strictEqual(policyFor('write_file'), 'write');
    assert.strictEqual(policyFor('git_commit'), 'git-write');
    assert.strictEqual(policyFor('execute_command'), 'command');
    assert.strictEqual(policyFor('web_fetch'), 'always');
    assert.strictEqual(policyFor('update_plan'), 'never');
  });

  it('reads the path field that allow lists match against', () => {
    assert.strictEqual(targetPathFor('read_file', { path: 'src/a.ts' }), 'src/a.ts');
    assert.strictEqual(targetPathFor('read_skill', { skill_name: 'code-quality' }), 'code-quality');
    assert.strictEqual(targetPathFor('update_plan', { steps: [] }), '');
  });
});
