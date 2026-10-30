import React, { useEffect, useState } from 'react';
import {
  RefreshCw,
  FileCode,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Terminal,
  Plug,
  Server,
  Loader2
} from 'lucide-react';
import { McpServerInfo, NavigationDestination } from '@shared/types';
import { ScreenHeader } from './ScreenHeader';
import { Button, Card, EmptyState, IconButton, ListButton, Section, SectionTitle } from './ui';
import { vscode } from '../utils/vscode';

interface McpViewProps {
  onBack: () => void;
  onSelectMenu?: (destination: NavigationDestination) => void;
  changedFileCount?: number;
}

const statusMeta = (status: McpServerInfo['status']) => {
  switch (status) {
    case 'connected':
      return {
        label: 'Bağlı',
        dot: 'ahi-bg-success-solid',
        text: 'ahi-text-success',
        icon: <CheckCircle2 className="ahi-icon-xs" />
      };
    case 'connecting':
      return {
        label: 'Bağlanıyor',
        dot: 'ahi-bg-brand animate-pulse',
        text: 'ahi-text-info',
        icon: <Loader2 className="ahi-icon-xs animate-spin" />
      };
    case 'error':
      return {
        label: 'Hata',
        dot: 'ahi-bg-error-solid',
        text: 'ahi-text-error',
        icon: <AlertCircle className="ahi-icon-xs" />
      };
    default:
      return {
        label: 'Durduruldu',
        dot: 'ahi-bg-muted',
        text: 'ahi-text-muted',
        icon: null
      };
  }
};

export const McpView: React.FC<McpViewProps> = ({ onBack, onSelectMenu, changedFileCount }) => {
  const [servers, setServers] = useState<McpServerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    vscode.postMessage({ type: 'GET_MCP_STATUS' });
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'MCP_STATUS_LOADED') {
        setServers(event.data.payload.servers || []);
        setLoading(false);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleRestart = () => {
    setLoading(true);
    vscode.postMessage({ type: 'RESTART_MCP' });
  };

  const openConfig = () => vscode.postMessage({ type: 'OPEN_MCP_CONFIG' });

  return (
    <div className="ahi-screen">
      <ScreenHeader
        title="MCP sunucuları"
        subtitle="Model Context Protocol araçları"
        onBack={onBack}
        onSelectMenu={onSelectMenu}
        changedFileCount={changedFileCount}
        actions={
          <IconButton label="Sunucuları yeniden tara" onClick={handleRestart}>
            <RefreshCw className={`ahi-icon-xs ${loading ? 'animate-spin ahi-text-info' : ''}`} />
          </IconButton>
        }
      />

      <div className="ahi-screen-body">
        <Card className="flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <span className="ahi-toggle-row__icon ahi-text-info">
              <Plug className="ahi-icon-sm" />
            </span>
            <div className="min-w-0">
              <div className="ahi-title">Harici araçlara bağlanın</div>
              <p className="ahi-caption mt-0.5">
                GitHub, PostgreSQL, SQLite, dosya sistemi veya kendi MCP sunucunuzu ekleyerek ajanın
                yeteneklerini genişletin.
              </p>
            </div>
          </div>
          <Button variant="primary" block onClick={openConfig} icon={<FileCode className="ahi-icon-xs" />}>
            mcp_config.json dosyasını aç
          </Button>
          <div className="text-2xs text-center font-mono ahi-text-muted">.ahi/mcp_config.json</div>
        </Card>

        <Section>
          <SectionTitle icon={<Server className="ahi-icon-xs" />} title="Sunucular" count={servers.length} />

          {loading ? (
            <div className="ahi-caption flex flex-col items-center gap-2 py-8">
              <Loader2 className="ahi-icon-md animate-spin" /> Sunucu durumu yükleniyor...
            </div>
          ) : servers.length === 0 ? (
            <EmptyState
              icon={<Server className="ahi-icon-lg ahi-text-muted" />}
              title="Henüz MCP sunucusu yok"
              description="Yapılandırma dosyasına bir sunucu ekleyin, ardından yenile düğmesine tıklayın."
            />
          ) : (
            servers.map((server) => {
              const isOpen = expanded === server.name;
              const meta = statusMeta(server.status);
              return (
                <Card key={server.name} className="overflow-hidden p-0">
                  <ListButton
                    onClick={() => setExpanded(isOpen ? null : server.name)}
                    aria-expanded={isOpen}
                    icon={<span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />}
                    title={server.name}
                    description={
                      <span className="text-2xs flex items-center gap-1.5 ahi-text-muted">
                        <span className={`flex items-center gap-1 ${meta.text}`}>
                          {meta.icon}
                          {meta.label}
                        </span>
                        <span>·</span>
                        <span className="font-mono">{server.transport || 'stdio'}</span>
                        {server.status === 'connected' && (
                          <>
                            <span>·</span>
                            <span>{server.tools.length} araç</span>
                          </>
                        )}
                      </span>
                    }
                    trailing={
                      isOpen ? (
                        <ChevronDown className="ahi-icon-sm shrink-0 opacity-60" />
                      ) : (
                        <ChevronRight className="ahi-icon-sm shrink-0 opacity-60" />
                      )
                    }
                  />

                  {isOpen && (
                    <div className="flex flex-col gap-2 border-t ahi-border-surface p-2.5">
                      <div className="text-2xs flex items-start gap-1.5 rounded border ahi-border-surface ahi-bg-input px-2 py-1.5 font-mono ahi-text-muted">
                        <Terminal className="ahi-icon-xs mt-0.5 shrink-0" />
                        <span className="break-all">
                          {server.command || server.endpoint || '(komut yok)'}
                        </span>
                      </div>

                      {server.error && (
                        <div className="rounded border ahi-border-error ahi-bg-input p-2">
                          <div className="text-2xs mb-1 flex items-center gap-1 font-semibold ahi-text-error">
                            <AlertCircle className="ahi-icon-xs" /> Bağlantı hatası
                          </div>
                          <pre className="text-2xs whitespace-pre-wrap break-words font-mono ahi-text-error">
                            {server.error}
                          </pre>
                        </div>
                      )}

                      {server.tools.length > 0 ? (
                        <div className="flex flex-col gap-1">
                          <div className="ahi-overline">Bulunan araçlar</div>
                          <div className="flex max-h-52 flex-col gap-1 overflow-y-auto">
                            {server.tools.map((tool) => (
                              <div
                                key={tool.name}
                                className="rounded border ahi-border-surface ahi-bg-input px-2 py-1.5"
                              >
                                <div className="text-2xs truncate font-mono font-medium ahi-text-brand">
                                  {tool.name}
                                </div>
                                {tool.description && (
                                  <div className="ahi-caption mt-0.5 line-clamp-2">{tool.description}</div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="ahi-caption">
                          {server.status === 'connected'
                            ? 'Bu sunucuda araç bulunamadı.'
                            : 'Sunucuya bağlanılamadı.'}
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              );
            })
          )}
        </Section>
      </div>
    </div>
  );
};
