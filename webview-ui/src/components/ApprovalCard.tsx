import React, { useState } from 'react';
import { Check, FileText, ListChecks, ShieldAlert, X } from 'lucide-react';
import { PendingApproval } from '@shared/types';
import { Button, Card, Textarea } from './ui';
import { vscode } from '../utils/vscode';

export interface ApprovalCardProps {
  approval: PendingApproval;
}

/**
 * Yönlendirilmiş iş akışı için engelleyici onay kartı. Kullanıcı spec'i veya
 * planı kabul edene kadar hiçbir şey yazılmaz ve hiçbir komut çalışmaz.
 */
export const ApprovalCard: React.FC<ApprovalCardProps> = ({ approval }) => {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const isSpec = approval.kind === 'spec';
  const Icon = isSpec ? FileText : ListChecks;

  return (
    <Card className="flex flex-col gap-2 ahi-border-warning ahi-bg-warning">
      <div className="flex items-start gap-2">
        <span className="ahi-toggle-row__icon ahi-text-warning">
          <Icon className="ahi-icon-sm" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="ahi-title">{approval.title}</div>
          <div className="text-2xs mt-0.5 flex items-center gap-1 ahi-text-muted">
            <ShieldAlert className="ahi-icon-xs" />
            {isSpec
              ? 'Onaylamadan plan yapılmaz ve kod yazılmaz.'
              : 'Onaylamadan hiçbir dosya değiştirilmez.'}
          </div>
        </div>
      </div>

      <pre className="text-xs max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded border ahi-border-surface ahi-bg-input p-2 font-mono leading-relaxed ahi-text-fg">
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
              icon={<X className="ahi-icon-xs" />}
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
            icon={<X className="ahi-icon-xs" />}
          >
            Değişiklik iste
          </Button>
          <Button
            variant="primary"
            size="xs"
            onClick={() => vscode.postMessage({ type: isSpec ? 'APPROVE_SPEC' : 'APPROVE_PLAN' })}
            icon={<Check className="ahi-icon-xs" />}
          >
            {isSpec ? 'Spec\u2019i onayla' : 'Planı onayla'}
          </Button>
        </div>
      )}
    </Card>
  );
};
