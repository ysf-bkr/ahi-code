import React, { useEffect, useState } from 'react';
import { Database, Loader2, PlusCircle, RefreshCw, Trash2 } from 'lucide-react';
import { KnowledgeStatusPayload } from '@shared/types';
import { Button, Card, Disclosure, Section, SectionTitle, Textarea } from './ui';
import { vscode } from '../utils/vscode';

const formatWhen = (timestamp?: number) =>
  timestamp ? new Date(timestamp).toLocaleString('tr-TR') : 'henüz yok';

/**
 * Project knowledge base card: index status, reindex/clear actions and a note
 * field. The knowledge base is what lets the agent skip full rescans.
 */
export const KnowledgeCard: React.FC = () => {
  const [status, setStatus] = useState<KnowledgeStatusPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    vscode.postMessage({ type: 'GET_KNOWLEDGE_STATUS' });
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'KNOWLEDGE_STATUS_LOADED') {
        setStatus(event.data.payload as KnowledgeStatusPayload);
        setBusy(false);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const reindex = () => {
    setBusy(true);
    vscode.postMessage({ type: 'REINDEX_KNOWLEDGE', payload: { force: true } });
  };

  const addNote = () => {
    const value = note.trim();
    if (!value) return;
    vscode.postMessage({ type: 'ADD_KNOWLEDGE_NOTE', payload: { note: value } });
    setNote('');
  };

  const ready = status?.ready === true;

  return (
    <Section>
      <SectionTitle
        icon={<Database className="h-3 w-3" />}
        title="Bilgi tabanı"
        count={ready ? (status?.fileCount ?? 0) : undefined}
      />

      <Card className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs flex items-center gap-1.5 font-medium text-[var(--ahi-fg)]">
            <Database className="h-3 w-3 text-[var(--status-info-fg)]" />
            {ready ? `${status?.fileCount} dosya · ${status?.symbolCount} sembol` : 'Henüz oluşturulmadı'}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              onClick={reindex}
              disabled={busy}
              icon={
                busy ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-2.5 w-2.5" />
                )
              }
            >
              Yeniden indeksle
            </Button>
            {ready && (
              <Button
                variant={confirmClear ? 'danger' : 'ghost'}
                size="xs"
                onClick={() => {
                  if (!confirmClear) {
                    setConfirmClear(true);
                    setTimeout(() => setConfirmClear(false), 3000);
                    return;
                  }
                  setBusy(true);
                  vscode.postMessage({ type: 'CLEAR_KNOWLEDGE' });
                  setConfirmClear(false);
                }}
                icon={<Trash2 className="h-2.5 w-2.5" />}
              >
                {confirmClear ? 'Emin misin?' : 'Sıfırla'}
              </Button>
            )}
          </div>
        </div>

        <div className="ahi-caption flex flex-wrap gap-x-3 gap-y-1">
          <span>Son indeks: {formatWhen(status?.indexedAt)}</span>
          {status?.lastCommit && <span className="font-mono">commit {status.lastCommit}</span>}
          {ready && <span>{status?.summarizedCount ?? 0} özet</span>}
        </div>

        {status && status.modules.length > 0 && (
          <div className="ahi-caption flex flex-col gap-0.5">
            {status.modules.slice(0, 5).map((module) => (
              <span key={module.path} className="truncate">
                <span className="font-mono text-[var(--ahi-brand-400)]">{module.path}</span> —{' '}
                {module.summary}
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Textarea
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Kalıcı not ekle (karar, kısıt, tuzak)..."
            aria-label="Bilgi tabanına not ekle"
            className="text-sm"
          />
          <Button
            variant="secondary"
            size="xs"
            block
            onClick={addNote}
            disabled={!note.trim()}
            icon={<PlusCircle className="h-2.5 w-2.5" />}
          >
            Notu bilgi tabanına ekle
          </Button>
        </div>

        {status?.notes?.trim() && (
          <Disclosure summary="Notları görüntüle">
            <pre className="text-2xs mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded border border-[var(--ahi-surface-border)] bg-[var(--ahi-input-bg)] p-2 font-mono text-[var(--ahi-muted-fg)]">
              {status.notes.slice(-1500)}
            </pre>
          </Disclosure>
        )}
      </Card>
    </Section>
  );
};
