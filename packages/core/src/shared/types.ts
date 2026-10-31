/**
 * AhiCode - Eklenti ana bilgisayarı ve webview arayüzünün paylaştığı tipler.
 */

export type ModelProviderType = 'evren' | 'ollama' | 'openrouter' | 'openai-compatible';

export type AgentMode = 'code' | 'plan';

/**
 * Ajanın ne kadar kendi başına ilerleyeceği.
 *
 * - `manual`: spec/plan onayları ve her tur kullanıcıya sorulur.
 * - `guided`: spec/plan otomatik onaylanır, tehlikeli araç çağrıları sorulur.
 * - `auto`: ayrıca görev bitene kadar turlar kendiliğinden sürer.
 *
 * Güvenlik onayları (yazma/komut izinleri) bu ayardan bağımsızdır; otonomi
 * akış duraklamalarını kaldırır, güvenlik kapılarını değil.
 */
export type AutonomyLevel = 'manual' | 'guided' | 'auto';

export interface SandboxSettings {
  mode: 'none' | 'docker';
  image: string;
  network: boolean;
}

export interface ModelRoutingSettings {
  enabled: boolean;
  fastModel?: string;
  deepModel?: string;
  reviewModel?: string;
}

export interface UserSettings {
  /** Kullanıcı en az bir kez ayarları yapılandırıp kaydetti mi? */
  isConfigured?: boolean;
  selectedProvider: ModelProviderType;
  selectedModel: string;
  apiKeys: {
    evren?: string;
    openrouter?: string;
    openaiCompatible?: string;
  };
  apiKeyStatus?: {
    evren: boolean;
    openrouter: boolean;
    openaiCompatible: boolean;
  };
  customBaseUrl?: string;
  openAiCompatibleBaseUrl?: string;
  ollamaBaseUrl?: string;
  /** Model isteği bağlantı zaman aşımı süresi (saniye, varsayılan: 180). Yavaş sağlayıcılar için artırılabilir. */
  requestTimeoutSeconds?: number;
  /** EVREN LLM kullanım koşullarını otomatik kabul et. */
  autoAcceptTerms?: boolean;
  autoApprove: {
    readFiles: boolean;
    writeFiles: boolean;
    executeCommands: boolean;
  };
  /** Kod değişikliklerinden sonra test/lint doğrulaması çalıştırılsın mı? */
  autoVerify?: boolean;
  /** Ajanın kendi başına ilerleme düzeyi (varsayılan: manual). */
  autonomy?: AutonomyLevel;
  /** Görev başında mevcut test durumunu (başlangıç noktası) kaydet. */
  captureBaseline?: boolean;
  /** Otomatik onarımda modele verilecek en fazla geri bildirim denemesi. */
  maxRepairAttempts?: number;
  /** Tek görevde en fazla ajan adımı. */
  maxStepsPerTask?: number;
  /** Görev başına en fazla token bütçesi (0 veya tanımsızsa sınırsız). */
  maxTokensPerTask?: number;
  /**
   * Modelin bağlam penceresi (token). Buda/sıkıştırma eşikleri buna göre
   * hesaplanır; boşsa varsayılan 96.000 kullanılır.
   */
  contextWindowTokens?: number;
  /** Otonom modda en fazla otomatik devam turu (varsayılan: 12). */
  maxContinuations?: number;
  /** Göreve göre hızlı ya da derin akıl yürütme modeli seç. */
  modelRouting?: ModelRoutingSettings;
  /**
   * Rol bazlı model override'ları (alt ajan başına model). Anahtarlar rol
   * adlarıdır (manager, backend, ...); boş bırakılan rol sağlayıcı hazır
   * ayarını ya da seçili modeli kullanır.
   */
  agentModels?: Partial<Record<string, string>>;
  /** Komut yürütme yalıtımı. Varsayılan: ana makine (none). */
  sandbox?: SandboxSettings;
  /** Sağlayıcı destekliyorsa kararlı istem önekini önbelleklenebilir işaretle. */
  promptCaching?: boolean;
  /** Ajan komutlarını gizli süreç yerine VS Code tümleşik terminalinde çalıştır. */
  useIntegratedTerminal?: boolean;
  /**
   * Her dosya yazma/düzenleme öncesi diff görünümünü açar. Otomatik onay açık
   * olsa bile değişiklik gözden geçirilebilir kalsın diye varsayılan açıktır.
   */
  showDiffBeforeWrite?: boolean;
  /**
   * Ollama embedding ile bilgi tabanı üzerinde yerel anlamsal arama.
   * Varsayılan kapalı; her şey kullanıcının makinesinde kalır.
   */
  knowledgeEmbeddings?: {
    enabled: boolean;
    /** Embedding modeli (Ollama örn. nomic-embed-text; EVREN örn. qwen3-embedding-8b). */
    model?: string;
    /**
     * Boşsa Ollama `/api/embed` kullanılır. OpenAI uyumlu bir uç nokta
     * (örn. EVREN `/v1`) verilirse `/embeddings` uç noktası kullanılır.
     */
    baseUrl?: string;
  };
  /**
   * Çağrı haritası: dil sunucusundan fonksiyon çağrı ilişkilerini çıkarır.
   * Varsayılan açık; kapatılırsa araçlar "kapalı" cevabı verir.
   */
  callGraph?: {
    enabled: boolean;
  };
}

