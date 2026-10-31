/**
 * Bağımlılık grafikli paralel görev çizelgeleyici.
 *
 * Manager'ın orkestrasyon sözleşmesi burada yaşar: bir görev, bağımlıları
 * bitmeden başlamaz; bağımlısı başarısız olan görev çalıştırılmaz; birbirine
 * bağımlı olmayan görevler eşzamanlı koşar. Salt karar ve yürütme iskeleti
 * burada, işin kendisi çağırandadır — böylece hem ana ajanın
 * `run_parallel_tasks` aracı hem yönetici alt ajanın delege yolu aynı
 * deterministik kuralla çalışır.
 */

export interface TaskNode<T> {
  /** Çizge içindeki benzersiz kimlik; `dependsOn` bunu referanslar. */
  id: string;
  role: string;
  payload: T;
  /** Bu göreve başlamadan önce tamamlanması gereken görev kimlikleri. */
  dependsOn: string[];
}

export type TaskGraphStatus = 'completed' | 'failed' | 'skipped';

export interface TaskGraphResult<T> {
  task: TaskNode<T>;
  status: TaskGraphStatus;
  output: string;
}

export interface TaskGraphOptions<T> {
  /** Aynı anda çalışacak en fazla görev. */
  maxConcurrency: number;
  /** Görev durum değişiklikleri (UI bildirimi için). */
  onStatus?: (task: TaskNode<T>, status: 'started' | TaskGraphStatus) => void;
}

/** Kimlik tekrarı, bilinmeyen bağımlılık ve döngüleri doğrular. */
function validateGraph<T>(tasks: readonly TaskNode<T>[]): void {
  const ids = new Set<string>();
  for (const task of tasks) {
    if (!task.id) throw new Error('Every parallel task needs a non-empty id.');
    if (ids.has(task.id)) throw new Error(`Duplicate parallel task id: ${task.id}`);
    ids.add(task.id);
  }
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      if (!ids.has(dep)) {
        throw new Error(`Task "${task.id}" depends on unknown task id "${dep}".`);
      }
      if (dep === task.id) throw new Error(`Task "${task.id}" cannot depend on itself.`);
    }
  }
  // DFS ile döngü kontrolü: bağımlılık çizgesi yönüzlü döngüsüz olmalı.
  const visiting = new Set<string>();
  const done = new Set<string>();
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visit = (id: string): void => {
    if (done.has(id)) return;
    if (visiting.has(id)) throw new Error(`Dependency cycle detected at task "${id}".`);
    visiting.add(id);
    const task = byId.get(id);
    for (const dep of task?.dependsOn ?? []) visit(dep);
    visiting.delete(id);
    done.add(id);
  };
  for (const task of tasks) visit(task.id);
}

/**
 * Görevleri bağımlılık sırasına göre çalıştırır.
 *
 * `run` fırlatırsa görev başarısız sayılır ve bağımlıları atlanır; sonuç
 * haritası her görev için bir kayıt içerir, çağıran özetlemeyi kendisi yapar.
 */
export async function runTaskGraph<T>(
  tasks: readonly TaskNode<T>[],
  run: (task: TaskNode<T>) => Promise<string>,
  options: TaskGraphOptions<T>
): Promise<TaskGraphResult<T>[]> {
  if (tasks.length === 0) return [];
  validateGraph(tasks);

  const maxConcurrency = Math.max(1, options.maxConcurrency);
  const results = new Map<string, TaskGraphResult<T>>();
  const remaining = [...tasks];
  const running = new Map<string, Promise<void>>();

  const settle = (task: TaskNode<T>, status: TaskGraphStatus, output: string): void => {
    results.set(task.id, { task, status, output });
    options.onStatus?.(task, status);
  };

  const blockedBy = (task: TaskNode<T>): TaskGraphResult<T> | undefined =>
    task.dependsOn.map((dep) => results.get(dep)).find((result) => result && result.status !== 'completed');

  while (remaining.length > 0 || running.size > 0) {
    // Bağımlıları hazır görevleri slot varsa başlat.
    for (let index = remaining.length - 1; index >= 0; index--) {
      if (running.size >= maxConcurrency) break;
      const task = remaining[index];
      if (!task) continue;
      const ready = task.dependsOn.every((dep) => results.get(dep)?.status === 'completed');
      const blocker = blockedBy(task);
      if (blocker) {
        remaining.splice(index, 1);
        settle(task, 'skipped', `Skipped: dependency "${blocker.task.id}" did not complete successfully.`);
        continue;
      }
      if (!ready) continue;
      remaining.splice(index, 1);
      options.onStatus?.(task, 'started');
      const promise = run(task)
        .then((output) => settle(task, 'completed', output))
        .catch((err: unknown) => settle(task, 'failed', err instanceof Error ? err.message : String(err)))
        .finally(() => {
          running.delete(task.id);
        });
      running.set(task.id, promise);
    }

    if (running.size > 0) {
      await Promise.race(running.values());
      continue;
    }
    // Başlatılacak görev yok ama kalan görevler var: çizge doğrulandığı için
    // bu yalnızca girdi boş kaldığında görülür; sonsuz döngüyü kes.
    if (remaining.length > 0) {
      for (const task of remaining.splice(0, remaining.length)) {
        settle(task, 'skipped', 'Skipped: dependencies could not be satisfied.');
      }
    }
  }

  // Girdi sırasını koru: raporlama deterministik kalsın.
  return tasks
    .map((task) => results.get(task.id))
    .filter((result): result is TaskGraphResult<T> => Boolean(result));
}

/** Çizge sonuçlarını modele/rapora verilecek düz metne çevirir. */
export function formatTaskGraphResults<T>(results: readonly TaskGraphResult<T>[]): string {
  return results
    .map((result) => `## Task ${result.task.id} (${result.task.role}) — ${result.status}\n${result.output}`)
    .join('\n\n');
}
