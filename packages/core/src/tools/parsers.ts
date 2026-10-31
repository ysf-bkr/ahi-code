/**
 * Araç argümanlarını tipli nesnelere çeviren dar ayrıştırıcılar.
 *
 * Model çıktısı `Record<string, unknown>` gelir; `as unknown as X` ile
 * doğrudan cast etmek yerine burada alan alan doğrulanır. Böylece modelin
 * uydurduğu bir alan tip hatasına değil, anlaşılır bir hataya dönüşür.
 */
import type { PlanStepInput, PlanUpdateInput } from '../core/plan/TaskPlanner';
import type { ModuleInput, ModulePlanInput } from '../core/plan/ModulePlanner';
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
      moduleId: typeof step.moduleId === 'string' ? step.moduleId : undefined,
      criteria: asStringArray(step.criteria),
      ownerRole: typeof step.ownerRole === 'string' ? step.ownerRole : undefined
    });
  }

  return {
    goal: typeof args.goal === 'string' ? args.goal : undefined,
    steps
  };
}

/** `update_module_plan` argümanlarını doğrular; bilinmeyen alanları atar. */
export function parseModulePlanInput(args: Record<string, unknown>): ModulePlanInput {
  const rawModules = Array.isArray(args.modules) ? args.modules : [];
  const modules: ModuleInput[] = [];

  for (const raw of rawModules) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const module = raw as Record<string, unknown>;
    modules.push({
      id: typeof module.id === 'string' ? module.id : undefined,
      name: typeof module.name === 'string' ? module.name : undefined,
      layer: typeof module.layer === 'string' ? module.layer : undefined,
      paths: asStringArray(module.paths),
      responsibility: typeof module.responsibility === 'string' ? module.responsibility : undefined,
      dependsOn: asStringArray(module.dependsOn),
      ownerRole: typeof module.ownerRole === 'string' ? module.ownerRole : undefined,
      criteria: asStringArray(module.criteria)
    });
  }

  return {
    goal: typeof args.goal === 'string' ? args.goal : undefined,
    modules
  };
}