export type ToolName =
  | 'read_file'
  | 'write_file'
  | 'edit_file'
  | 'search_files'
  | 'list_directory'
  | 'execute_command'
  | 'run_tests'
  | 'run_linter'
  | 'git_diff'
  | 'git_status'
  | 'invoke_subagent'
  | 'ask_followup_question'
  | 'read_skill'
  | 'get_diagnostics'
  | 'get_definition'
  | 'get_hover'
  | 'undo_change'
  | 'update_plan'
  | 'update_module_plan'
  | 'run_verification'
  | 'get_references'
  | 'get_workspace_symbols'
  | 'index_workspace'
  | 'find_symbol'
  | 'analyze_impact'
  | 'git_create_branch'
  | 'git_commit'
  | 'prepare_pr'
  | 'web_fetch'
  | 'web_search'
  | 'search_memory'
  | 'read_notebook'
  | 'run_parallel_tasks'
  | 'merge_worktree'
  | 'write_spec'
  | 'update_acceptance_criteria'
  | 'write_knowledge_file'
  | 'get_project_knowledge'
  | 'add_knowledge_note'
  | 'get_callers'
  | 'get_callees'
  | 'call_graph_impact'
  | 'find_related_code'
  | 'call_graph_status';

/** Birleşimle aynı listede tutulan çalışma zamanı tablosu (arayüz tamlık testleri için). */
export const TOOL_NAMES: readonly ToolName[] = [
  'read_file',
  'write_file',
  'edit_file',
  'search_files',
  'list_directory',
  'execute_command',
  'run_tests',
  'run_linter',
  'git_diff',
  'git_status',
  'invoke_subagent',
  'ask_followup_question',
  'read_skill',
  'get_diagnostics',
  'get_definition',
  'get_hover',
  'undo_change',
  'update_plan',
  'update_module_plan',
  'run_verification',
  'get_references',
  'get_workspace_symbols',
  'index_workspace',
  'find_symbol',
  'analyze_impact',
  'git_create_branch',
  'git_commit',
  'prepare_pr',
  'web_fetch',
  'web_search',
  'search_memory',
  'read_notebook',
  'run_parallel_tasks',
  'merge_worktree',
  'write_spec',
  'update_acceptance_criteria',
  'write_knowledge_file',
  'get_project_knowledge',
  'add_knowledge_note',
  'get_callers',
  'get_callees',
  'call_graph_impact',
  'find_related_code',
  'call_graph_status'
];

