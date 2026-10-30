import React, { useEffect, useState } from 'react';
import {
  RefreshCw,
  FileCode,
  CheckCircle2,
  ExternalLink,
  Bot,
  Sparkles,
  Layers,
  BookOpen,
  PlusCircle,
  FolderGit2,
  Loader2,
  Compass,
  Wrench,
  ShieldCheck,
  TestTube2,
  Search,
  Brain,
  Trash2,
  Play,
  RotateCcw,
  Crown,
  Target,
  Server,
  Palette,
  Smartphone,
  Cpu,
  Database,
  Terminal
} from 'lucide-react';
import { NavigationDestination, TaskState, WorkspaceCustomizations } from '@shared/types';
import { BUILT_IN_SUBAGENT_ROLES } from '@shared/agents/index';
import { ScreenHeader } from './ScreenHeader';
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  IconButton,
  ListButton,
  Section,
  SectionTitle,
  Textarea
} from './ui';
import { KnowledgeCard } from './KnowledgeCard';
import { vscode } from '../utils/vscode';

interface AgentsViewProps {
  onBack: () => void;
  state?: TaskState;
  onSelectMenu?: (destination: NavigationDestination) => void;
  changedFileCount?: number;
}

const ROLE_ICONS: Record<string, React.ReactNode> = {
  manager: <Crown className="ahi-icon-sm ahi-text-warning" />,
  analyst: <Target className="ahi-icon-sm ahi-text-brand" />,
  architect: <Compass className="ahi-icon-sm ahi-text-brand" />,
  backend: <Server className="ahi-icon-sm ahi-text-info" />,
  frontend: <Palette className="ahi-icon-sm ahi-text-brand" />,
  mobile: <Smartphone className="ahi-icon-sm ahi-text-info" />,
  native: <Cpu className="ahi-icon-sm ahi-text-warning" />,
  database: <Database className="ahi-icon-sm ahi-text-info" />,
  devops: <Terminal className="ahi-icon-sm ahi-text-warning" />,
  explorer: <Search className="ahi-icon-sm ahi-text-info" />,
  git: <FolderGit2 className="ahi-icon-sm ahi-text-error" />,
  quality: <CheckCircle2 className="ahi-icon-sm ahi-text-success" />,
  security: <ShieldCheck className="ahi-icon-sm ahi-text-error" />,
  coder: <Wrench className="ahi-icon-sm ahi-text-success" />,
  tester: <TestTube2 className="ahi-icon-sm ahi-text-warning" />,
  reviewer: <ShieldCheck className="ahi-icon-sm ahi-text-success" />
};

const CodePreview: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <pre className="text-2xs mt-1.5 max-h-24 overflow-hidden whitespace-pre-wrap break-words rounded border ahi-border-surface ahi-bg-input p-2 font-mono leading-relaxed ahi-text-muted">
    {children}
  </pre>
);

