import * as vscode from 'vscode';
import { TaskState, TaskSummary } from '../../shared/types';
import { parseSessionArchive, serializeSessionArchive, serializeSessionMarkdown } from './sessionArchive';

export type SessionExportFormat = 'json' | 'markdown';

export class HistoryManager {
  private static readonly STORAGE_KEY = 'ahi_code_task_history_v1';
  private static readonly MAX_SAVED_TASKS = 50;

  constructor(private context: vscode.ExtensionContext) {}

  public async saveTask(task: TaskState): Promise<void> {
    if (!task.id || task.messages.length === 0) return;

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
