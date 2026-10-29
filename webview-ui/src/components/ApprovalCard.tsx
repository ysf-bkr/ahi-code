import React, { useState } from 'react';
import { Check, FileText, ListChecks, ShieldAlert, X } from 'lucide-react';
import { PendingApproval } from '@shared/types';
import { Button, Card, Textarea } from './ui';
import { vscode } from '../utils/vscode';

export interface ApprovalCardProps {
  approval: PendingApproval;
}

/**
 * Blocking approval card for the guided workflow. Nothing is written and no
 * command runs until the user accepts the spec or the plan.
 */
export const ApprovalCard: React.FC<ApprovalCardProps> = ({ approval }) => {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const isSpec = approval.kind === 'spec';
  const Icon = isSpec ? FileText : ListChecks;

  return (
    <Card className="flex flex-col gap-2 border-[var(--status-warning-border)] bg-[var(--status-warning-bg)]">
      <div className="flex items-start gap-2">
        <span className="ahi-toggle-row__icon h-7 w-7 text-[var(--status-warning-fg)]">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[var(--ahi-fg)]">{approval.title}</div>
          <div className="text-2xs mt-0.5 flex items-center gap-1 text-[var(--ahi-muted-fg)]">
            <ShieldAlert className="h-2.5 w-2.5" />
            {isSpec
              ? 'Onaylamadan plan yapılmaz ve kod yazılmaz.'
              : 'Onaylamadan hiçbir dosya değiştirilmez.'}
          </div>
        </div>
      </div>

      <pre className="text-2xs max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded border border-[var(--ahi-surface-border)] bg-[var(--ahi-input-bg)] p-2 font-mono leading-relaxed text-[var(--ahi-fg)]">
        {approval.details}
      </pre>

      {rejecting ? (
        <div className="flex flex-col gap-1.5">
          <Textarea
            autoFocus
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Neyi değiştirmemi istersiniz? (isteğe bağlı)"
            aria-label="Reddetme gerekçesi"
            className="text-sm"
          />
          <div className="flex items-center justify-end gap-1.5">
            <Button variant="ghost" size="xs" onClick={() => setRejecting(false)}>
              Vazgeç
            </Button>
            <Button
              variant="danger"
              size="xs"
              onClick={() =>
                vscode.postMessage({
                  type: 'REJECT_APPROVAL',
                  payload: { reason: reason.trim() || undefined }
                })
              }
              icon={<X className="h-3 w-3" />}
            >
              Reddet ve geri dön
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-end gap-1.5">
          <Button
            variant="secondary"
            size="xs"
            onClick={() => setRejecting(true)}
            icon={<X className="h-3 w-3" />}
          >
            Değişiklik iste
          </Button>
          <Button
            variant="primary"
            size="xs"
            onClick={() => vscode.postMessage({ type: isSpec ? 'APPROVE_SPEC' : 'APPROVE_PLAN' })}
            icon={<Check className="h-3 w-3" />}
          >
            {isSpec ? 'Spec\u2019i onayla' : 'Planı onayla'}
          </Button>
        </div>
      )}
    </Card>
  );
};
