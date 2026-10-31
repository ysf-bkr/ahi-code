import React, { useCallback, useEffect, useState } from 'react';
import { FileCode2, FileDiff, GitBranch, History, Loader2, RefreshCw } from 'lucide-react';
import {
  ExtensionToWebviewMessage,
  GitChangesPayload,
  NavigationDestination,
  TaskState
} from '@shared/types';
import { ScreenHeader } from './ScreenHeader';
import { Button, Card, EmptyState, IconButton, LinkButton, ListButton, Section, SectionTitle } from './ui';
import { vscode } from '../utils/vscode';

interface ChangesViewProps {
  state: TaskState;
  onBack: () => void;
  onSelectMenu?: (destination: NavigationDestination) => void;
  changedFileCount?: number;
}

const STATUS_LABELS: Record<string, string> = {
  M: 'değiştirildi',
  A: 'eklendi',
  D: 'silindi',
  R: 'yeniden adlandırıldı',
  C: 'kopyalandı',
  '?': 'izlenmiyor',
  '!': 'yoksayıldı',
  ' ': ''
};

const describeStatus = (letter: string): string => STATUS_LABELS[letter] ?? letter;

const GitChangesView: React.FC = () => {
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

  if (loading && !changes) {
    return (
      <div className="flex items-center justify-center gap-1.5 py-6 text-xs ahi-text-muted">
        <Loader2 className="ahi-icon-sm animate-spin" /> Git durumu alınıyor…
      </div>
    );
  }

  if (!changes || !changes.isRepository) {
    return (
      <EmptyState
        icon={<GitBranch className="ahi-icon-lg ahi-text-muted" />}
        title="Git deposu bulunamadı"
        description={changes?.error || 'Bu çalışma alanı bir Git deposu değil; değişiklikler gösterilemiyor.'}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Section>
        <SectionTitle
          icon={<GitBranch className="ahi-icon-xs" />}
          title={`Git çalışma ağacı (${changes.branch || 'dal yok'})`}
          count={changes.files.length}
        />
        {changes.files.length === 0 ? (
          <EmptyState description="Çalışma ağacı temiz; bekleyen değişiklik yok." />
        ) : (
          <div className="flex flex-col gap-1.5">
            {changes.files.map((change) => (
              <Card
                key={`${change.path}-${change.indexStatus}`}
                className="flex items-center gap-2 px-2 py-1.5"
              >
                <span
                  className="ahi-badge shrink-0 ahi-bg-base font-mono"
                  title={`Index: ${change.indexStatus === ' ' ? '-' : change.indexStatus}, çalışma ağacı: ${
                    change.workTreeStatus === ' ' ? '-' : change.workTreeStatus
                  }`}
                >
                  {change.indexStatus === ' ' ? '-' : change.indexStatus}
                  {change.workTreeStatus === ' ' ? '' : change.workTreeStatus}
                </span>
                <LinkButton
                  plain
                  onClick={() =>
                    vscode.postMessage({ type: 'OPEN_FILE', payload: { filePath: change.path } })
                  }
                  className="min-w-0 flex-1 truncate text-left font-mono text-sm"
                  title={`${change.path} — ${describeStatus(change.indexStatus !== ' ' ? change.indexStatus : change.workTreeStatus)}`}
                >
                  {change.path}
                </LinkButton>
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => {
                    vscode.postMessage({
                      type: 'SHOW_FILE_DIFF',
                      payload: { filePath: change.path }
                    });
                  }}
                  title="Git farkını VS Code diff görünümünde aç"
                  icon={<FileDiff className="ahi-icon-xs" />}
                >
                  Fark
                </Button>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Section>
        <SectionTitle
          icon={<History className="ahi-icon-xs" />}
          title="Son commitler"
          count={changes.commits.length}
        />
        {changes.commits.length === 0 ? (
          <EmptyState description="Henüz commit yok." />
        ) : (
          <div className="flex flex-col gap-1.5">
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
              />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
};

export const ChangesView: React.FC<ChangesViewProps> = ({
  state,
  onBack,
  onSelectMenu,
  changedFileCount
}) => {
  const changes = state.stats.filesModified.map((path) => ({ path }));

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
          <IconButton
            label="Git durumunu yenile"
            onClick={() => vscode.postMessage({ type: 'GET_GIT_CHANGES' })}
          >
            <RefreshCw className="ahi-icon-xs" />
          </IconButton>
        }
      />
      <div className="ahi-screen-body">
        <Section>
          <SectionTitle
            icon={<FileCode2 className="ahi-icon-xs" />}
            title="Bu görevde değişen dosyalar"
            count={changes.length}
          />
          {changes.length === 0 ? (
            <EmptyState
              icon={<FileCode2 className="ahi-icon-lg ahi-text-muted" />}
              title="Henüz değişiklik yok"
              description="Bu görevde henüz dosya değişikliği yapılmadı."
            />
          ) : (
            <div className="flex flex-col gap-1.5">
              <p className="ahi-caption">
                Dosya adına tıklayarak düzenleyicide açabilir, "Fark" ile değişikliği inceleyebilirsiniz.
              </p>
              {changes.map((change) => (
                <Card key={change.path} className="flex items-center gap-2 px-2 py-1.5">
                  <FileCode2 className="ahi-icon-sm shrink-0 ahi-text-muted" />
                  <LinkButton
                    plain
                    onClick={() =>
                      vscode.postMessage({ type: 'OPEN_FILE', payload: { filePath: change.path } })
                    }
                    className="min-w-0 flex-1 truncate text-left font-mono text-sm"
                    title={`${change.path} — düzenleyicide aç`}
                  >
                    {change.path}
                  </LinkButton>
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => {
                      vscode.postMessage({
                        type: 'SHOW_FILE_DIFF',
                        payload: { filePath: change.path }
                      });
                    }}
                    title="Dosya farkını VS Code diff görünümünde aç"
                    icon={<FileDiff className="ahi-icon-xs" />}
                  >
                    Fark
                  </Button>
                </Card>
              ))}
            </div>
          )}
        </Section>

        <GitChangesView />
      </div>
    </div>
  );
};
