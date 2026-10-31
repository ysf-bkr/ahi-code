import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  parseSessionArchive,
  serializeSessionArchive,
  serializeSessionMarkdown,
  SessionArchiveError,
  SESSION_ARCHIVE_SCHEMA
} from '@ahicode/core/core/memory/sessionArchive';
import { TaskState } from '@ahicode/core/shared/types';

function makeTask(overrides: Partial<TaskState> = {}): TaskState {
  return {
    id: 'session_1',
    prompt: 'Add a retry helper',
    mode: 'code',
    status: 'completed',
    messages: [
      { id: 'm1', role: 'user', content: 'Add a retry helper', timestamp: 1 },
      {
        id: 'm2',
        role: 'assistant',
        content: 'Done.',
        timestamp: 2,
        toolCalls: [
          {
            id: 't1',
            name: 'write_file',
            args: { path: 'src/retry.ts' },
            explanation: 'Create the helper',
            requiresApproval: true,
            status: 'completed',
            result: 'ok'
          }
        ]
      }
    ],
    stats: { totalTokens: 120, stepsCount: 3, filesModified: ['src/retry.ts'] },
    ...overrides
  };
}

describe('sessionArchive: JSON export/import', () => {
  it('reads back written archive', () => {
    const task = makeTask();
    const raw = serializeSessionArchive(task);
    const parsed = JSON.parse(raw);

    assert.strictEqual(parsed.schema, SESSION_ARCHIVE_SCHEMA);
    assert.strictEqual(parsed.version, 1);

    const restored = parseSessionArchive(raw);
    assert.strictEqual(restored.id, task.id);
    assert.strictEqual(restored.prompt, task.prompt);
    assert.strictEqual(restored.messages.length, 2);
    assert.strictEqual(restored.stats.filesModified[0], 'src/retry.ts');
    assert.strictEqual(restored.messages[1]?.toolCalls?.[0]?.name, 'write_file');
  });

  it('always sets imported session to idle and cancels pending tools', () => {
    const task = makeTask({
      status: 'waiting_approval',
      messages: [
        { id: 'm1', role: 'user', content: 'go', timestamp: 1 },
        {
          id: 'm2',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 't1',
              name: 'execute_command',
              args: { command: 'rm -rf build' },
              requiresApproval: true,
              status: 'pending'
            }
          ]
        }
      ]
    });

    const restored = parseSessionArchive(serializeSessionArchive(task));
    assert.strictEqual(restored.status, 'idle');
    assert.strictEqual(restored.pendingToolCall, undefined);
    assert.strictEqual(restored.pendingQuestion, undefined);
    assert.strictEqual(restored.checkpoints, undefined);
    assert.strictEqual(restored.messages[1]?.toolCalls?.[0]?.status, 'error');
    assert.match(restored.messages[1]?.toolCalls?.[0]?.error || '', /interrupted/i);
  });

  it('accepts bare (unwrapped) TaskState file', () => {
    const restored = parseSessionArchive(JSON.stringify(makeTask()));
    assert.strictEqual(restored.id, 'session_1');
  });

  it('gives understandable error for invalid JSON and empty session', () => {
    assert.throws(() => parseSessionArchive('not json'), SessionArchiveError);
    assert.throws(() => parseSessionArchive(JSON.stringify({ messages: [] })), /no messages/i);
    assert.throws(() => parseSessionArchive(JSON.stringify({ foo: 'bar' })), SessionArchiveError);
  });

  it('rejects newer archive version', () => {
    const raw = JSON.stringify({
      schema: SESSION_ARCHIVE_SCHEMA,
      version: 99,
      task: makeTask()
    });
    assert.throws(() => parseSessionArchive(raw), /newer version/i);
  });

  it('preserves plan info', () => {
    const task = makeTask({
      plan: {
        goal: 'Ship retry',
        updatedAt: 5,
        steps: [{ id: 's1', title: 'Add helper', status: 'completed', dependsOn: [] }]
      }
    });
    const restored = parseSessionArchive(serializeSessionArchive(task));
    assert.strictEqual(restored.plan?.goal, 'Ship retry');
    assert.strictEqual(restored.plan?.steps.length, 1);
  });
});

describe('sessionArchive: Markdown output', () => {
  it('includes task, messages and tool calls', () => {
    const markdown = serializeSessionMarkdown(makeTask());
    assert.match(markdown, /# AhiCode — Oturum/);
    assert.match(markdown, /Add a retry helper/);
    assert.match(markdown, /### Kullanıcı/);
    assert.match(markdown, /### AhiCode/);
    assert.match(markdown, /\*\*write_file\*\*/);
    assert.match(markdown, /src\/retry\.ts/);
  });

  it('does not add section when no file changes', () => {
    const markdown = serializeSessionMarkdown(
      makeTask({ stats: { totalTokens: 0, stepsCount: 0, filesModified: [] } })
    );
    assert.doesNotMatch(markdown, /## Değiştirilen dosyalar/);
  });
});