export interface ToolCall {
  id: string;
  name: ToolName;
  args: Record<string, unknown>;
  explanation?: string;
  requiresApproval: boolean;
  /** Onayın neden gerektiği; arayüzde gösterilir ki keyfi görünmesin. */
  approvalReason?: string;
  status: 'pending' | 'approved' | 'rejected' | 'executing' | 'completed' | 'error';
  result?: string;
  error?: string;
}

/** EVREN LLM kullanım kotası; `GET /v1/quota` yanıtından arayüze taşınan alanlar. */
export interface EvrenQuota {
  /** Kayan pencere içinde tüketilen token sayısı. */
  usedTokens: number | null;
  /** Kayan pencerenin token sınırı. */
  windowCap: number | null;
  /** Kayan pencere uzunluğu (dakika). */
  windowMinutes: number | null;
  /** En eski kovanın düştüğü ISO 8601 zamanı. */
  resetAt: string | null;
  /** Günlük (UTC) tüketilen token sayısı. */
  dailyUsedTokens: number | null;
  /** Günlük token sınırı; hesabın sınırı yoksa null. */
  dailyLimitTokens: number | null;
  /** Kalan günlük token sayısı. */
  dailyRemainingTokens: number | null;
  /** Günlük sayacın sıfırlandığı ISO 8601 zamanı. */
  dailyResetAt: string | null;
  /** `ok`, `warn` (>=%75), `critical` (>=%90) veya `unknown`. */
  level: 'ok' | 'warn' | 'critical' | 'unknown';
  /** Kalan kredi bakiyesi (sağlayıcıdan gelen ham metin). */
  remainingCredits: string | null;
  /** Şu anda uçuşta olan istek sayısı. */
  concurrentRequests: number | null;
  /** Hesabın eşzamanlı istek sınırı. */
  concurrencyLimit: number | null;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  isStreaming?: boolean;
  /** Bu asistan turu başarısız olduğunda ayarlanır; arayüz yeniden dene/geri al sunar. */
  error?: string;
  /**
   * Mesajın ait olduğu tur. Bir kullanıcı istemi ve ardından gelen tüm asistan
   * çıktıları aynı kimliği paylaşır; arayüz bunları tek bir yanıt bloğunda
   * toplar. Eski kayıtlarda bulunmayabilir.
   */
  turnId?: string;
}

export interface TaskSummary {
  id: string;
  prompt: string;
  timestamp: number;
  messageCount: number;
  status:
    | 'idle'
    | 'running'
    | 'paused'
    | 'waiting_approval'
    | 'waiting_user_input'
    | 'completed'
    | 'failed'
    | 'cancelled';
}

export interface McpServerInfo {
  name: string;
  command?: string;
  transport?: 'stdio' | 'sse' | 'http';
  endpoint?: string;
  type?: 'stdio' | 'sse' | 'http';
  url?: string;
  status: 'connected' | 'connecting' | 'error' | 'stopped';
  error?: string;
  tools: Array<{ name: string; description: string }>;
}

export interface DiscoveredSkillInfo {
  name: string;
  description: string;
  path: string;
}

export interface CustomAgentInfo {
  name: string;
  role: string;
  description: string;
  path: string;
  tools?: string[];
}

export interface WorkspaceCustomizations {
  hasAgentsMd: boolean;
  agentsMdPath?: string;
  agentsMdContent?: string;
  skills: DiscoveredSkillInfo[];
  agents: CustomAgentInfo[];
  memoryPath?: string;
  memoryContent?: string;
  memoryEntryCount?: number;
}

export interface CheckpointSummary {
  id: string;
  turnIndex: number;
  timestamp: number;
  preview: string;
}

export type PlanStepStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

/**
 * Ajanın yönettiği büyük bir görevdeki adım ve bağımlılıkları.
 * `dependsOn` alanı adım kimliklerine başvurur.
 */
