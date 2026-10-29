import { PlanStep, PlanStepStatus, TaskPlan } from '../../shared/types';
import { assignPlanRoles } from '../../shared/agents/routing';

const VALID_STATUSES: ReadonlySet<PlanStepStatus> = new Set<PlanStepStatus>([
  'pending',
  'in_progress',
  'completed',
  'blocked'
]);

export interface PlanStepInput {
  id?: string;
  title?: string;
  description?: string;
  status?: PlanStepStatus;
  dependsOn?: string[];
  completionCriteria?: string;
  files?: string[];
  /** Bu adımı yürütecek uzman rol (ör. `backend`, `frontend`). */
  ownerRole?: string;
}

export interface PlanUpdateInput {
  goal?: string;
  steps?: PlanStepInput[];
}

const TURKISH_CHAR_MAP: Record<string, string> = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
  Ç: 'c',
  Ğ: 'g',
  İ: 'i',
  Ö: 'o',
  Ş: 's',
  Ü: 'u'
};

function slugify(value: string, index: number): string {
  const ascii = String(value || '')
    .split('')
    .map((char) => TURKISH_CHAR_MAP[char] ?? char)
    .join('')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');

  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || `step-${index + 1}`;
}

/**
 * Görev planlarını doğrular, bağımlılıkları çözer ve ajan bağlamı için biçimlendirir.
 * Planlar TaskState'te tutulur ve oturum geçmişiyle birlikte kalıcılaşır.
 */
export class TaskPlanner {
  private plan?: TaskPlan;

  public getPlan(): TaskPlan | undefined {
    return this.plan ? JSON.parse(JSON.stringify(this.plan)) : undefined;
  }

