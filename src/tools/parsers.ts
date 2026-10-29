/**
 * Araç argümanlarını tipli nesnelere çeviren dar ayrıştırıcılar.
 *
 * Model çıktısı `Record<string, unknown>` gelir; `as unknown as X` ile
 * doğrudan cast etmek yerine burada alan alan doğrulanır. Böylece modelin
 * uydurduğu bir alan tip hatasına değil, anlaşılır bir hataya dönüşür.
 */
import type { PlanStepInput, PlanUpdateInput } from '../core/plan/TaskPlanner';
import { PlanStepStatus } from '../shared/types';

// Alt ajan parametreleri `shared` altında yaşar; burada yeniden dışa aktarılır.
export { parseSubagentTaskParams } from '../shared/agents/params';
export type { SubagentTaskParams } from '../shared/agents/params';

const PLAN_STATUSES: ReadonlySet<string> = new Set<PlanStepStatus>([
  'pending',
  'in_progress',
  'completed',
  'blocked'
]);

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** `update_plan` argümanlarını doğrular; geçersiz adım alanlarını atlar. */
export function parsePlanUpdateInput(args: Record<string, unknown>): PlanUpdateInput {
  const rawSteps = Array.isArray(args.steps) ? args.steps : [];
  const steps: PlanStepInput[] = [];

  for (const raw of rawSteps) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const step = raw as Record<string, unknown>;
    const status = asString(step.status);
    steps.push({
      id: typeof step.id === 'string' ? step.id : undefined,
      title: typeof step.title === 'string' ? step.title : undefined,
      description: typeof step.description === 'string' ? step.description : undefined,
      status: PLAN_STATUSES.has(status) ? (status as PlanStepStatus) : undefined,
      dependsOn: asStringArray(step.dependsOn),
      completionCriteria: typeof step.completionCriteria === 'string' ? step.completionCriteria : undefined,
      files: asStringArray(step.files),
      ownerRole: typeof step.ownerRole === 'string' ? step.ownerRole : undefined
    });
  }

  return {
    goal: typeof args.goal === 'string' ? args.goal : undefined,
    steps
  };
}