export interface PlanStep {
  id: string;
  title: string;
  description?: string;
  status: PlanStepStatus;
  dependsOn: string[];
  completionCriteria?: string;
  files?: string[];
  /** Bu adımın ait olduğu modül (`update_module_plan` kimliği). */
  moduleId?: string;
  /** Bu adımın karşıladığı kabul kriterleri (`ac-1` biçiminde). */
  criteria?: string[];
  /**
   * Bu adımı yürütecek uzman rol. Yönetici ajan bunu
   * `assign_plan_roles` ile doldurur; model de doğrudan verebilir.
   */
  ownerRole?: string;
  /** `ownerRole` kimden geldi: model mi, deterministik yönlendirme mi. */
  ownerRoleSource?: 'model' | 'routing';
}

export interface TaskPlan {
  goal: string;
  steps: PlanStep[];
  updatedAt: number;
}

/**
 * Modül katmanı. Endüstriyel düzende bağımlılık yönü yukarıdan aşağıyadır:
 * arayüz → uygulama → alan; altyapı ve paylaşılan katman herkesin altındadır.
 */
export type ModuleLayer =
  | 'interface'
  | 'application'
  | 'domain'
  | 'infrastructure'
  | 'shared'
  | 'test'
  | 'docs';

/** Kod yazmadan önce çıkarılan modül haritasının tek kaydı. */
export interface ProjectModule {
  /** Kararlı kimlik (`slug`); plan adımları bunu `moduleId` ile referanslar. */
  id: string;
  name: string;
  layer: ModuleLayer;
  /** Bu modülün sahip olduğu dosya ya da dizin yolları (çalışma alanına göreli). */
  paths: string[];
  /** Tek cümlelik sorumluluk; "ne yapar" sorusunu yanıtlar. */
  responsibility: string;
  /** Bu modülün bağımlı olduğu diğer modül kimlikleri. */
  dependsOn: string[];
  /** Bu modülü yazacak uzman rol (ör. `backend`, `frontend`). */
  ownerRole: string;
  /** Bu modülün karşıladığı kabul kriterleri (`ac-1`). */
  criteria: string[];
}

export interface ModulePlan {
  goal: string;
  modules: ProjectModule[];
  updatedAt: number;
}

/**
 * Yönlendirilmiş iş akışı aşamaları. Hem eklenti ana bilgisayarı hem webview
 * host'a özgü modülleri import etmeden kullanabilsin diye burada tanımlıdır.
 */
export type WorkflowStage = 'onboard' | 'intake' | 'spec' | 'plan' | 'build' | 'review' | 'verify' | 'done';

export interface WorkflowState {
  stage: WorkflowStage;
  /** Giriş aşamasında kullanılan soru/cevap turları; sorguya dönüşmesin diye sınırlı. */
  questionsAsked: number;
  specId?: string;
  specApproved: boolean;
  planApproved: boolean;
  /** Bu oturum için proje bilgisi yüklendi mi? */
  knowledgeReady: boolean;
  updatedAt: number;
  /** İş akışının neden ilerleyemediği; arayüzde dürüstçe gösterilir. */
  blockedReason?: string;
}

export interface AcceptanceCriterionSummary {
  id: string;
  text: string;
  done: boolean;
}

/** Webview'a gönderilen düz spec görünümü. */
export interface TaskSpecSummary {
  id: string;
  goal: string;
  scope: string[];
  outOfScope: string[];
  assumptions: string[];
  acceptanceCriteria: AcceptanceCriterionSummary[];
  files: string[];
  risk: 'low' | 'medium' | 'high';
  status: 'draft' | 'approved' | 'superseded';
}

export interface KnowledgeSummary {
  ready: boolean;
  fileCount: number;
  symbolCount: number;
  summarizedCount: number;
  indexedAt?: number;
  lastCommit?: string;
}

/** Arayüz için bilgi tabanı durumu, okunabilir notlarla birlikte. */
export interface KnowledgeStatusPayload extends KnowledgeSummary {
  notes: string;
  project: string;
  conventions: string;
  decisions: string;
  modules: Array<{ path: string; summary: string }>;
}

