/**
 * Yönlendirilmiş iş akışı durum makinesi.
 *
 * Ajan istemden doğrudan kod yazmaz. Belirgin aşamalardan geçer ve her
 * geçişin karşılanması gereken bir kapısı vardır. Makine saf tutulur;
 * birim testi yapılabilir ve CLI'de yeniden kullanılabilir.
 *
 * Kod modu:  ONBOARD -> INTAKE -> SPEC -> PLAN -> BUILD -> REVIEW -> VERIFY -> DONE
 * Plan modu: ONBOARD -> INTAKE -> REVIEW -> PLAN -> DONE
 *
 * Planlama modu hiç kod yazmaz ve komut çalıştırmaz, bu yüzden yalnızca
 * koda özgü aşamalar (build, verify) doğrusal akışında yoktur.
 */
import { AgentMode, WorkflowStage, WorkflowState } from '../../shared/types';

export type { WorkflowStage, WorkflowState };

export interface WorkflowGateResult {
  allowed: boolean;
  reason?: string;
}

export interface WorkflowStageInfo {
  id: WorkflowStage;
  label: string;
  /** İlerleme şeridinde ipucu olarak gösterilen kısa açıklama. */
  hint: string;
}

export const MAX_INTAKE_QUESTIONS = 8;

/** Kod modunun aşama sırası (dosya yazma ve komut çalıştırma). */
export const STAGE_ORDER: WorkflowStage[] = [
  'onboard',
  'intake',
  'spec',
  'plan',
  'build',
  'review',
  'verify',
  'done'
];

/** Planlama modunun aşama sırası (yalnızca analiz ve planlama). */
export const PLAN_MODE_STAGE_ORDER: WorkflowStage[] = ['onboard', 'intake', 'review', 'plan', 'done'];

const STAGE_INFO: Record<WorkflowStage, { label: string; hint: string }> = {
  onboard: { label: 'Anlama', hint: 'Projeyi ve mevcut durumu anlama' },
  intake: { label: 'İstek', hint: 'Gereksinimleri netleştirme, sorular' },
  spec: { label: 'Spec', hint: 'Hedef, kapsam ve kabul kriterleri onayı' },
  plan: { label: 'Plan', hint: 'Uygulama adımlarının planı ve onayı' },
  build: { label: 'Uygulama', hint: 'Kod yazma ve komut çalıştırma' },
  review: { label: 'İnceleme', hint: 'Değişiklikleri ve planı gözden geçirme' },
  verify: { label: 'Doğrulama', hint: 'Test, lint ve tip denetimi' },
  done: { label: 'Bitti', hint: 'Görev tamamlandı' }
};

/** Dosya yazımının spec çıktılarıyla sınırlı olduğu aşamalar. */
const READ_ONLY_STAGES: ReadonlySet<WorkflowStage> = new Set<WorkflowStage>([
  'onboard',
  'intake',
  'spec',
  'plan'
]);
/** Komutların hiç çalışamadığı aşamalar. */
const NO_COMMAND_STAGES: ReadonlySet<WorkflowStage> = new Set<WorkflowStage>(['onboard', 'intake', 'spec']);

export function stageOrderForMode(mode: AgentMode): WorkflowStage[] {
  return mode === 'plan' ? PLAN_MODE_STAGE_ORDER : STAGE_ORDER;
}

export function stageLabel(stage: WorkflowStage): string {
  return STAGE_INFO[stage].label;
}

export function createWorkflowState(patch: Partial<WorkflowState> = {}): WorkflowState {
  return {
    stage: 'onboard',
    questionsAsked: 0,
    specId: undefined,
    specApproved: false,
    planApproved: false,
    knowledgeReady: false,
    updatedAt: Date.now(),
    ...patch
  };
}

export function isReadOnlyStage(stage: WorkflowStage): boolean {
  return READ_ONLY_STAGES.has(stage);
}

export function stageAllowsCommands(stage: WorkflowStage): boolean {
  return !NO_COMMAND_STAGES.has(stage);
}

export function stageIndex(stage: WorkflowStage, mode: AgentMode = 'code'): number {
  return stageOrderForMode(mode).indexOf(stage);
}

/**
 * Kullanıcı mod değiştirdiğinde aşamayı geçerli tutar. `build` gibi yalnızca
 * koda özgü bir aşama planlama modunda yoktur; şeridi bilinmeyen bir adımda
 * bırakmak yerine en yakın anlamlı aşamaya düşer.
 */
export function normalizeStageForMode(stage: WorkflowStage, mode: AgentMode): WorkflowStage {
  if (stageOrderForMode(mode).includes(stage)) return stage;
  if (mode === 'plan') return 'review';
  return 'intake';
}

/**
 * İstenen geçişi doğrular. Aşamalar yalnızca bir adım ileri gidebilir;
 * ancak kullanıcı iş akışını her zaman `intake` aşamasına geri gönderebilir
 * (örneğin reddedilen bir plandan sonra).
 */
export function canTransition(
  from: WorkflowStage,
  to: WorkflowStage,
  mode: AgentMode = 'code'
): WorkflowGateResult {
  if (from === to) return { allowed: true };
  if (to === 'intake' && from !== 'done') return { allowed: true };

  // Doğrulama başarısız olduğunda ajan uygulama aşamasına geri döner; bu tek
  // adımlık geri dönüş, iş akışının "düzelt ve yeniden doğrula" döngüsüdür.
  if (from === 'verify' && to === 'build' && mode !== 'plan') return { allowed: true };

  const fromIndex = stageIndex(from, mode);
  const toIndex = stageIndex(to, mode);
  if (fromIndex < 0 || toIndex < 0) {
    return { allowed: false, reason: `Unknown workflow stage: ${from} -> ${to}` };
  }
  if (toIndex !== fromIndex + 1) {
    return {
      allowed: false,
      reason: `Workflow moves one stage at a time: ${from} -> ${to} is not allowed.`
    };
  }
  return { allowed: true };
}

