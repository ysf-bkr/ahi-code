import { PlanStep } from '@shared/types';

export type PlanStepStatus = PlanStep['status'];

/**
 * One source of truth for how a plan step state is worded.
 *
 * The stage strip, the step chain under the composer and the expanded plan list
 * all show the same progress; sharing the labels keeps them from drifting apart
 * (for example "bitti" in one place and "tamamlandı" in another).
 */
export const STEP_STATUS_LABEL: Record<PlanStepStatus, string> = {
  completed: 'tamamlandı',
  in_progress: 'devam ediyor',
  pending: 'bekliyor',
  blocked: 'engellendi'
};

/** Compact glyph used where space is tight. */
export const STEP_STATUS_MARK: Record<PlanStepStatus, string> = {
  completed: '✓',
  in_progress: '→',
  pending: '·',
  blocked: '!'
};

export const STEP_STATUS_COLOR: Record<PlanStepStatus, string> = {
  completed: 'text-[var(--status-success-fg)]',
  in_progress: 'text-[var(--status-info-fg)]',
  pending: 'text-[var(--ahi-muted-fg)]',
  blocked: 'text-[var(--status-error-fg)]'
};

/** Accessible, self-describing label: "2. adım devam ediyor: Modülleri incele". */
export function describePlanStep(index: number, status: PlanStepStatus, title: string): string {
  return `${index}. adım ${STEP_STATUS_LABEL[status]}: ${title}`;
}

export type WorkflowStageStatus = 'completed' | 'active' | 'waiting';

export const STAGE_STATUS_LABEL: Record<WorkflowStageStatus, string> = {
  completed: 'tamamlandı',
  active: 'devam ediyor',
  waiting: 'bekliyor'
};

/** Accessible label for a workflow stage chip: "Plan: tamamlandı". */
export function describeWorkflowStage(stageLabel: string, status: WorkflowStageStatus): string {
  return `${stageLabel}: ${STAGE_STATUS_LABEL[status]}`;
}