/** Git çalışma ağacı durumunun bir dosya kaydı (`git status --short`). */
export interface GitFileChange {
  path: string;
  /** İndeks (stage) durum harfi (M, A, D, R, ...); izlenmeyenlerde '?'. */
  indexStatus: string;
  /** Çalışma ağacı durum harfi; değişmemişse ' '. */
  workTreeStatus: string;
  /** Dosyanın diskteki son değişim zamanı (mtime, ms); silinmişse tanımsız. */
  modifiedAt?: number;
  /** Dosya boyutu (bayt); silinmişse tanımsız. */
  sizeBytes?: number;
  /** Çalışma ağacında dosya artık yoksa true. */
  deleted?: boolean;
}

/** Son commit listesinin bir kaydı (`git log`). */
export interface GitCommitSummary {
  hash: string;
  subject: string;
  /** Yazar tarihi (ISO 8601); eski kayıtlarda bulunmayabilir. */
  date?: string;
}

/** Değişiklikler ekranının yükü: çalışma alanının canlı Git durumu. */
export interface GitChangesPayload {
  isRepository: boolean;
  branch: string;
  files: GitFileChange[];
  commits: GitCommitSummary[];
  error?: string;
}

/**
 * Canlı olarak yürütülen alt ajanın izleme durumu ve çalışma detayları.
 */
export interface SubagentRunInfo {
  role: string;
  displayName?: string;
  task: string;
  status: 'starting' | 'running' | 'completed' | 'failed' | 'cancelled';
  currentTool?: string;
  step?: number;
  maxSteps?: number;
  worktreePath?: string;
  isolate?: boolean;
  startedAt: number;
  updatedAt?: number;
}

/**
 * Webview içi gezinme hedefleri (ekranlar).
 */
export type NavigationDestination =
  | 'chat'
  | 'settings'
  | 'history'
  | 'changes'
  | 'mcp'
  | 'agents'
  | 'callgraph'
  | 'about';

/** Çağrı grafiği ekranının düğüm kaydı; motor tiplerinden bağımsız taşınabilir biçim. */
export interface CallGraphPanelNode {
  id: string;
  name: string;
  kind: string;
  file: string;
  startLine: number;
  exported: boolean;
  isTest: boolean;
  className?: string;
}

/** Komşu listesi satırı: düğüm + kaç adımda ulaşıldığı + çağrı satırları. */
export interface CallGraphPanelNeighbor extends CallGraphPanelNode {
  depth: number;
  lines: number[];
}

export interface CallGraphPanelRequest {
  action: 'status' | 'search' | 'neighbors' | 'rebuild';
  query?: string;
  nodeId?: string;
  depth?: number;
}

export interface CallGraphPanelResult {
  action: CallGraphPanelRequest['action'];
  ready: boolean;
  building: boolean;
  progress?: number;
  message: string;
  stats?: { files: number; nodes: number; edges: number; updatedAt?: number; incompleteFiles: number };
  matches?: CallGraphPanelNode[];
  callers?: CallGraphPanelNeighbor[];
  callees?: CallGraphPanelNeighbor[];
}

/**
 * Kullanıcı bildirim düzeyleri ve nesnesi.
 */
export type ToastLevel = 'info' | 'warning' | 'error';

export interface ToastNotification {
  id: string;
  level: ToastLevel;
  message: string;
}

/**
 * Görev durumu enum tipi.
 */
export type TaskStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'waiting_approval'
  | 'waiting_user_input'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Doğrulama adımları istatistiği.
 */
export interface TaskVerificationStats {
  status: 'not_run' | 'running' | 'passed' | 'failed' | 'skipped';
  attempts: number;
  summary?: string;
  lastRunAt?: number;
  /**
   * Doğrulamanın neden çalışmadığı. `no-commands` dışındaki her neden "bitti"
   * kapısını kapatır: test yok diye görev sessizce tamamlanmış sayılmaz.
   */
  skippedReason?: 'no-commands' | 'no-workspace' | 'aborted';
}

/**
 * Görev tüketim ve dosya istatistikleri.
 */
