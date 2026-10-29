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
import { TaskState, WorkspaceCustomizations } from '@shared/types';
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
}

const ROLE_ICONS: Record<string, React.ReactNode> = {
  manager: <Crown className="h-3.5 w-3.5 text-amber-400" />,
  analyst: <Target className="h-3.5 w-3.5 text-indigo-400" />,
  architect: <Compass className="h-3.5 w-3.5 text-[var(--ahi-brand-400)]" />,
  backend: <Server className="h-3.5 w-3.5 text-blue-400" />,
  frontend: <Palette className="h-3.5 w-3.5 text-cyan-400" />,
  mobile: <Smartphone className="h-3.5 w-3.5 text-violet-400" />,
  native: <Cpu className="h-3.5 w-3.5 text-orange-400" />,
  database: <Database className="h-3.5 w-3.5 text-teal-400" />,
  devops: <Terminal className="h-3.5 w-3.5 text-pink-400" />,
  explorer: <Search className="h-3.5 w-3.5 text-yellow-400" />,
  git: <FolderGit2 className="h-3.5 w-3.5 text-red-400" />,
  quality: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />,
  security: <ShieldCheck className="h-3.5 w-3.5 text-rose-400" />,
  coder: <Wrench className="h-3.5 w-3.5 text-emerald-400" />,
  tester: <TestTube2 className="h-3.5 w-3.5 text-amber-400" />,
  reviewer: <ShieldCheck className="h-3.5 w-3.5 text-rose-400" />
};

const CodePreview: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <pre className="text-2xs mt-1.5 max-h-24 overflow-hidden whitespace-pre-wrap break-words rounded border border-[var(--ahi-surface-border)] bg-[var(--ahi-input-bg)] p-2 font-mono leading-relaxed text-[var(--ahi-muted-fg)]">
    {children}
  </pre>
);