export const AgentsView: React.FC<AgentsViewProps> = ({ onBack, state, onSelectMenu, changedFileCount }) => {
  const [customizations, setCustomizations] = useState<WorkspaceCustomizations>({
    hasAgentsMd: false,
    skills: [],
    agents: []
  });
  const [loading, setLoading] = useState(true);
  const [confirmMemoryClear, setConfirmMemoryClear] = useState(false);
  // Alt ajan başlatıcı: seçilen role başlatılmadan önce bir görev tanımı ve
  // isteğe bağlı izole worktree anahtarı verilir.
  const [launchRole, setLaunchRole] = useState<string | null>(null);
  const [launchTask, setLaunchTask] = useState('');
  const [launchIsolate, setLaunchIsolate] = useState(false);
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    vscode.postMessage({ type: 'GET_CUSTOMIZATIONS' });
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'CUSTOMIZATIONS_LOADED') {
        setCustomizations(event.data.payload);
        setLoading(false);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const refresh = () => {
    setLoading(true);
    vscode.postMessage({ type: 'GET_CUSTOMIZATIONS' });
  };

  const scaffold = () => {
    setLoading(true);
    vscode.postMessage({ type: 'INIT_AGENTS_TEMPLATE' });
  };

  const openFile = (path: string) => vscode.postMessage({ type: 'OPEN_AGENTS_FILE', payload: { path } });
  const memoryCount = customizations.memoryEntryCount || 0;

  const selectRole = (role: string) => {
    setLaunchRole((current) => (current === role ? null : role));
    setLaunchTask('');
  };

  const startSubagent = () => {
    const task = launchTask.trim();
    if (!launchRole || !task || launching) return;
    setLaunching(true);
    vscode.postMessage({
      type: 'START_SUBAGENT',
      payload: { role: launchRole, task, isolate: launchIsolate }
    });
    // Sonuç sohbet mesajları ve bildirimler olarak gelir; formu sıfırla.
    setTimeout(() => {
      setLaunching(false);
      setLaunchRole(null);
      setLaunchTask('');
      setLaunchIsolate(false);
    }, 600);
  };

  const activeAgentInfo = launchRole
    ? BUILT_IN_SUBAGENT_ROLES.find((a) => a.role === launchRole) ||
      customizations.agents.find(
        (a) =>
          a.name.toLowerCase() === launchRole.toLowerCase() ||
          a.role.toLowerCase() === launchRole.toLowerCase()
      )
    : undefined;

  const launchForm = launchRole ? (
    <Card className="flex flex-col gap-2 ahi-border-brand ahi-bg-surface">
      <div className="flex items-center justify-between">
        <div className="ahi-title flex items-center gap-1.5">
          <Bot className="ahi-icon-sm ahi-text-brand" />
          Ajan görevi: <span className="ahi-text-brand">{activeAgentInfo?.name || launchRole}</span>
        </div>
        <span className="text-2xs font-mono ahi-text-muted">@{launchRole}</span>
      </div>
      <Textarea
        className="w-full resize-none font-mono text-xs"
        rows={3}
        placeholder={`${activeAgentInfo?.name || launchRole} ne yapsın? Görevi kısaca ve net tanımlayın.`}
        value={launchTask}
        onChange={(event) => setLaunchTask(event.target.value)}
        aria-label="Alt ajan görevi"
      />
      <Checkbox
        label="Ayrı Git worktree içinde çalıştır (ana çalışma alanını değiştirmez)"
        checked={launchIsolate}
        onChange={(event) => setLaunchIsolate(event.target.checked)}
      />
      <div className="flex items-center gap-1.5">
        <Button
          variant="primary"
          size="xs"
          onClick={startSubagent}
          disabled={!launchTask.trim() || launching || Boolean(state?.activeSubagent)}
          title={
            state?.activeSubagent
              ? 'Şu anda başka bir alt ajan çalışırken yeni bir ajan başlatılamaz.'
              : undefined
          }
          icon={
            launching ? <Loader2 className="ahi-icon-xs animate-spin" /> : <Play className="ahi-icon-xs" />
          }
        >
          {launching ? 'Başlatılıyor…' : 'Başlat'}
        </Button>
        <Button variant="ghost" size="xs" onClick={() => setLaunchRole(null)}>
          Vazgeç
        </Button>
      </div>
      <p className="ahi-caption">
        Sonuç sohbete ve bildirimlere düşer. Yazma/komut adımları yine normal onay akışından geçer.
      </p>
    </Card>
  ) : null;

  return (
    <div className="ahi-screen">
      <ScreenHeader
        title="Ajanlar & Beceriler"
        subtitle="AGENTS.md, .agents/skills ve alt ajanlar"
        onBack={onBack}
        onSelectMenu={onSelectMenu}
        changedFileCount={changedFileCount}
        actions={
          <IconButton label="Yeniden tara" onClick={refresh}>
            <RefreshCw className={`ahi-icon-xs ${loading ? 'animate-spin ahi-text-info' : ''}`} />
          </IconButton>
        }
      />

      <div className="ahi-screen-body">
        {state?.activeSubagent && (
          <Card className="ahi-border-brand ahi-bg-brand-soft">
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full ahi-bg-brand opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full ahi-bg-brand" />
                </span>
                <span className="ahi-title truncate">
                  Aktif Alt Ajan: {state.activeSubagent.displayName || state.activeSubagent.role}
                </span>
              </div>
              <span className="text-2xs font-mono ahi-text-brand shrink-0">
                {state.activeSubagent.isolate ? 'İzole Worktree' : 'Çalışma Alanı'}
              </span>
            </div>
            <p className="mt-1 text-2xs ahi-text-muted line-clamp-2">{state.activeSubagent.task}</p>
            <div className="mt-1.5 flex items-center justify-between border-t ahi-border-surface pt-1 text-2xs">
              <div className="flex items-center gap-1 ahi-text-brand">
                {state.activeSubagent.currentTool ? (
                  <>
                    <Wrench className="ahi-icon-xs animate-spin" />
                    <span className="font-mono">
                      {state.activeSubagent.currentTool}
                      {state.activeSubagent.step
                        ? ` (${state.activeSubagent.step}/${state.activeSubagent.maxSteps || 8})`
                        : ''}
                    </span>
                  </>
                ) : (
                  <>
                    <Loader2 className="ahi-icon-xs animate-spin" />
                    <span>İşlem yürütülüyor…</span>
                  </>
                )}
              </div>
              {state.activeSubagent.worktreePath && (
                <span
                  className="font-mono text-2xs ahi-text-muted truncate max-w-[140px]"
                  title={state.activeSubagent.worktreePath}
                >
                  {state.activeSubagent.worktreePath.split('/').pop()}
                </span>
              )}
            </div>
          </Card>
        )}

        <Card>
          <div className="flex items-start gap-2">
            <span className="ahi-toggle-row__icon ahi-text-info">
              <Sparkles className="ahi-icon-sm" />
            </span>
            <div>
              <div className="ahi-title">Projeye özel ajan sistemi</div>
              <p className="ahi-caption mt-0.5">
                Codex ve Claude Code ile uyumlu <code className="ahi-code-inline">AGENTS.md</code>, beceriler
                ve özel alt ajanlar otomatik algılanır.
              </p>
            </div>
          </div>
        </Card>

        <Section>
          <SectionTitle icon={<BookOpen className="ahi-icon-xs" />} title="Proje yönergeleri" />
          {customizations.hasAgentsMd ? (
            <Card className="ahi-border-success">
              <div className="flex items-center justify-between">
                <span className="text-xs flex items-center gap-1.5 font-medium ahi-text-fg">
                  <CheckCircle2 className="ahi-icon-xs ahi-text-success" /> AGENTS.md aktif
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => openFile(customizations.agentsMdPath || 'AGENTS.md')}
                  icon={<FileCode className="ahi-icon-xs" />}
                  title="AGENTS.md dosyasını aç"
                >
                  Aç
                </Button>
              </div>
              <CodePreview>{customizations.agentsMdContent?.slice(0, 500) || '(boş)'}</CodePreview>
            </Card>
          ) : (
            <Card className="ahi-border-warning ahi-bg-warning">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="ahi-title">AGENTS.md bulunamadı</div>
                  <div className="text-2xs ahi-text-muted mt-0.5">
                    Proje kuralları ve mimari notları her göreve otomatik olarak eklenir.
                  </div>
                </div>
                <Button
                  variant="primary"
                  size="xs"
                  onClick={scaffold}
                  icon={<PlusCircle className="ahi-icon-xs" />}
                  title="AGENTS.md ve .agents/ şablonunu oluştur"
                >
                  Oluştur
                </Button>
              </div>
            </Card>
          )}
        </Section>

        <KnowledgeCard />

        <Section>
          <SectionTitle icon={<Brain className="ahi-icon-xs" />} title="Proje hafızası" count={memoryCount} />
          <Card>
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs flex items-center gap-1.5 font-medium ahi-text-fg">
                <Brain className="ahi-icon-xs ahi-text-brand" />
                {memoryCount ? `${memoryCount} görev kaydı` : 'Henüz kayıt yok'}
              </div>
              <div className="flex items-center gap-1">
                {customizations.memoryPath && (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => openFile(customizations.memoryPath!)}
                    icon={<FileCode className="ahi-icon-xs" />}
                  >
                    Aç
                  </Button>
                )}
                {memoryCount > 0 && (
                  <Button
                    variant={confirmMemoryClear ? 'danger' : 'ghost'}
                    size="xs"
                    onClick={() => {
                      if (!confirmMemoryClear) {
                        setConfirmMemoryClear(true);
                        setTimeout(() => setConfirmMemoryClear(false), 3000);
                        return;
                      }
                      vscode.postMessage({ type: 'CLEAR_PROJECT_MEMORY' });
                      setConfirmMemoryClear(false);
                    }}
                    icon={<Trash2 className="ahi-icon-xs" />}
                  >
                    {confirmMemoryClear ? 'Emin misin?' : 'Temizle'}
                  </Button>
                )}
              </div>
            </div>
            <CodePreview>
              {customizations.memoryContent?.trim()
                ? customizations.memoryContent.slice(-1200)
                : 'Tamamlanan görevler otomatik olarak .ahi/memory.md dosyasına kaydedilir.'}
            </CodePreview>
          </Card>
        </Section>

        <Section>
          <SectionTitle
            icon={<FolderGit2 className="ahi-icon-xs" />}
            title="Beceriler"
            count={customizations.skills.length}
          />
          {customizations.skills.length === 0 ? (
            <EmptyState description="Özel talimatlar tanımlamak için .agents/skills/<ad>.md ekleyin." />
          ) : (
            <div className="flex flex-col gap-1.5">
              {customizations.skills.map((skill) => (
                <ListButton
                  key={skill.name}
                  onClick={() => openFile(skill.path)}
                  icon={<BookOpen className="ahi-icon-md ahi-text-info" />}
                  title={skill.name}
                  description={skill.description}
                  trailing={<ExternalLink className="ahi-icon-xs opacity-50" />}
                />
              ))}
            </div>
          )}
        </Section>

        <Section>
          <SectionTitle
            icon={<Bot className="ahi-icon-xs" />}
            title="Özel alt ajanlar"
            count={customizations.agents.length}
          />
          {customizations.agents.length === 0 ? (
            <EmptyState description=".agents/agents/<ad>.md içinde kendi uzman ajanınızı tanımlayın." />
          ) : (
            <div className="flex flex-col gap-1.5">
              {customizations.agents.map((agent) => (
                <div key={agent.name} className="ahi-list-item items-start p-2">
                  <button
                    type="button"
                    onClick={() => openFile(agent.path)}
                    className="flex min-w-0 flex-1 items-start gap-2 text-left"
                    title="Ajan tanımını aç"
                  >
                    <span className="ahi-toggle-row__icon ahi-text-warning">
                      <Bot className="ahi-icon-xs" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="text-xs truncate font-medium ahi-text-fg">{agent.name}</span>
                        <span className="ahi-badge ahi-bg-base font-mono ahi-text-muted">{agent.role}</span>
                      </span>
                      <span className="ahi-caption mt-0.5 line-clamp-2">{agent.description}</span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {(agent.tools && agent.tools.length > 0 ? agent.tools : ['salt-okunur'])
                          .slice(0, 4)
                          .map((tool) => (
                            <span key={tool} className="ahi-badge ahi-bg-base font-mono ahi-text-muted">
                              {tool}
                            </span>
                          ))}
                      </span>
                    </span>
                  </button>
                  <Button
                    variant={launchRole === agent.name ? 'primary' : 'ghost'}
                    size="xs"
                    onClick={() => selectRole(agent.name)}
                    icon={<Play className="ahi-icon-xs" />}
                    title={`${agent.name} ile görev başlat`}
                  >
                    Görev
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Section>

        {launchForm}

        <Section>
          <SectionTitle icon={<Layers className="ahi-icon-xs" />} title="Yerleşik ajanlar" />
          <div className="flex flex-col gap-1.5">
            {BUILT_IN_SUBAGENT_ROLES.map((agent) => {
              const isCustomized = customizations.agents.some(
                (a) =>
                  a.name.toLowerCase() === agent.role.toLowerCase() ||
                  a.role.toLowerCase() === agent.role.toLowerCase()
              );
              const customAgentDef = customizations.agents.find(
                (a) =>
                  a.name.toLowerCase() === agent.role.toLowerCase() ||
                  a.role.toLowerCase() === agent.role.toLowerCase()
              );

              return (
                <div
                  key={agent.role}
                  className={`rounded-md border p-2 transition ${
                    launchRole === agent.role
                      ? 'ahi-border-brand ahi-bg-info'
                      : 'ahi-border-surface ahi-bg-surface'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => selectRole(agent.role)}
                      className="flex min-w-0 flex-1 items-start gap-2 text-left"
                      title={`${agent.name} ile görev başlat`}
                    >
                      <span className="mt-0.5 shrink-0">
                        {ROLE_ICONS[agent.role] ?? <Bot className="ahi-icon-sm" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium ahi-text-fg truncate">{agent.name}</span>
                          <span className="text-2xs font-mono ahi-text-muted">({agent.role})</span>
                          {isCustomized ? (
                            <span className="text-2xs rounded ahi-bg-warning border ahi-border-warning px-1 font-mono ahi-text-warning shrink-0">
                              Özelleştirildi
                            </span>
                          ) : agent.role === 'manager' ? (
                            <span className="text-2xs rounded ahi-bg-error border ahi-border-error px-1 font-mono ahi-text-error shrink-0 font-medium">
                              Orkestratör
                            </span>
                          ) : (
                            agent.tier && (
                              <span className="text-2xs uppercase font-mono px-1 rounded ahi-bg-input ahi-text-muted border ahi-border-surface shrink-0">
                                {agent.tier}
                              </span>
                            )
                          )}
                        </div>
                        <div className="ahi-caption mt-0.5 line-clamp-2">{agent.description}</div>
                      </div>
                    </button>

                    <div className="flex shrink-0 items-center gap-1">
                      {isCustomized && customAgentDef ? (
                        <>
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => openFile(customAgentDef.path)}
                            title="Özelleştirilmiş ajan dosyasını aç ve kurallarını düzenle"
                            icon={<FileCode className="ahi-icon-xs" />}
                          >
                            Düzenle
                          </Button>
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() =>
                              vscode.postMessage({
                                type: 'RESET_BUILTIN_AGENT',
                                payload: { role: agent.role }
                              })
                            }
                            title="Yerleşik varsayılan ayarlara geri dön"
                            icon={<RotateCcw className="ahi-icon-xs" />}
                          >
                            Sıfırla
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() =>
                            vscode.postMessage({
                              type: 'CUSTOMIZE_BUILTIN_AGENT',
                              payload: { role: agent.role }
                            })
                          }
                          title="Bu ajanın prompt, kural ve izinlerini .agents/ altında özelleştir"
                          icon={<Wrench className="ahi-icon-xs" />}
                        >
                          Özelleştir
                        </Button>
                      )}
                      <Button
                        variant={launchRole === agent.role ? 'primary' : 'ghost'}
                        size="xs"
                        onClick={() => selectRole(agent.role)}
                        icon={<Play className="ahi-icon-xs" />}
                        title={`${agent.name} ile görev başlat`}
                      >
                        Görev
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>

        <Button
          variant="secondary"
          block
          onClick={scaffold}
          disabled={loading}
          icon={
            loading ? (
              <Loader2 className="ahi-icon-xs animate-spin" />
            ) : (
              <PlusCircle className="ahi-icon-xs ahi-text-info" />
            )
          }
        >
          AGENTS.md ve .agents/ şablonlarını oluştur
        </Button>

        <div className="text-2xs flex items-center justify-center gap-1 ahi-text-muted">
          <Search className="ahi-icon-xs" /> Değişiklikler otomatik taranır
        </div>
      </div>
    </div>
  );
};
