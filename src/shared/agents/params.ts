/**
 * Alt ajan görev parametreleri.
 *
 * Ayrıştırıcı `shared` altında tutulur çünkü hem araç katmanı hem de
 * `SubagentManager` aynı doğrulamayı kullanır. `tools` altında tutmak,
 * yönetici delege ettiğinde `core -> tools -> core` döngüsü yaratıyordu.
 */

export interface SubagentTaskParams {
  role: string;
  task: string;
  context?: string;
  /** Doğruysa alt ajan ana çalışma alanı yerine yalıtılmış bir Git worktree'de çalışır. */
  isolate?: boolean;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * `invoke_subagent` argümanlarını doğrular; rol ve görev zorunludur.
 * Geçersiz bir çağrı sessizce boş rolle çalışmaz, açık hata verir.
 */
export function parseSubagentTaskParams(args: Record<string, unknown>): SubagentTaskParams {
  const role = asString(args.role).trim();
  const task = asString(args.task).trim();
  if (!role) throw new Error('Subagent role is required.');
  if (!task) throw new Error('Subagent task is required.');

  return {
    role,
    task,
    context: typeof args.context === 'string' ? args.context : undefined,
    isolate: args.isolate === true || args.isolate === 'true'
  };
}
