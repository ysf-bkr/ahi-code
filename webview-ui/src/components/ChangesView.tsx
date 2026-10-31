import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CircleSlash,
  FileCode2,
  FileDiff,
  FilePlus2,
  GitBranch,
  History,
  Loader2,
  RefreshCw,
  Trash2,
  Clock3
} from 'lucide-react';
import {
  ExtensionToWebviewMessage,
  GitChangesPayload,
  GitFileChange,
  NavigationDestination,
  TaskState
} from '@shared/types';
import { ScreenHeader } from './ScreenHeader';
import { Button, Card, EmptyState, IconButton, LinkButton, ListButton, Section, SectionTitle } from './ui';
import { vscode } from '../utils/vscode';
import { formatBytes, formatDateTime } from '../utils/timeFormat';

interface ChangesViewProps {
  state: TaskState;
  onBack: () => void;
  onSelectMenu?: (destination: NavigationDestination) => void;
  changedFileCount?: number;
}

/** Dosya durumunu tek bir rozet + renkle özetler. */
type FileChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';

const KIND_META: Record<FileChangeKind, { label: string; badge: string; icon: React.ReactNode }> = {
  modified: {
    label: 'değiştirildi',
    badge: 'ahi-bg-warning-soft ahi-text-warning',
    icon: <FileCode2 className="ahi-icon-xs" />
  },
  added: {
    label: 'eklendi',
    badge: 'ahi-bg-success-soft ahi-text-success',
    icon: <FilePlus2 className="ahi-icon-xs" />
  },
  deleted: {
    label: 'silindi',
    badge: 'ahi-bg-error-soft ahi-text-error',
    icon: <Trash2 className="ahi-icon-xs" />
  },
  renamed: {
    label: 'yeniden adlandırıldı',
    badge: 'ahi-bg-brand-soft ahi-text-brand',
    icon: <FileCode2 className="ahi-icon-xs" />
  },
  untracked: {
    label: 'izlenmiyor',
    badge: 'ahi-bg-surface ahi-text-muted',
    icon: <CircleSlash className="ahi-icon-xs" />
  }
};

function kindOf(change: GitFileChange | undefined, existsInGit: boolean): FileChangeKind {
  if (!change) return existsInGit ? 'modified' : 'modified';
  const letter = change.indexStatus !== ' ' ? change.indexStatus : change.workTreeStatus;
  if (change.deleted || letter === 'D') return 'deleted';
  if (letter === 'A' || letter === '?') return change.indexStatus === '?' ? 'untracked' : 'added';
  if (letter === 'R') return 'renamed';
  return 'modified';
}

/** Meta satırı: son değişim zamanı + boyut; bilinmeyen alanlar sessizce düşer. */
const FileMeta: React.FC<{ modifiedAt?: number; sizeBytes?: number; deleted?: boolean }> = ({
  modifiedAt,
  sizeBytes,
  deleted
}) => {
  const time = formatDateTime(modifiedAt);
  const size = formatBytes(sizeBytes);
  const parts = [
    time ? `Son değişim: ${time}` : deleted ? 'Diskte yok (silinmiş)' : 'Zaman bilgisi yok',
    size
  ].filter(Boolean);
  return (
    <span className="flex min-w-0 items-center gap-1.5 truncate text-2xs ahi-text-muted">
      <Clock3 className="ahi-icon-xs shrink-0" />
      <span className="truncate">{parts.join(' · ')}</span>
    </span>
  );
};

const FileRow: React.FC<{
  filePath: string;
  change?: GitFileChange;
  diffTitle: string;
}> = ({ filePath, change, diffTitle }) => {
  const kind = kindOf(change, true);
  const meta = KIND_META[kind];
  return (
    <Card className="flex flex-col gap-1 px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span className={`ahi-badge shrink-0 ${meta.badge}`} title={meta.label}>
          {meta.label}
        </span>
        <LinkButton
          plain
          onClick={() => vscode.postMessage({ type: 'OPEN_FILE', payload: { filePath } })}
          className="min-w-0 flex-1 truncate text-left font-mono text-sm"
          title={`${filePath} — düzenleyicide aç`}
        >
          {filePath}
        </LinkButton>
        <Button
          variant="secondary"
          size="xs"
          onClick={() => vscode.postMessage({ type: 'SHOW_FILE_DIFF', payload: { filePath } })}
          title={diffTitle}
          icon={<FileDiff className="ahi-icon-xs" />}
        >
          Fark
        </Button>
      </div>
      <FileMeta modifiedAt={change?.modifiedAt} sizeBytes={change?.sizeBytes} deleted={change?.deleted} />
    </Card>
  );
};

