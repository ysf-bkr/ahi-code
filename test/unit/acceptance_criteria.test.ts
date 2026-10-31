import { describe, it, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { updateAcceptanceCriteriaTool } from '@ahicode/core/tools';
import { SpecStore } from '@ahicode/core/core/spec/SpecStore';
import { createWorkflowState } from '@ahicode/core/core/workflow/TaskWorkflow';

describe('update_acceptance_criteria: tool that opens the done gate', () => {
  let root: string;
  const roots: string[] = [];

  after(async () => {
    await Promise.all(roots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  async function setup() {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-criteria-'));
    roots.push(root);
    const specStore = new SpecStore();
    const spec = await specStore.create(root, {
      goal: 'Düğmeyi düzelt',
      scope: ['ui'],
      acceptanceCriteria: ['Düğme çalışır', 'Testler geçer']
    });
    const workflow = createWorkflowState({ stage: 'build', specId: spec.id, planApproved: true });
    return { specStore, spec, workflow };
  }

  it('marks criteria and updates completion status', async () => {
    const { specStore, spec, workflow } = await setup();
    const ids = spec.acceptanceCriteria.map((criterion) => criterion.id);
    assert.strictEqual(specStore.isComplete(spec.id), false);

    const result = await updateAcceptanceCriteriaTool.execute(
      { criteria: ids.map((id) => ({ id, done: true })) },
      { workspaceRoot: root, specStore, workflow }
    );

    assert.match(result, /2\/2 satisfied/);
    assert.strictEqual(
      specStore.isComplete(spec.id),
      true,
      'spec must be complete when all criteria are marked'
    );
  });

  it('tek kriteri geri alabilir', async () => {
    const { specStore, spec, workflow } = await setup();
    const [first, second] = spec.acceptanceCriteria.map((criterion) => criterion.id);
    assert.ok(first && second);

    await updateAcceptanceCriteriaTool.execute(
      {
        criteria: [
          { id: first, done: true },
          { id: second, done: true }
        ]
      },
      { workspaceRoot: root, specStore, workflow }
    );
    const result = await updateAcceptanceCriteriaTool.execute(
      { criteria: [{ id: second, done: false }] },
      { workspaceRoot: root, specStore, workflow }
    );

    assert.match(result, /1\/2 satisfied/);
    assert.match(result, new RegExp(`Still unchecked: ${second}`));
    assert.strictEqual(specStore.isComplete(spec.id), false);
  });

  it('lists valid criteria for unknown id', async () => {
    const { specStore, workflow } = await setup();
    await assert.rejects(
      updateAcceptanceCriteriaTool.execute(
        { criteria: [{ id: 'ac-999', done: true }] },
        { workspaceRoot: root, specStore, workflow }
      ),
      /Unknown criterion id/
    );
  });

  it('returns descriptive error for empty or invalid input', async () => {
    const { specStore, workflow } = await setup();
    await assert.rejects(
      updateAcceptanceCriteriaTool.execute({ criteria: [] }, { workspaceRoot: root, specStore, workflow }),
      /No valid criteria/
    );
    await assert.rejects(
      updateAcceptanceCriteriaTool.execute(
        { criteria: 'ac-1' },
        { workspaceRoot: root, specStore, workflow }
      ),
      /No valid criteria/
    );
  });

  it('aktif spec yoksa hata verir', async () => {
    const { specStore } = await setup();
    await assert.rejects(
      updateAcceptanceCriteriaTool.execute(
        { criteria: [{ id: 'ac-1', done: true }] },
        { workspaceRoot: root, specStore, workflow: createWorkflowState() }
      ),
      /no active spec/i
    );
  });
});
