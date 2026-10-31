import * as vscode from 'vscode';
import { TaskState, TaskSummary } from '@ahicode/core/shared/types';
import { logWarning } from '@ahicode/core/shared/logging';
import {
  parseSessionArchive,
  serializeSessionArchive,
  serializeSessionMarkdown
} from '@ahicode/core/core/memory/sessionArchive';

export type SessionExportFormat = 'json' | 'markdown';

export class HistoryManager {
  private static readonly STORAGE_KEY = 'ahi_code_task_history_v1';
  private static readonly MAX_SAVED_TASKS = 50;

  constructor(private context: vscode.ExtensionContext) {}

  /**
   * Uzun turlar araç başına durum kaydediyor; her kayıt tüm oturumu
   * serileştiriyordu. Çağrılar kısa bir pencerede tek yazıma indirgenir ve
   * çağırana dönen söz gerçek yazım bittiğinde çözülür — son durum asla
   * kaybolmaz, disk/kayıt trafiği ise onda bire iner.
   */
  private static readonly COALESCE_WINDOW_MS = 120;
  private latestTask = new Map<string, TaskState>();
  private flushTimer = new Map<string, ReturnType<typeof setTimeout>>();
  private writeChain = new Map<string, Promise<void>>();
  private waiters = new Map<string, Array<() => void>>();

  public async saveTask(task: TaskState): Promise<void> {
    if (!task.id || task.messages.length === 0) return;
    this.latestTask.set(task.id, task);
    return new Promise<void>((resolve) => {
      const pending = this.waiters.get(task.id) ?? [];
      pending.push(resolve);
      this.waiters.set(task.id, pending);
      if (!this.flushTimer.has(task.id)) {
        this.flushTimer.set(
          task.id,
          setTimeout(() => {
            void this.flushTask(task.id);
          }, HistoryManager.COALESCE_WINDOW_MS)
        );
      }
    });
  }

  private async flushTask(taskId: string): Promise<void> {
    this.flushTimer.delete(taskId);
    const task = this.latestTask.get(taskId);
    this.latestTask.delete(taskId);
    const previous = this.writeChain.get(taskId) ?? Promise.resolve();
    const next = previous.then(async () => {
      if (task) await this.writeTask(task);
    });
    this.writeChain.set(
      taskId,
      next.then(
        () => undefined,
        () => undefined
      )
    );
    try {
      await next;
    } catch (err) {
      // Depolama hatası döngüyü kırmaz; çağıran eski sözleşmede olduğu gibi
      // uyarıyla yaşar (AgentCore.saveCurrentState loglar, burada da izi kalsın).
      logWarning('Session persistence failed', err);
    } finally {
      const waiting = this.waiters.get(taskId) ?? [];
      this.waiters.delete(taskId);
      for (const resolve of waiting) resolve();
    }
  }

  private async writeTask(task: TaskState): Promise<void> {
    // Görevin tamamını kaydet
    await this.context.workspaceState.update(`ahi_task_${task.id}`, task);

    // Özet listesini güncelle
    const summaries = this.getSummaries();
    const existingIndex = summaries.findIndex((s) => s.id === task.id);

    const summary: TaskSummary = {
      id: task.id,
      prompt: task.prompt,
      timestamp: Date.now(),
      messageCount: task.messages.length,
      status: task.status
    };

    if (existingIndex >= 0) {
      summaries[existingIndex] = summary;
    } else {
      summaries.unshift(summary);
    }

    // Saklanan görev sayısını sınırla
    const trimmed = summaries.slice(0, HistoryManager.MAX_SAVED_TASKS);
    const removed = summaries.slice(HistoryManager.MAX_SAVED_TASKS);
    for (const old of removed) {
      // Depolama şişmesini önlemek için özet listesinden düşen görevlerin tam kayıtlarını da sil.
      await this.context.workspaceState.update(`ahi_task_${old.id}`, undefined);
    }
    await this.context.workspaceState.update(HistoryManager.STORAGE_KEY, trimmed);
  }

  public getSummaries(): TaskSummary[] {
    return this.context.workspaceState.get<TaskSummary[]>(HistoryManager.STORAGE_KEY) || [];
  }

  public getTask(taskId: string): TaskState | undefined {
    return this.context.workspaceState.get<TaskState>(`ahi_task_${taskId}`);
  }

  public async deleteTask(taskId: string): Promise<void> {
    await this.context.workspaceState.update(`ahi_task_${taskId}`, undefined);
    const summaries = this.getSummaries().filter((s) => s.id !== taskId);
    await this.context.workspaceState.update(HistoryManager.STORAGE_KEY, summaries);
  }

  /**
   * İndirilmek üzere saklanan oturumu serileştirir. Görev artık yoksa
   * `undefined` döndürür.
   */
  public exportSession(taskId: string, format: SessionExportFormat): string | undefined {
    const task = this.getTask(taskId);
    if (!task) return undefined;
    return format === 'markdown' ? serializeSessionMarkdown(task) : serializeSessionArchive(task);
  }

  /**
   * Bir oturum arşivini içe aktarır ve benzersiz bir kimlik atar; böylece
   * içe aktarma mevcut bir oturumun üzerine yazmaz.
   */
  public async importSession(raw: string): Promise<{ task: TaskState; summary: TaskSummary }> {
    const task = parseSessionArchive(raw);
    const baseId = task.id || `imported_${Date.now()}`;
    let candidate = baseId;
    let suffix = 1;
    while (this.getTask(candidate)) {
      candidate = `${baseId}_import${suffix}`;
      suffix++;
    }

    task.id = candidate;
    if (!task.prompt) {
      const firstUser = task.messages.find((message) => message.role === 'user');
      task.prompt = firstUser?.content.slice(0, 200) || `Imported session ${candidate}`;
    }

    await this.saveTask(task);
    return {
      task,
      summary: {
        id: task.id,
        prompt: task.prompt,
        timestamp: Date.now(),
        messageCount: task.messages.length,
        status: task.status
      }
    };
  }
}
