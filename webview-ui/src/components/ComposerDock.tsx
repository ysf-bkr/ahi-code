import React, { useState } from 'react';
import {
  Ban,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  FolderGit2,
  ListChecks,
  Loader2,
  Wrench
} from 'lucide-react';
import { PlanStep, TaskState } from '@shared/types';
import { ApprovalCard } from './ApprovalCard';
import { PendingQuestionCard } from './PendingQuestionCard';
import { describePlanStep, STEP_STATUS_COLOR, STEP_STATUS_LABEL } from '../utils/planProgress';

interface ComposerDockProps {
  state: TaskState;
}

const stepIcon = (step: PlanStep) => {
  switch (step.status) {
    case 'completed':
      return <Check className="h-2.5 w-2.5 shrink-0 text-[var(--status-success-fg)]" />;
    case 'in_progress':
      return <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin text-[var(--status-info-fg)]" />;
    case 'blocked':
      return <Ban className="h-2.5 w-2.5 shrink-0 text-[var(--status-error-fg)]" />;
    default:
      return <Circle className="h-2.5 w-2.5 shrink-0 text-[var(--ahi-muted-fg)]" />;
  }
};

/**
 * Kullanıcının bir sonraki eylemini engelleyen veya yönlendiren her şey,
 * bestecinin hemen üstüne sabitlenir:
 *
 * - sıralı adım listesine açılan kompakt, tıklanabilir plan çubuğu,
 * - ajanın bekleyen sorusu,
 * - spec/plan onay kartı.
 *
 * Bunlar eskiden kaydırılabilir mesaj akışının içindeydi; tam kullanıcıya
 * gerekli oldukları anda görünümün dışına kayıyorlardı.
 */
