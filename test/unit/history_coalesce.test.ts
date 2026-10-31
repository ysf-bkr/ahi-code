import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { HistoryManager } from '../../src/core/memory/HistoryManager';
import type { TaskState } from '@ahicode/core/shared/types';

/** workspaceState güncellemelerini sayan sahte eklenti bağlamı. */
function fakeContext() {
  const store = new Map<string, unknown>();
  const writes: string[] = [];
  return {
    writes,
    context: {
      workspaceState: {
        get: (key: string) => store.get(key),
        update: async (key: string, value: unknown) => {
          writes.push(key);
          if (value === undefined) store.delete(key);
          else store.set(key, value);
        }
      }
    }
  };
}

function taskWith(messageCount: number): TaskState {
  return {
    id: 'sess-1',
    prompt: 'görev',
    mode: 'code',
    status: 'running',
    messages: Array.from({ length: messageCount }, (_, i) => ({
      id: `m${i}`,
      role: 'assistant' as const,
      content: `mesaj ${i}`,
      timestamp: i
    })),
    stats: { totalTokens: 0, stepsCount: 0, filesModified: [] }
  } as unknown as TaskState;
}

describe('HistoryManager: eşleştirilmiş oturum yazımı', () => {
  it('eşzamanlı kayıtlar tek yazıma iner ve son durum diske geçer', async () => {
    const { writes, context } = fakeContext();
    const manager = new HistoryManager(context as never);

    const saves = Array.from({ length: 10 }, (_, i) => manager.saveTask(taskWith(i + 1)));
    await Promise.all(saves);

    const taskWrites = writes.filter((key) => key === 'ahi_task_sess-1');
    assert.ok(taskWrites.length <= 2, `yazımlar eşleşmeliydi, ${taskWrites.length} yazım oldu`);

    const saved = context.workspaceState.get('ahi_task_sess-1') as TaskState | undefined;
    assert.ok(saved, 'oturum kaydı bulunmalı');
    assert.strictEqual(saved.messages.length, 10, 'son durum eksiksiz yazılmalı');
  });

  it('ardışık bekleme yapılan kayıtların her biri tamamlanır', async () => {
    const { context } = fakeContext();
    const manager = new HistoryManager(context as never);
    await manager.saveTask(taskWith(1));
    await manager.saveTask(taskWith(3));
    const saved = context.workspaceState.get('ahi_task_sess-1') as TaskState;
    assert.strictEqual(saved.messages.length, 3);
    const summaries = manager.getSummaries();
    assert.strictEqual(summaries[0]?.messageCount, 3);
  });
});