export const AgentsView: React.FC<AgentsViewProps> = ({ onBack, state }) => {
  const [customizations, setCustomizations] = useState<WorkspaceCustomizations>({
    hasAgentsMd: false,
    skills: [],
    agents: []
  });
  const [loading, setLoading] = useState(true);
  const [confirmMemoryClear, setConfirmMemoryClear] = useState(false);
  // Subagent launcher: the selected role gets a task description and an
  // optional isolated-worktree switch before it is started.
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
    // Hiyerarşi: uzmanları yalnızca yönetici başlatır. Kullanıcı arayüzden
    // doğrudan uzman (security, backend, ...) çalıştıramaz; kartlar bilgilendirme
    // amaçlıdır ve yalnızca @manager için görev formu açılır.
    if (role !== 'manager') return;
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
    // The result arrives as chat messages and notifications; reset the form.
    setTimeout(() => {
      setLaunching(false);
      setLaunchRole(null);
      setLaunchTask('');
      setLaunchIsolate(false);
    }, 600);
  };

  const launchForm = launchRole ? (
    <Card className="flex flex-col gap-2">
      <div className="text-xs font-semibold text-[var(--ahi-fg)]">Alt ajan görevi: {launchRole}</div>
      <Textarea
        className="w-full resize-none font-mono text-xs"
        rows={3}
        placeholder="Bu ajan ne yapsın? Görevi kısaca ve net tanımlayın."
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
          icon={launching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
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
        actions={
          <IconButton label="Yeniden tara" onClick={refresh}>
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin text-[var(--status-info-fg)]' : ''}`} />
          </IconButton>
        }
      />

      <div className="ahi-screen-body">
        {state?.activeSubagent && (
          <Card className="border-[var(--ahi-brand-500)]/40 bg-[var(--ahi-brand-500)]/10">
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--ahi-brand-400)] opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--ahi-brand-400)]" />
                </span>
                <span className="text-xs font-semibold text-[var(--ahi-fg)] truncate">
                  Aktif Alt Ajan: {state.activeSubagent.displayName || state.activeSubagent.role}
                </span>
              </div>
              <span className="text-2xs font-mono text-[var(--ahi-brand-400)] shrink-0">
                {state.activeSubagent.isolate ? 'İzole Worktree' : 'Çalışma Alanı'}
              </span>
            </div>
            <p className="mt-1 text-2xs text-[var(--ahi-muted-fg)] line-clamp-2">
              {state.activeSubagent.task}
            </p>
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
                    <span>İşlem yürütülüyor…</span>
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
          </Card>
        )}

        <Card>
          <div className="flex items-start gap-2">
            <span className="ahi-toggle-row__icon h-7 w-7 text-[var(--status-info-fg)]">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <div>
              <div className="text-sm font-semibold text-[var(--ahi-fg)]">Projeye özel ajan sistemi</div>
              <p className="ahi-caption mt-0.5">
                Codex ve Claude Code ile uyumlu <code className="ahi-code-inline">AGENTS.md</code>, beceriler
                ve özel alt ajanlar otomatik algılanır.
              </p>
            </div>
          </div>
        </Card>

        <Section>
          <SectionTitle icon={<BookOpen className="h-3 w-3" />} title="Proje yönergeleri" />
          {customizations.hasAgentsMd ? (
            <Card className="border-[var(--status-success-border)]">
              <div className="flex items-center justify-between">
                <span className="text-xs flex items-center gap-1.5 font-medium text-[var(--ahi-fg)]">
                  <CheckCircle2 className="h-3 w-3 text-[var(--status-success-fg)]" /> AGENTS.md aktif
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => openFile('AGENTS.md')}
                  icon={<FileCode className="h-2.5 w-2.5" />}
                >
                  Aç
                </Button>
              </div>
              <CodePreview>{customizations.agentsMdContent?.slice(0, 500) || '(boş)'}</CodePreview>
            </Card>
          ) : (
            <EmptyState
              title="AGENTS.md bulunamadı"
              description="Proje kuralları ve mimari notları her göreve otomatik olarak eklenir."
            />
          )}
        </Section>

        <KnowledgeCard />

        <Section>
          <SectionTitle icon={<Brain className="h-3 w-3" />} title="Proje hafızası" count={memoryCount} />
          <Card>
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs flex items-center gap-1.5 font-medium text-[var(--ahi-fg)]">
                <Brain className="h-3 w-3 text-violet-400" />
                {memoryCount ? `${memoryCount} görev kaydı` : 'Henüz kayıt yok'}
              </div>
              <div className="flex items-center gap-1">
                {customizations.memoryPath && (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => openFile(customizations.memoryPath!)}
                    icon={<FileCode className="h-2.5 w-2.5" />}
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
                    icon={<Trash2 className="h-2.5 w-2.5" />}
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
            icon={<FolderGit2 className="h-3 w-3" />}
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
                  icon={<BookOpen className="h-4 w-4 text-teal-400" />}
                  title={skill.name}
                  description={skill.description}
                  trailing={<ExternalLink className="h-3 w-3 opacity-50" />}
                />
              ))}
            </div>
          )}
        </Section>

        <Section>
          <SectionTitle
            icon={<Bot className="h-3 w-3" />}
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
                    <span className="ahi-toggle-row__icon h-5 w-5 text-pink-400">
                      <Bot className="h-2.5 w-2.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="text-xs truncate font-medium text-[var(--ahi-fg)]">
                          {agent.name}
                        </span>
                        <span className="ahi-badge bg-[var(--vscode-sideBar-background)] font-mono text-[var(--ahi-muted-fg)]">
                          {agent.role}
                        </span>
                      </span>
                      <span className="ahi-caption mt-0.5 line-clamp-2">{agent.description}</span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {(agent.tools && agent.tools.length > 0 ? agent.tools : ['salt-okunur'])
                          .slice(0, 4)
                          .map((tool) => (
                            <span
                              key={tool}
                              className="ahi-badge bg-[var(--vscode-sideBar-background)] font-mono text-[var(--ahi-muted-fg)]"
                            >
                              {tool}
                            </span>
                          ))}
                      </span>
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => selectRole(agent.name)}
                    icon={<Play className="h-2.5 w-2.5" />}
                    disabled
                    title="Uzmanları yalnızca yönetici başlatır"
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
          <SectionTitle icon={<Layers className="h-3 w-3" />} title="Yerleşik ajanlar" />
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
                      ? 'border-[var(--ahi-brand-400)] bg-[var(--status-info-bg)]'
                      : 'border-[var(--ahi-surface-border)] bg-[var(--ahi-surface)]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => selectRole(agent.role)}
                      className="flex min-w-0 flex-1 items-start gap-2 text-left"
                      title={
                        agent.role === 'manager'
                          ? 'Yönetici ajanla görev başlat'
                          : 'Uzmanları yönetici başlatır; bu kart bilgilendirme amaçlıdır'
                      }
                    >
                      <span className="mt-0.5 shrink-0">
                        {ROLE_ICONS[agent.role] ?? <Bot className="h-3.5 w-3.5" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium text-[var(--ahi-fg)] truncate">
                            {agent.name}
                          </span>
                          <span className="text-2xs font-mono text-[var(--ahi-muted-fg)]">
                            ({agent.role})
                          </span>
                          {isCustomized ? (
                            <span className="text-2xs rounded bg-amber-500/15 border border-amber-500/30 px-1 font-mono text-amber-400 shrink-0">
                              Özelleştirildi
                            </span>
                          ) : agent.role === 'manager' ? (
                            <span className="text-2xs rounded bg-red-500/15 border border-red-500/30 px-1 font-mono text-red-400 shrink-0 font-medium">
                              Orkestratör
                            </span>
                          ) : (
                            agent.tier && (
                              <span className="text-2xs uppercase font-mono px-1 rounded bg-[var(--ahi-input-bg)] text-[var(--ahi-muted-fg)] border border-[var(--ahi-surface-border)] shrink-0">
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
                            icon={<FileCode className="h-2.5 w-2.5" />}
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
                            icon={<RotateCcw className="h-2.5 w-2.5" />}
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
                          icon={<Wrench className="h-2.5 w-2.5" />}
                        >
                          Özelleştir
                        </Button>
                      )}
                      <Button
                        variant={launchRole === agent.role ? 'primary' : 'ghost'}
                        size="xs"
                        onClick={() => selectRole(agent.role)}
                        icon={<Play className="h-2.5 w-2.5" />}
                        disabled={agent.role !== 'manager'}
                        title={
                          agent.role === 'manager'
                            ? 'Yönetici ajanla görev başlat'
                            : 'Uzmanları yalnızca yönetici başlatır'
                        }
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
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <PlusCircle className="h-3 w-3 text-[var(--status-info-fg)]" />
            )
          }
        >
          AGENTS.md ve .agents/ şablonlarını oluştur
        </Button>

        <div className="text-2xs flex items-center justify-center gap-1 text-[var(--ahi-muted-fg)]">
          <Search className="h-2.5 w-2.5" /> Değişiklikler otomatik taranır
        </div>
      </div>
    </div>
  );
};