  public hydrate(plan?: TaskPlan): void {
    if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) {
      this.plan = undefined;
      return;
    }
    this.plan = {
      goal: plan.goal || '',
      steps: plan.steps.map((step) => ({
        id: step.id,
        title: step.title,
        description: step.description,
        status: VALID_STATUSES.has(step.status) ? step.status : 'pending',
        dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn : [],
        completionCriteria: step.completionCriteria,
        files: Array.isArray(step.files) ? step.files : undefined,
        ownerRole: typeof step.ownerRole === 'string' ? step.ownerRole : undefined,
        ownerRoleSource:
          step.ownerRoleSource === 'model' || step.ownerRoleSource === 'routing'
            ? step.ownerRoleSource
            : undefined
      })),
      updatedAt: plan.updatedAt || Date.now()
    };
  }

  /**
   * Modelden gelen planı normalize eder. Aynı kimliğe sahip mevcut adımların
   * durumunu korur; böylece model yalnızca başlıkları güncellediğinde
   * tamamlanmış adımlar sıfırlanmaz.
   */
  public update(input: PlanUpdateInput): TaskPlan {
    const previousById = new Map((this.plan?.steps || []).map((step) => [step.id, step]));
    const rawSteps = Array.isArray(input.steps) ? input.steps : [];
    if (rawSteps.length === 0) {
      throw new Error('A plan must contain at least one step.');
    }

    const usedIds = new Set<string>();
    const steps: PlanStep[] = rawSteps.map((raw, index) => {
      const title = String(raw.title || '').trim();
      if (!title) {
        throw new Error(`A title is required for plan step #${index + 1}.`);
      }

      let id = String(raw.id || '').trim() || slugify(title, index);
      let previous = previousById.get(id);

      // Model kimlik vermeden başlık değiştirirse adımı aynı konumda koru;
      // böylece tamamlanma durumu ve bağımlılık kimliği sabit kalır.
      if (!previous && !raw.id) {
        const indexed = this.plan?.steps[index];
        if (indexed && !usedIds.has(indexed.id)) {
          previous = indexed;
          id = indexed.id;
        }
      }

      // Kimlik çakışmalarını belirlenimci biçimde çöz.
      let suffix = 2;
      const baseId = id;
      while (usedIds.has(id)) {
        id = `${baseId}-${suffix++}`;
      }
      usedIds.add(id);

      const status =
        raw.status && VALID_STATUSES.has(raw.status) ? raw.status : previous?.status || 'pending';

      return {
        id,
        title,
        description: raw.description ? String(raw.description) : previous?.description,
        status,
        dependsOn: Array.isArray(raw.dependsOn)
          ? raw.dependsOn.map((dep) => String(dep)).filter(Boolean)
          : previous?.dependsOn || [],
        completionCriteria: raw.completionCriteria
          ? String(raw.completionCriteria)
          : previous?.completionCriteria,
        files: Array.isArray(raw.files) ? raw.files.map(String).filter(Boolean) : previous?.files,
        ownerRole: raw.ownerRole ? String(raw.ownerRole) : previous?.ownerRole,
        ownerRoleSource: raw.ownerRole ? 'model' : previous?.ownerRoleSource
      };
    });

    this.validateDependencies(steps);

    this.plan = {
      goal: String(input.goal ?? this.plan?.goal ?? '').trim(),
      steps,
      updatedAt: Date.now()
    };
    return this.getPlan()!;
  }

  public setStepStatus(stepId: string, status: PlanStepStatus): TaskPlan | undefined {
    if (!this.plan) return undefined;
    const step = this.plan.steps.find((s) => s.id === stepId);
    if (!step) return this.getPlan();
    if (!VALID_STATUSES.has(status)) return this.getPlan();
    step.status = status;
    this.plan.updatedAt = Date.now();
    return this.getPlan();
  }

  /**
   * Bağımlılıkları tamamlanmış ve henüz başlamamış adımlar.
   */
  public getReadySteps(): PlanStep[] {
    if (!this.plan) return [];
    const completed = new Set(this.plan.steps.filter((s) => s.status === 'completed').map((s) => s.id));
    return this.plan.steps.filter(
      (s) => s.status === 'pending' && s.dependsOn.every((dep) => completed.has(dep))
    );
  }

  public isComplete(): boolean {
    return Boolean(
      this.plan && this.plan.steps.length > 0 && this.plan.steps.every((s) => s.status === 'completed')
    );
  }

  public hasPlan(): boolean {
    return Boolean(this.plan && this.plan.steps.length > 0);
  }

  /**
   * Adımlara uzman rol atar (deterministik yönlendirme).
   *
   * Yöneticinin "kim ne yapacak" sorusunu modelin sezgisine bırakmamak için
   * çağrılır. Zaten geçerli bir rol atanmışsa korunur.
   */
  public assignRoles(): TaskPlan | undefined {
    if (!this.plan) return undefined;
    for (const step of this.plan.steps) {
      // Modelin açık atamasına dokunma; yalnızca eksik olanları doldur.
      if (step.ownerRole && step.ownerRoleSource !== 'routing') continue;
      const assignments = assignPlanRoles([{ ...step, ownerRole: undefined }]);
      const role = assignments[0]?.role;
      if (role) {
        step.ownerRole = role;
        step.ownerRoleSource = 'routing';
      }
    }
    this.plan.updatedAt = Date.now();
    return this.getPlan();
  }

  /** Plan adımları için rol atama özeti (yönetici prompt'u ve arayüz için). */
  public formatAssignments(): string {
    if (!this.plan) return '';
    return this.plan.steps
      .map((step) => {
        const role = step.ownerRole ?? 'atanmadı';
        const reason = step.ownerRoleSource === 'routing' ? 'yönlendirme' : 'model';
        return `- ${step.id}: @${role} (${reason})`;
      })
      .join('\n');
  }

  public clear(): void {
    this.plan = undefined;
  }

  /**
   * Model bağlamına eklenecek kısa plan özeti.
   */
  public formatForPrompt(): string {
    if (!this.plan) return '';
    const lines = this.plan.steps.map((step) => {
      const mark =
        step.status === 'completed'
          ? 'x'
          : step.status === 'in_progress'
            ? '~'
            : step.status === 'blocked'
              ? '!'
              : ' ';
      const deps = step.dependsOn.length > 0 ? ` [depends on: ${step.dependsOn.join(', ')}]` : '';
      const criteria = step.completionCriteria ? ` — Completion: ${step.completionCriteria}` : '';
      const owner = step.ownerRole ? ` — Owner: @${step.ownerRole}` : '';
      return `- [${mark}] ${step.id}: ${step.title}${deps}${criteria}${owner}`;
    });

    const ready = this.getReadySteps();
    const readyText = ready.length > 0 ? `\nSteps ready to start: ${ready.map((s) => s.id).join(', ')}` : '';

    return `\n\n=== ACTIVE TASK PLAN ===
Goal: ${this.plan.goal || '(not specified)'}
${lines.join('\n')}${readyText}

Plan rules:
- "~" marks a step currently in progress, "x" marks it completed, and "!" marks it blocked.
- When you finish a step, set its status to "completed" with the update_plan tool.
- Do not start a step until its dependencies are complete.
- Specialist subagents can only be executed via @manager. The main agent delegates orchestration to @manager, who invokes and coordinates the assigned ownerRoles.
=== END OF PLAN ===`;
  }

  public formatForTool(): string {
    if (!this.plan) return 'No active plan.';
    const counts = this.plan.steps.reduce<Record<string, number>>((acc, step) => {
      acc[step.status] = (acc[step.status] || 0) + 1;
      return acc;
    }, {});
    return [
      `Task plan updated: ${this.plan.goal || '(goal not specified)'}`,
      ...this.plan.steps.map((step) => {
        const deps = step.dependsOn.length ? ` (depends on: ${step.dependsOn.join(', ')})` : '';
        return `- [${step.status}] ${step.id}: ${step.title}${deps}`;
      }),
      `Summary: ${this.plan.steps.length} steps · ${counts.completed || 0} completed · ` +
        `${counts.in_progress || 0} in progress · ${counts.pending || 0} pending · ${counts.blocked || 0} blocked`
    ].join('\n');
  }

  private validateDependencies(steps: PlanStep[]): void {
    const idMap = new Map(steps.map((s) => [s.id.toLowerCase(), s.id]));
    for (const step of steps) {
      step.dependsOn = step.dependsOn.map((dep) => {
        const canonical = idMap.get(dep.toLowerCase());
        if (!canonical) {
          throw new Error(`Step "${step.id}" depends on an unknown step: "${dep}".`);
        }
        if (canonical === step.id) {
          throw new Error(`Step "${step.id}" cannot depend on itself.`);
        }
        return canonical;
      });
    }

    // Döngüleri tespit et: iteratif DFS.
    //
    // Adımlar modelden gelir ve sayısı önceden bilinmez; özyinelemeli DFS uzun
    // bir bağımlılık zincirinde "Maximum call stack size exceeded" verirdi.
    // Açık yığın sürümünde derinlik sınırı yoktur.
    const state = new Map<string, 'visiting' | 'visited'>();
    const byId = new Map(steps.map((s) => [s.id, s]));

    interface Frame {
      id: string;
      deps: string[];
      index: number;
    }

    for (const step of steps) {
      if (state.get(step.id) === 'visited') continue;

      const stack: Frame[] = [{ id: step.id, deps: byId.get(step.id)?.dependsOn ?? [], index: 0 }];
      state.set(step.id, 'visiting');

      while (stack.length > 0) {
        const frame = stack[stack.length - 1];
        if (!frame) break;

        if (frame.index >= frame.deps.length) {
          state.set(frame.id, 'visited');
          stack.pop();
          continue;
        }

        const dep = frame.deps[frame.index];
        frame.index++;
        if (!dep) continue;

        const depState = state.get(dep);
        if (depState === 'visiting') {
          const path = stack.map((item) => item.id);
          throw new Error(`Cycle detected in plan dependencies: ${[...path, dep].join(' -> ')}`);
        }
        if (depState === 'visited') continue;

        state.set(dep, 'visiting');
        stack.push({ id: dep, deps: byId.get(dep)?.dependsOn ?? [], index: 0 });
      }
    }
  }
}