export interface TaskStats {
  totalTokens: number;
  stepsCount: number;
  filesModified: string[];
  lastModel?: string;
  modelRoutingReason?: string;
  verification?: TaskVerificationStats;
}

/**
 * Ajanın kullanıcıya yönelttiği soru.
 */
export interface PendingQuestion {
  toolCallId: string;
  question: string;
}

/**
 * Ajanın kullanıcıdan beklediği spec veya plan onayı.
 */
export interface PendingApproval {
  kind: 'spec' | 'plan';
  title: string;
  details: string;
}

export interface TaskState {
  id: string;
  prompt: string;
  mode: AgentMode;
  status: TaskStatus;
  messages: ChatMessage[];
  pendingToolCall?: ToolCall;
  pendingQuestion?: PendingQuestion;
  checkpoints?: CheckpointSummary[];
  plan?: TaskPlan;
  /** Kod yazmadan önce çıkarılan modül haritası. */
  modules?: ModulePlan;
  /** Yönlendirilmiş iş akışı aşaması ve onaylar. */
  workflow?: WorkflowState;
  /** Arayüz için etkin spec özeti. */
  spec?: TaskSpecSummary;
  knowledge?: KnowledgeSummary;
  /** Ajan kullanıcıdan spec ya da plan onayı beklerken ayarlanır. */
  pendingApproval?: PendingApproval;
  /** Canlı olarak yürütülen alt ajan bilgisi (varsa). */
  activeSubagent?: SubagentRunInfo;
  stats: TaskStats;
}

/**
 * Webview -> Eklenti mesajları
 */
export type WebviewToExtensionMessage =
  | { type: 'SEND_MESSAGE'; payload: { text: string; mode?: AgentMode } }
  | { type: 'EDIT_MESSAGE'; payload: { messageId: string; text: string; mode?: AgentMode } }
  | { type: 'NEW_SESSION' }
  | { type: 'SET_MODE'; payload: { mode: AgentMode } }
  | { type: 'CANCEL_TASK' }
  | { type: 'RESUME_TASK' }
  | { type: 'RETRY_LAST_TURN' }
  | { type: 'APPROVE_TOOL'; payload: { toolCallId: string } }
  | { type: 'REJECT_TOOL'; payload: { toolCallId: string; reason?: string } }
  | { type: 'APPROVE_SPEC' }
  | { type: 'APPROVE_PLAN' }
  | { type: 'REJECT_APPROVAL'; payload?: { reason?: string } }
  | { type: 'SAVE_SETTINGS'; payload: Partial<UserSettings> }
  | { type: 'REQUEST_SETTINGS' }
  | { type: 'FETCH_MODELS'; payload: { provider: ModelProviderType; apiKey?: string; baseUrl?: string } }
  | { type: 'FETCH_QUOTA' }
  | { type: 'GET_TASK_HISTORY' }
  | { type: 'LOAD_TASK'; payload: { taskId: string } }
  /** Başka bir sohbeti etkin yapar; çalışan diğer oturumlar durmaz. */
  | { type: 'SELECT_SESSION'; payload: { sessionId: string } }
  | { type: 'DELETE_TASK'; payload: { taskId: string } }
  | { type: 'EXPORT_SESSION'; payload: { taskId: string; format: 'json' | 'markdown' } }
  | { type: 'IMPORT_SESSION' }
  | { type: 'USER_REPLY'; payload: { toolCallId?: string; reply: string } }
  | { type: 'GET_MCP_STATUS' }
  | { type: 'OPEN_MCP_CONFIG' }
  | { type: 'RESTART_MCP' }
  | { type: 'GET_CUSTOMIZATIONS' }
  | { type: 'GET_KNOWLEDGE_STATUS' }
  | { type: 'REINDEX_KNOWLEDGE'; payload?: { force?: boolean } }
  | { type: 'CLEAR_KNOWLEDGE' }
  | { type: 'ADD_KNOWLEDGE_NOTE'; payload: { note: string } }
  | { type: 'INIT_AGENTS_TEMPLATE' }
  | { type: 'OPEN_AGENTS_FILE'; payload: { path: string } }
  | { type: 'REWIND_TO_CHECKPOINT'; payload: { checkpointId: string } }
  | { type: 'REVERT_LAST_SNAPSHOT' }
  | { type: 'REVERT_TOOL_SNAPSHOT'; payload: { toolCallId: string } }
  | { type: 'REVERT_COMMAND'; payload: { toolCallId: string } }
  | { type: 'SHOW_TOOL_DIFF'; payload: { toolCallId: string } }
  | { type: 'PREVIEW_TOOL_DIFF'; payload: { toolCallId: string } }
  | { type: 'SHOW_FILE_DIFF'; payload: { filePath: string } }
  | { type: 'OPEN_FILE'; payload: { filePath: string } }
  | { type: 'GET_GIT_CHANGES' }
  | { type: 'SHOW_COMMIT'; payload: { commitHash: string } }
  | { type: 'START_SUBAGENT'; payload: { role: string; task: string; context?: string; isolate?: boolean } }
  | { type: 'GET_ABOUT_INFO' }
  | { type: 'CALLGRAPH_QUERY'; payload: CallGraphPanelRequest }
  | { type: 'CLEAR_PROJECT_MEMORY' }
  | { type: 'CUSTOMIZE_BUILTIN_AGENT'; payload: { role: string } }
  | { type: 'RESET_BUILTIN_AGENT'; payload: { role: string } }
  | { type: 'OPEN_EXTERNAL'; payload: { url: string } };

