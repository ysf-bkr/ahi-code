import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  runTaskGraph,
  formatTaskGraphResults,
  type TaskNode,
  type TaskGraphResult
} from '../../src/core/multiagent/parallelScheduler';

function nodes(defs: Array<[string, string[]]>): TaskNode<string>[] {
  return defs.map(([id, dependsOn]) => ({ id, role: id, payload: id, dependsOn }));
}

describe('parallelScheduler: dependency ordering', () => {
  it('starts a dependent task only after its dependency completes', async () => {
    const order: string[] = [];
    const results = await runTaskGraph(
      nodes([
        ['b', ['a']],
        ['a', []]
      ]),
      async (task) => {
        order.push(task.id);
        return `${task.id} done`;
      },
      { maxConcurrency: 1 }
    );
    assert.deepStrictEqual(order, ['a', 'b']);
    assert.strictEqual(results[0]?.task.id, 'b');
    assert.ok(results.every((r) => r.status === 'completed'));
  });

  it('skips a task whose dependency failed', async () => {
    const results = await runTaskGraph(
      nodes([
        ['a', []],
        ['b', ['a']],
        ['c', ['b']]
      ]),
      async (task) => {
        if (task.id === 'a') throw new Error('boom');
        return `${task.id} done`;
      },
      { maxConcurrency: 2 }
    );
    const byId = new Map(results.map((r) => [r.task.id, r]));
    assert.strictEqual(byId.get('a')?.status, 'failed');
    assert.strictEqual(byId.get('b')?.status, 'skipped');
    assert.strictEqual(byId.get('c')?.status, 'skipped');
  });

  it('runs independent tasks concurrently up to the limit', async () => {
    let active = 0;
    let peak = 0;
    await runTaskGraph(
      nodes([
        ['a', []],
        ['b', []],
        ['c', []],
        ['d', []]
      ]),
      async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return 'ok';
      },
      { maxConcurrency: 2 }
    );
    assert.ok(peak <= 2, `concurrency peaked at ${peak}, expected <= 2`);
    assert.ok(peak >= 2, 'independent tasks should overlap');
  });

  it('preserves input order in results regardless of completion order', async () => {
    const results = await runTaskGraph(
      nodes([
        ['slow', []],
        ['fast', []]
      ]),
      async (task) => {
        await new Promise((resolve) => setTimeout(resolve, task.id === 'slow' ? 15 : 1));
        return task.id;
      },
      { maxConcurrency: 4 }
    );
    assert.deepStrictEqual(
      results.map((r) => r.task.id),
      ['slow', 'fast']
    );
  });
});

describe('parallelScheduler: graph validation', () => {
  it('rejects an unknown dependency id', async () => {
    await assert.rejects(
      () => runTaskGraph(nodes([['a', ['ghost']]]), async () => 'x', { maxConcurrency: 2 }),
      /unknown task id/i
    );
  });

  it('rejects a dependency cycle', async () => {
    await assert.rejects(
      () =>
        runTaskGraph(
          nodes([
            ['a', ['b']],
            ['b', ['a']]
          ]),
          async () => 'x',
          { maxConcurrency: 2 }
        ),
      /cycle/i
    );
  });

  it('rejects duplicate ids', async () => {
    const dup: TaskNode<string>[] = [
      { id: 'a', role: 'a', payload: '', dependsOn: [] },
      { id: 'a', role: 'a', payload: '', dependsOn: [] }
    ];
    await assert.rejects(() => runTaskGraph(dup, async () => 'x', { maxConcurrency: 2 }), /duplicate/i);
  });

  it('formats results with id, role and status', () => {
    const results: TaskGraphResult<string>[] = [
      { task: { id: 't1', role: 'backend', payload: '', dependsOn: [] }, status: 'completed', output: 'done' }
    ];
    const text = formatTaskGraphResults(results);
    assert.ok(text.includes('t1'));
    assert.ok(text.includes('backend'));
    assert.ok(text.includes('completed'));
  });
});