export const ChangesView: React.FC<ChangesViewProps> = ({
  state,
  onBack,
  onSelectMenu,
  changedFileCount
}) => {
  const [changes, setChanges] = useState<GitChangesPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    vscode.postMessage({ type: 'GET_GIT_CHANGES' });
  }, []);

  useEffect(() => {
    refresh();
    const handleMessage = (event: MessageEvent<ExtensionToWebviewMessage>) => {
      if (event.data?.type === 'GIT_CHANGES_LOADED') {
        setChanges(event.data.payload);
        setLoading(false);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [refresh]);

  const gitByPath = useMemo(() => {
    const map = new Map<string, GitFileChange>();
    for (const file of changes?.files ?? []) map.set(file.path, file);
    return map;
  }, [changes]);

  const taskFiles = state.stats.filesModified;

  const counts = useMemo(() => {
    const tally = { modified: 0, added: 0, deleted: 0, untracked: 0, renamed: 0 };
    for (const file of changes?.files ?? []) {
      tally[kindOf(file, true)]++;
    }
    return tally;
  }, [changes]);

  // En yeni değişen dosya en üstte: kullanıcının bakacağı ilk şey en sondur.
  const sortedGitFiles = useMemo(
    () =>
      [...(changes?.files ?? [])].sort(
        (a, b) => (b.modifiedAt ?? Number.NEGATIVE_INFINITY) - (a.modifiedAt ?? Number.NEGATIVE_INFINITY)
      ),
    [changes]
  );

  return (
    <div className="ahi-screen">
      <ScreenHeader
        title="Değişiklikler"
        subtitle="Görev dosyaları ve Git durumu"
        onBack={onBack}
        onSelectMenu={onSelectMenu}
        activeDestination="changes"
        changedFileCount={changedFileCount ?? state.stats.filesModified.length}
        actions={
          <IconButton label="Git durumunu yenile" onClick={refresh}>
            <RefreshCw className="ahi-icon-xs" />
          </IconButton>
        }
      />
      <div className="ahi-screen-body">
        <Section>
          <SectionTitle
            icon={<FileCode2 className="ahi-icon-xs" />}
            title="Bu görevde değişen dosyalar"
            count={taskFiles.length}
          />
          {taskFiles.length === 0 ? (
            <EmptyState
              icon={<FileCode2 className="ahi-icon-lg ahi-text-muted" />}
              title="Henüz değişiklik yok"
              description="Bu görevde henüz dosya değişikliği yapılmadı."
            />
          ) : (
            <div className="mt-1 flex flex-col gap-1.5">
              <p className="ahi-caption">
                Dosya adına tıklayarak düzenleyicide açabilir, "Fark" ile değişikliği inceleyebilirsiniz.
              </p>
              {taskFiles.map((filePath) => (
                <FileRow
                  key={filePath}
                  filePath={filePath}
                  change={gitByPath.get(filePath)}
                  diffTitle="Dosya farkını VS Code diff görünümünde aç"
                />
              ))}
            </div>
          )}
        </Section>

        <Section>
          <SectionTitle
            icon={<GitBranch className="ahi-icon-xs" />}
            title={`Git çalışma ağacı (${changes?.branch || 'dal yok'})`}
            count={sortedGitFiles.length}
          />
          {loading && !changes ? (
            <div className="flex items-center justify-center gap-1.5 py-4 text-xs ahi-text-muted">
              <Loader2 className="ahi-icon-sm animate-spin" /> Git durumu alınıyor…
            </div>
          ) : !changes || !changes.isRepository ? (
            <EmptyState
              icon={<GitBranch className="ahi-icon-lg ahi-text-muted" />}
              title="Git deposu bulunamadı"
              description={
                changes?.error || 'Bu çalışma alanı bir Git deposu değil; Git durumu gösterilemiyor.'
              }
            />
          ) : sortedGitFiles.length === 0 ? (
            <EmptyState description="Çalışma ağacı temiz; bekleyen değişiklik yok." />
          ) : (
            <div className="mt-1 flex flex-col gap-1.5">
              <div className="flex flex-wrap gap-1.5 text-2xs">
                {counts.modified > 0 && (
                  <span className="ahi-badge ahi-bg-warning-soft ahi-text-warning">
                    {counts.modified} değiştirildi
                  </span>
                )}
                {counts.added > 0 && (
                  <span className="ahi-badge ahi-bg-success-soft ahi-text-success">
                    {counts.added} eklendi
                  </span>
                )}
                {counts.untracked > 0 && (
                  <span className="ahi-badge ahi-bg-surface ahi-text-muted">
                    {counts.untracked} izlenmiyor
                  </span>
                )}
                {counts.deleted > 0 && (
                  <span className="ahi-badge ahi-bg-error-soft ahi-text-error">{counts.deleted} silindi</span>
                )}
                {counts.renamed > 0 && (
                  <span className="ahi-badge ahi-bg-brand-soft ahi-text-brand">
                    {counts.renamed} yeniden adlandırıldı
                  </span>
                )}
              </div>
              {sortedGitFiles.map((change) => (
                <FileRow
                  key={`${change.path}-${change.indexStatus}${change.workTreeStatus}`}
                  filePath={change.path}
                  change={change}
                  diffTitle="Git farkını VS Code diff görünümünde aç"
                />
              ))}
            </div>
          )}
        </Section>

        {changes?.isRepository && (
          <Section>
            <SectionTitle
              icon={<History className="ahi-icon-xs" />}
              title="Son commitler"
              count={changes.commits.length}
            />
            {changes.commits.length === 0 ? (
              <EmptyState description="Henüz commit yok." />
            ) : (
              <div className="mt-1 flex flex-col gap-1.5">
                {changes.commits.map((commit) => (
                  <ListButton
                    key={commit.hash}
                    onClick={() =>
                      vscode.postMessage({ type: 'SHOW_COMMIT', payload: { commitHash: commit.hash } })
                    }
                    icon={
                      <span className="ahi-badge shrink-0 ahi-bg-base font-mono ahi-text-brand">
                        {commit.hash}
                      </span>
                    }
                    title={commit.subject}
                    description={formatDateTime(commit.date ? new Date(commit.date).getTime() : undefined)}
                  />
                ))}
              </div>
            )}
          </Section>
        )}
      </div>
    </div>
  );
};
