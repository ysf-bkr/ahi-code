import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { ALL_TOOLS } from '@ahicode/core/tools';
import { coerceToolArguments, validateToolArguments } from '@ahicode/core/tools/base';

describe('Tool argument schema validation', () => {
  it('validates nested plan steps', () => {
    const tool = ALL_TOOLS.update_plan;
    assert.strictEqual(
      validateToolArguments(tool, {
        goal: 'Hedef',
        steps: [{ title: 'Adım', status: 'pending', dependsOn: [] }]
      }),
      undefined
    );

    const invalidStatus = validateToolArguments(tool, {
      steps: [{ title: 'Adım', status: 'gecersiz' }]
    });
    assert.ok(invalidStatus?.includes('Invalid value'));

    const invalidArray = validateToolArguments(tool, { steps: 'adım' });
    assert.ok(invalidArray?.includes('array'));
  });

  it('coerces string numbers and booleans according to the schema', () => {
    const readArgs = coerceToolArguments(ALL_TOOLS.read_file, {
      path: 'a.txt',
      offset: '10',
      limit: '5'
    });
    assert.strictEqual(readArgs.offset, 10);
    assert.strictEqual(readArgs.limit, 5);

    const editArgs = coerceToolArguments(ALL_TOOLS.edit_file, {
      path: 'a.txt',
      targetText: 'x',
      replacementText: 'y',
      allowMultiple: 'true'
    });
    assert.strictEqual(editArgs.allowMultiple, true);
  });

  it('rejects values whose type does not match the schema', () => {
    const badPath = validateToolArguments(ALL_TOOLS.read_file, { path: 5 });
    assert.ok(badPath?.includes('must be a string'));

    const badNumber = validateToolArguments(ALL_TOOLS.read_file, { path: 'a.txt', offset: 'on' });
    assert.ok(badNumber?.includes('must be a number'));

    const badBoolean = validateToolArguments(ALL_TOOLS.edit_file, {
      path: 'a.txt',
      targetText: 'x',
      replacementText: 'y',
      allowMultiple: 'yes'
    });
    assert.ok(badBoolean?.includes('must be a boolean'));
  });

  it('catches a missing nested field', () => {
    const error = validateToolArguments(ALL_TOOLS.update_plan, {
      steps: [{ status: 'pending' }]
    });
    assert.ok(error?.includes('title'));
  });
});
