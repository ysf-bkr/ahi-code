import { PlanStep } from '@shared/types';

export type PlanStepStatus = PlanStep['status'];

/**
 * Bir plan adımı durumunun nasıl ifade edileceğinin tek doğruluk kaynağı.
 *
 * Aşama şeridi, bestecinin altındaki adım zinciri ve genişletilmiş plan
 * listesi aynı ilerlemeyi gösterir; etiketleri paylaşmak onların birbirinden
 * kopmasını önler (örneğin bir yerde "bitti", diğerinde "tamamlandı").
 */
export const STEP_STATUS_LABEL: Record<PlanStepStatus, string> = {
  completed: 'tamamlandı',
  in_progress: 'devam ediyor',
  pending: 'bekliyor',
  blocked: 'engellendi'
};

export const STEP_STATUS_COLOR: Record<PlanStepStatus, string> = {
  completed: 'ahi-text-success',
  in_progress: 'ahi-text-info',
  pending: 'ahi-text-muted',
  blocked: 'ahi-text-error'
};

/** Plan adımı için erişilebilir açıklama etiketi. */
export function describePlanStep(index: number, status: PlanStepStatus, title: string): string {
  return `${index}. adım ${STEP_STATUS_LABEL[status]}: ${title}`;
}