export const ComposerDock: React.FC<ComposerDockProps> = ({ state }) => {
  const [expanded, setExpanded] = useState(false);

  const steps = state.plan?.steps ?? [];
  const hasPlan = steps.length > 0;
  const done = steps.filter((step) => step.status === 'completed').length;
  const next = steps.find((step) => step.status !== 'completed');
  const percent = hasPlan ? Math.round((done / steps.length) * 100) : 0;

  const hasContent =
    hasPlan ||
    Boolean(state.pendingQuestion) ||
    Boolean(state.pendingApproval) ||
    Boolean(state.activeSubagent);
  if (!hasContent) return null;

  return (
    <div className="shrink-0 space-y-1.5 border-t border-[var(--vscode-sideBar-border)] bg-[var(--vscode-sideBar-background)] px-2.5 pt-1.5">
      {hasPlan && (
        <div className="overflow-hidden rounded-md border border-[var(--ahi-surface-border)] bg-[var(--ahi-surface)]">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-controls="composer-dock-plan"
            title={expanded ? 'Plan adımlarını gizle' : 'Plan adımlarını göster'}
            className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left transition hover:bg-[var(--ahi-hover-bg)]"
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3 shrink-0" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0" />
            )}
            <ListChecks className="h-3 w-3 shrink-0 text-[var(--ahi-brand-400)]" />
            <span className="text-xs min-w-0 flex-1 truncate font-medium text-[var(--ahi-fg)]">
              {state.plan?.goal || 'Görev planı'}
            </span>
            <span className="shrink-0 font-mono text-2xs text-[var(--ahi-muted-fg)]">
              {done}/{steps.length} adım · %{percent}
            </span>
            {next && (
              <span
                className={`shrink-0 text-2xs ${STEP_STATUS_COLOR[next.status]}`}
                title={describePlanStep(steps.indexOf(next) + 1, next.status, next.title)}
              >
                {STEP_STATUS_LABEL[next.status]}
              </span>
            )}
          </button>

          {expanded && (
            <ol
              id="composer-dock-plan"
              className="max-h-44 space-y-0.5 overflow-y-auto border-t border-[var(--ahi-surface-border)] px-2 py-1.5"
            >
              {steps.map((step, index) => (
                <li
                  key={step.id}
                  aria-current={step.status === 'in_progress' ? 'step' : undefined}
                  aria-label={describePlanStep(index + 1, step.status, step.title)}
                  className={`flex items-start justify-between gap-1.5 rounded px-1 py-0.5 ${
                    step.status === 'in_progress' ? 'bg-[var(--vscode-list-hoverBackground)]' : ''
                  }`}
                >
                  <span className="flex min-w-0 items-start gap-1.5">
                    <span className="mt-0.5 shrink-0">{stepIcon(step)}</span>
                    <span
                      className={`block text-xs leading-snug ${
                        step.status === 'completed'
                          ? 'text-[var(--ahi-muted-fg)] line-through'
                          : 'text-[var(--ahi-fg)]'
                      }`}
                    >
                      {index + 1}. {step.title}
                    </span>
                  </span>
                  <span className={`shrink-0 text-2xs ${STEP_STATUS_COLOR[step.status]}`}>
                    {STEP_STATUS_LABEL[step.status]}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {state.pendingQuestion && (
        <PendingQuestionCard
          key={`question-${state.pendingQuestion.toolCallId}`}
          question={state.pendingQuestion.question}
          toolCallId={state.pendingQuestion.toolCallId}
        />
      )}

      {state.pendingApproval && (
        <ApprovalCard
          key={`approval-${state.pendingApproval.kind}-${state.pendingApproval.title}`}
          approval={state.pendingApproval}
        />
      )}

      {state.activeSubagent && (
        <div
          data-testid="active-subagent-card"
          className="rounded-md border border-[var(--ahi-brand-500)]/40 bg-[var(--ahi-surface)] p-2 shadow-xs"
        >
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <Bot className="h-3.5 w-3.5 shrink-0 text-[var(--ahi-brand-400)] animate-pulse" />
              <span className="text-xs font-semibold text-[var(--ahi-fg)] truncate">
                {state.activeSubagent.displayName || state.activeSubagent.role}
              </span>
              <span className="text-2xs rounded bg-[var(--ahi-brand-500)]/20 px-1 py-0.5 font-mono text-[var(--ahi-brand-400)] shrink-0">
                alt ajan
              </span>
            </div>
            {state.activeSubagent.isolate ? (
              <span
                className="flex items-center gap-1 text-2xs text-amber-400 font-mono shrink-0 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20"
                title="İzole Git worktree üzerinde çalışıyor; ana çalışma alanı etkilenmez."
              >
                <FolderGit2 className="h-2.5 w-2.5" />
                İzole Worktree
              </span>
            ) : (
              <span
                className="flex items-center gap-1 text-2xs text-[var(--ahi-muted-fg)] font-mono shrink-0"
                title="Ana çalışma alanında doğrudan çalışıyor."
              >
                Çalışma Alanı
              </span>
            )}
          </div>

          <div className="mt-1 text-2xs text-[var(--ahi-muted-fg)] truncate">{state.activeSubagent.task}</div>

          <div className="mt-1.5 flex items-center justify-between border-t border-[var(--ahi-surface-border)] pt-1 text-2xs">
            <div className="flex items-center gap-1 text-[var(--ahi-brand-400)]">
              {state.activeSubagent.currentTool ? (
                <>
                  <Wrench className="h-2.5 w-2.5 animate-spin" />
                  <span className="font-mono">
                    {state.activeSubagent.currentTool}
                    {state.activeSubagent.step
                      ? ` (${state.activeSubagent.step}/${state.activeSubagent.maxSteps || 8})`
                      : ''}
                  </span>
                </>
              ) : (
                <>
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  <span>Düşünüyor ve planlıyor…</span>
                </>
              )}
            </div>
            {state.activeSubagent.worktreePath && (
              <span
                className="font-mono text-2xs text-[var(--ahi-muted-fg)] truncate max-w-[140px]"
                title={state.activeSubagent.worktreePath}
              >
                {state.activeSubagent.worktreePath.split('/').pop()}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