export interface TransitionContext {
  /** Çağıran yan etkileri uyguladıktan sonraki iş akışı durumu. */
  state: WorkflowState;
  /** Görev için onaylı spec var mı? */
  hasApprovedSpec: boolean;
  /** Planda en az bir adım var mı? */
  hasPlan: boolean;
  /** Tüm kabul kriterleri işaretli mi? */
  criteriaMet: boolean;
  /** Doğrulama geçti mi (ya da bilinçli olarak atlandı mı)? */
  verificationPassed: boolean;
}

/**
 * Bir aşamaya giriş kapısı. Geçiş işlenmeden *önce* kontrol edilir.
 */
export function gateForStage(
  to: WorkflowStage,
  context: TransitionContext,
  mode: AgentMode = 'code'
): WorkflowGateResult {
  const planning = mode === 'plan';

  switch (to) {
    case 'intake':
      return { allowed: true };

    case 'spec':
      // Spec anlaşılmış bir istekten yazılmalı; bilgi tabanı açık kararları
      // zaten cevaplıyorsa sorular zorunlu değildir.
      return { allowed: true };

    case 'plan':
      // Planlama modu planı kendisi üretir; kod spec'ine ihtiyacı yoktur.
      if (planning) return { allowed: true };
      if (!context.hasApprovedSpec) {
        return { allowed: false, reason: 'Write and approve a spec before planning.' };
      }
      return { allowed: true };

    case 'build':
      if (planning) {
        return { allowed: false, reason: 'Planning mode has no build stage.' };
      }
      if (!context.hasApprovedSpec) {
        return { allowed: false, reason: 'The spec must be approved before code is written.' };
      }
      if (!context.hasPlan) {
        return { allowed: false, reason: 'A plan with at least one step is required before building.' };
      }
      if (!context.state.planApproved) {
        return { allowed: false, reason: 'The plan must be approved before code is written.' };
      }
      return { allowed: true };

    case 'review':
      // Planlama modunda review "karar öncesi analiz" demektir; henüz var
      // olmayan bir planı gerektirmemelidir.
      if (planning) return { allowed: true };
      if (!context.hasPlan) {
        return { allowed: false, reason: 'There is no plan to review against.' };
      }
      return { allowed: true };

    case 'verify':
      if (planning) {
        return { allowed: false, reason: 'Planning mode does not run verification.' };
      }
      return { allowed: true };

    case 'done':
      if (planning) {
        return context.hasPlan
          ? { allowed: true }
          : { allowed: false, reason: 'A plan with at least one step is required before finishing.' };
      }
      if (!context.criteriaMet) {
        return {
          allowed: false,
          reason: 'Every acceptance criterion must be checked before the task can be marked done.'
        };
      }
      if (!context.verificationPassed) {
        return { allowed: false, reason: 'Verification must pass (or be explicitly skipped) before done.' };
      }
      return { allowed: true };

    case 'onboard':
      return { allowed: false, reason: 'The workflow cannot move back to onboarding.' };

    default:
      return { allowed: false, reason: `Unknown stage: ${String(to)}` };
  }
}

export interface WorkflowSnapshot {
  stage: WorkflowStage;
  label: string;
  /** Ajanın sıradaki olarak isteyebileceği aşamalar. */
  next: WorkflowStage[];
  readOnly: boolean;
  allowsCommands: boolean;
  questionsRemaining: number;
}

export function describeWorkflow(state: WorkflowState, mode: AgentMode = 'code'): WorkflowSnapshot {
  const next: WorkflowStage[] = [];
  const order = stageOrderForMode(mode);
  const index = order.indexOf(state.stage);
  const candidate = order[index + 1];
  if (candidate) next.push(candidate);
  if (state.stage !== 'intake' && state.stage !== 'done') next.push('intake');

  return {
    stage: state.stage,
    label: stageLabel(state.stage),
    next,
    readOnly: isReadOnlyStage(state.stage),
    allowsCommands: stageAllowsCommands(state.stage),
    questionsRemaining: Math.max(0, MAX_INTAKE_QUESTIONS - state.questionsAsked)
  };
}

export function formatWorkflowForPrompt(state: WorkflowState, mode: AgentMode = 'code'): string {
  const snapshot = describeWorkflow(state, mode);
  const planning = mode === 'plan';
  const rules = [
    `Mode: ${planning ? 'planning (no file writes, no commands)' : 'coding'}.`,
    `Current stage: ${state.stage} (${snapshot.label}).`,
    ...(planning
      ? [
          '- Produce a concrete, ordered plan with dependencies and completion criteria.',
          '- Do not write project files and do not run commands; this mode is analysis only.'
        ]
      : [
          '- Do not write code before the spec and the plan are approved.',
          '- After the plan is approved, implement it and verify with tests/lint.'
        ]),
    '- Ask a question instead of assuming; list assumptions in the spec.',
    '- Read a file before editing it.',
    '- Never claim the task is done while an acceptance criterion is unchecked.'
  ];
  if (snapshot.readOnly) {
    rules.push('- This stage is read-only: only spec artifacts may be written and commands must not run.');
  }
  if (snapshot.questionsRemaining === 0) {
    rules.push('- The question budget is exhausted; state assumptions explicitly and proceed.');
  }
  return `\n\n=== WORKFLOW ===\n${rules.join('\n')}\n=== END OF WORKFLOW ===`;
}
