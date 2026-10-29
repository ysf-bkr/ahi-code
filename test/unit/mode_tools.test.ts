import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { filterToolsForMode, isToolAllowedInMode } from '../../src/core/agent/modeTools';

const tools = [
  { name: 'read_file' },
  { name: 'write_file' },
  { name: 'execute_command' },
  { name: 'search_files' },
  { name: 'ask_followup_question' }
];

describe('Plan/Code mode tool lock', () => {
  it('plan mode allows only read-only tools', () => {
    assert.strictEqual(isToolAllowedInMode('read_file', 'plan'), true);
    assert.strictEqual(isToolAllowedInMode('search_files', 'plan'), true);
    assert.strictEqual(isToolAllowedInMode('write_file', 'plan'), false);
    assert.strictEqual(isToolAllowedInMode('edit_file', 'plan'), false);
    assert.strictEqual(isToolAllowedInMode('execute_command', 'plan'), false);
  });

  it('code mode allows all tools', () => {
    assert.strictEqual(isToolAllowedInMode('write_file', 'code'), true);
    assert.strictEqual(isToolAllowedInMode('execute_command', 'code'), true);
  });

  it('correctly filters tool list for plan', () => {
    const filtered = filterToolsForMode(tools, 'plan').map((t) => t.name);
    assert.deepStrictEqual(filtered, ['read_file', 'search_files', 'ask_followup_question']);
  });

  it('does not change list in code mode', () => {
    assert.strictEqual(filterToolsForMode(tools, 'code').length, tools.length);
  });
});