export interface VsCodeThemeConfig {
  editorFontFamily: string;
  editorFontSize: number;
  editorFontWeight: string;
  terminalFontFamily: string;
  terminalFontSize: number;
}

/**
 * Eklenti -> Webview mesajları
 */
export type ExtensionToWebviewMessage =
  | { type: 'TASK_STATE_UPDATE'; payload: TaskState; sessionKey?: string }
  | { type: 'STREAM_CHUNK'; payload: { messageId: string; text: string }; sessionKey?: string }
  | { type: 'SETTINGS_LOADED'; payload: UserSettings }
  | { type: 'MODELS_LOADED'; payload: { provider: ModelProviderType; models: string[]; error?: string } }
  | {
      type: 'QUOTA_LOADED';
      payload: { provider: ModelProviderType; quota?: EvrenQuota; error?: string };
    }
  | { type: 'TASK_HISTORY_LOADED'; payload: { history: TaskSummary[] } }
  | { type: 'MCP_STATUS_LOADED'; payload: { servers: McpServerInfo[] } }
  | { type: 'CUSTOMIZATIONS_LOADED'; payload: WorkspaceCustomizations }
  | { type: 'KNOWLEDGE_STATUS_LOADED'; payload: KnowledgeStatusPayload }
  | { type: 'GIT_CHANGES_LOADED'; payload: GitChangesPayload }
  | { type: 'VSCODE_THEME_CHANGED'; payload: VsCodeThemeConfig }
  | { type: 'ABOUT_INFO_LOADED'; payload: AboutInfo }
  | { type: 'CALLGRAPH_RESULT'; payload: CallGraphPanelResult }
  | { type: 'NOTIFICATION'; payload: { level: ToastLevel; message: string }; sessionKey?: string }
  /** Etkin oturum değişti; arayüz kendi odağını buna göre taşır. */
  | { type: 'SESSION_ACTIVATED'; payload: { sessionKey: string } }
  /** Bellekteki oturumların özeti (arka planda çalışanlar dahil). */
  | { type: 'SESSIONS_CHANGED'; payload: { sessions: SessionInfoLoaded[] } };

/** Arayüze taşınan oturum özeti. */
export interface SessionInfoLoaded {
  key: string;
  id: string;
  prompt: string;
  status: TaskStatus;
  running: boolean;
  messageCount: number;
}

export interface AboutInfo {
  extensionVersion: string;
  vscodeVersion: string;
  platform: string;
  isTrusted: boolean;
  workspaceFolders: string[];
}
