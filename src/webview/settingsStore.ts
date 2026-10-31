/**
 * Kenar çubuğu sağlayıcısı için ayar kalıcılığı.
 *
 * Webview bağlantısı okunur kalsın ve varsayılan/eşitleme/geri yükleme
 * kuralları tek yerden incelenebilsin diye `SidebarProvider`'dan ayrıldı.
 * VS Code depolama erişimi yalnızca burada; sağlayıcı bellekteki kopyayı tutar.
 */
import * as vscode from 'vscode';
import { UserSettings, VsCodeThemeConfig } from '@ahicode/core/shared/types';
import { API_KEY_PROVIDERS, DEFAULT_USER_SETTINGS, VALID_PROVIDERS } from '@ahicode/core/shared/constants';
import { normalizeRole } from '@ahicode/core/shared/agents/routing';
import { maskApiKeys, mergeApiKeys } from './apiKeys';

const SETTINGS_KEY = 'ahi_settings';

/** VS Code ayarından gelen serbest metni geçerli otonomi seviyesine indirger. */
function readAutonomy(value: string | undefined): UserSettings['autonomy'] {
  return value === 'guided' || value === 'auto' ? value : 'manual';
}

/** `agentModels` ayarını okur; yalnızca bilinen roller ve dolu model adları geçerlidir. */
function readAgentModels(config: vscode.WorkspaceConfiguration): UserSettings['agentModels'] {
  const raw = config.get<Record<string, unknown>>('agentModels');
  if (!raw || typeof raw !== 'object') return undefined;
  const result: Record<string, string> = {};
  for (const [role, model] of Object.entries(raw)) {
    const normalized = normalizeRole(role);
    if (normalized && typeof model === 'string' && model.trim()) {
      result[normalized] = model.trim();
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/** Yeni kurulum için gereken ayarlar: yerel öncelikli, hesap gerekmez. */
export function loadDefaultSettings(): UserSettings {
  const config = vscode.workspace.getConfiguration('ahiCode');
  const provider = config.get<string>('selectedProvider');
  const explicitProvider = readExplicitSetting<string>(config, 'selectedProvider');
  const explicitModel = readExplicitSetting<string>(config, 'selectedModel');
  const hasExplicitConfig = Boolean(explicitProvider || explicitModel);
  return {
    ...DEFAULT_USER_SETTINGS,
    isConfigured: hasExplicitConfig,
    selectedProvider: (provider && (VALID_PROVIDERS as readonly string[]).includes(provider)
      ? provider
      : DEFAULT_USER_SETTINGS.selectedProvider) as UserSettings['selectedProvider'],
    selectedModel: config.get<string>('selectedModel') || DEFAULT_USER_SETTINGS.selectedModel,
    autoVerify: config.get<boolean>('autoVerify') ?? true,
    autonomy: readAutonomy(config.get<string>('autonomy')),
    captureBaseline: config.get<boolean>('captureBaseline') ?? false,
    modelRouting: {
      enabled: config.get<boolean>('modelRoutingEnabled') ?? false,
      fastModel: config.get<string>('fastModel') || undefined,
      deepModel: config.get<string>('deepModel') || undefined,
      reviewModel: config.get<string>('reviewModel') || undefined
    },
    agentModels: readAgentModels(config),
    autoAcceptTerms: config.get<boolean>('autoAcceptTerms') ?? false,
    promptCaching: config.get<boolean>('promptCaching') ?? true,
    useIntegratedTerminal: config.get<boolean>('useIntegratedTerminal') ?? true,
    showDiffBeforeWrite: config.get<boolean>('showDiffBeforeWrite') ?? true,
    knowledgeEmbeddings: {
      enabled: config.get<boolean>('knowledgeEmbeddings') ?? false,
      model: config.get<string>('embeddingModel') || 'nomic-embed-text',
      baseUrl: config.get<string>('embeddingBaseUrl') || undefined
    },
    callGraph: {
      enabled: config.get<boolean>('callGraphEnabled') ?? true
    },
    sandbox: {
      mode: config.get<string>('sandboxMode') === 'docker' ? 'docker' : 'none',
      image: config.get<string>('sandboxImage') || 'node:20-bookworm',
      network: config.get<boolean>('sandboxNetwork') ?? false
    }
  };
}

/**
 * Bir ayarı yalnızca kullanıcı (ya da çalışma alanı) açıkça ayarladıysa okur.
 *
 * `config.get()` package.json varsayılanını da döndürdüğü için bu eşitleme,
 * herhangi bir ayar değişikliğinde kullanıcının arayüzden yeni kaydettiği
 * değerin üzerine yazıyordu.
 */
export function readExplicitSetting<T>(config: vscode.WorkspaceConfiguration, key: string): T | undefined {
  const info = config.inspect<T>(key);
  if (!info) return undefined;
  return info.workspaceFolderValue ?? info.workspaceValue ?? info.globalValue;
}

/**
 * Mevcut oturum ayarlarının üzerine yalnızca açıkça yapılandırılmış VS Code
 * ayarlarını uygular; dokunulmamış ayarlar oturumdaki değerini korur.
 */
export function mergeExplicitConfiguration(
  current: UserSettings,
  config: vscode.WorkspaceConfiguration
): UserSettings {
  const pick = <T>(key: string, fallback: T): T => readExplicitSetting<T>(config, key) ?? fallback;
  const provider = readExplicitSetting<string>(config, 'selectedProvider');
  const explicitModel = readExplicitSetting<string>(config, 'selectedModel');
  const configured = Boolean(current.isConfigured || provider || explicitModel);

  return {
    ...current,
    isConfigured: configured,
    selectedProvider: (provider && (VALID_PROVIDERS as readonly string[]).includes(provider)
      ? provider
      : current.selectedProvider) as UserSettings['selectedProvider'],
    selectedModel: pick('selectedModel', current.selectedModel),
    autoVerify: pick('autoVerify', current.autoVerify ?? true),
    autonomy: readAutonomy(pick('autonomy', current.autonomy ?? 'manual')),
    captureBaseline: pick('captureBaseline', current.captureBaseline ?? false),
    modelRouting: {
      enabled: pick('modelRoutingEnabled', current.modelRouting?.enabled ?? false),
      fastModel: pick('fastModel', '') || current.modelRouting?.fastModel,
      deepModel: pick('deepModel', '') || current.modelRouting?.deepModel,
      reviewModel: pick('reviewModel', '') || current.modelRouting?.reviewModel
    },
    agentModels: readAgentModels(config) ?? current.agentModels,
    autoAcceptTerms: pick('autoAcceptTerms', current.autoAcceptTerms ?? false),
    promptCaching: pick('promptCaching', current.promptCaching ?? true),
    useIntegratedTerminal: pick('useIntegratedTerminal', current.useIntegratedTerminal ?? true),
    showDiffBeforeWrite: pick('showDiffBeforeWrite', current.showDiffBeforeWrite ?? true),
    knowledgeEmbeddings: {
      enabled: pick('knowledgeEmbeddings', current.knowledgeEmbeddings?.enabled ?? false),
      model: pick('embeddingModel', '') || current.knowledgeEmbeddings?.model || 'nomic-embed-text',
      baseUrl: pick('embeddingBaseUrl', '') || current.knowledgeEmbeddings?.baseUrl
    },
    callGraph: {
      enabled: pick('callGraphEnabled', current.callGraph?.enabled ?? true)
    },
    sandbox: {
      mode: pick('sandboxMode', current.sandbox?.mode ?? 'none') === 'docker' ? 'docker' : 'none',
      image: pick('sandboxImage', '') || current.sandbox?.image || 'node:20-bookworm',
      network: pick('sandboxNetwork', current.sandbox?.network ?? false)
    }
  };
}

/** Kullanıcıya görünen bir ayar değiştiyse ve ajan bilgilendirilmeli mi? */
export function settingsDiffer(a: UserSettings, b: UserSettings): boolean {
  return (
    a.isConfigured !== b.isConfigured ||
    a.selectedProvider !== b.selectedProvider ||
    a.selectedModel !== b.selectedModel ||
    a.autoVerify !== b.autoVerify ||
    a.autonomy !== b.autonomy ||
    a.captureBaseline !== b.captureBaseline ||
    a.autoAcceptTerms !== b.autoAcceptTerms ||
    a.promptCaching !== b.promptCaching ||
    a.useIntegratedTerminal !== b.useIntegratedTerminal ||
    a.showDiffBeforeWrite !== b.showDiffBeforeWrite ||
    a.knowledgeEmbeddings?.enabled !== b.knowledgeEmbeddings?.enabled ||
    a.knowledgeEmbeddings?.model !== b.knowledgeEmbeddings?.model ||
    a.callGraph?.enabled !== b.callGraph?.enabled ||
    a.modelRouting?.enabled !== b.modelRouting?.enabled ||
    a.modelRouting?.fastModel !== b.modelRouting?.fastModel ||
    a.modelRouting?.deepModel !== b.modelRouting?.deepModel ||
    a.modelRouting?.reviewModel !== b.modelRouting?.reviewModel ||
    JSON.stringify(a.agentModels ?? {}) !== JSON.stringify(b.agentModels ?? {}) ||
    a.knowledgeEmbeddings?.baseUrl !== b.knowledgeEmbeddings?.baseUrl ||
    a.sandbox?.mode !== b.sandbox?.mode ||
    a.sandbox?.image !== b.sandbox?.image ||
    a.sandbox?.network !== b.sandbox?.network
  );
}

/**
 * Kaydedilmiş ayarları ve sağlayıcı API anahtarlarını geri yükler.
 *
 * Eski sürümlerin yazdığı düz metin anahtarlar atılır ve kaldırılan
 * token/maliyet bütçesi alanları filtrelenir; böylece eski sınırlar geri dönmez.
 */
export async function restoreSettings(
  context: vscode.ExtensionContext,
  current: UserSettings
): Promise<UserSettings> {
  const next: UserSettings = { ...current };
  const savedConfig = context.globalState.get<Partial<UserSettings>>(SETTINGS_KEY);

  if (savedConfig) {
    // Kaldırılan bütçe/sınır ayarlarını eski kayıtlardan temiz süzeriz; iç
    // varsayılanlar DEFAULT_USER_SETTINGS'ten gelir, kullanıcı override'ı yok.
    const hadLegacyBudget =
      savedConfig.maxTokensPerTask !== undefined ||
      (savedConfig as Record<string, unknown>).maxCostPerTaskUsd !== undefined ||
      savedConfig.maxRepairAttempts !== undefined ||
      savedConfig.maxStepsPerTask !== undefined ||
      savedConfig.maxContinuations !== undefined;
    const {
      apiKeys: legacyApiKeys,
      apiKeyStatus: _legacyStatus,
      maxTokensPerTask: _legacyTokenBudget,
      maxCostPerTaskUsd: _legacyCostBudget,
      maxRepairAttempts: _legacyRepair,
      maxStepsPerTask: _legacySteps,
      maxContinuations: _legacyContinuations,
      ...safeConfig
    } = savedConfig as Partial<UserSettings> & {
      maxTokensPerTask?: number;
      maxCostPerTaskUsd?: number;
      maxRepairAttempts?: number;
      maxStepsPerTask?: number;
      maxContinuations?: number;
    };

    Object.assign(next, safeConfig);
    if (savedConfig.isConfigured !== undefined) {
      next.isConfigured = savedConfig.isConfigured;
    } else {
      next.isConfigured = true;
    }
    if (legacyApiKeys || hadLegacyBudget) {
      await context.globalState.update(SETTINGS_KEY, safeConfig);
    }
  }

  for (const provider of API_KEY_PROVIDERS) {
    const key = await context.secrets.get(`ahi_key_${provider}`);
    if (key) {
      next.apiKeys[provider] = key;
      next.isConfigured = true;
    }
  }

  return next;
}

/**
 * Arayüz değişikliklerini kalıcılaştırır.
 *
 * API anahtarları alan alan birleştirilir: webview her kayıtta maskelenmiş
 * bir yer tutucu gönderir; nesneyi yaymak gerçek anahtarın yerine maskeyi
 * koyar ve sonraki model isteğini bozar.
 */
export async function persistSettings(
  context: vscode.ExtensionContext,
  current: UserSettings,
  incoming: Partial<UserSettings>
): Promise<UserSettings> {
  const { apiKeys: incomingKeys, ...rest } = incoming;
  const next: UserSettings = {
    ...current,
    ...rest,
    isConfigured: true,
    apiKeys: { ...current.apiKeys }
  };

  await context.globalState.update(SETTINGS_KEY, {
    isConfigured: true,
    selectedProvider: next.selectedProvider,
    selectedModel: next.selectedModel,
    autoApprove: next.autoApprove,
    customBaseUrl: next.customBaseUrl,
    openAiCompatibleBaseUrl: next.openAiCompatibleBaseUrl,
    ollamaBaseUrl: next.ollamaBaseUrl,
    autoVerify: next.autoVerify,
    autonomy: next.autonomy ?? 'manual',
    captureBaseline: next.captureBaseline,
    autoAcceptTerms: next.autoAcceptTerms ?? false,
    requestTimeoutSeconds: next.requestTimeoutSeconds ?? 180,
    modelRouting: next.modelRouting,
    agentModels: next.agentModels,
    sandbox: next.sandbox,
    promptCaching: next.promptCaching,
    useIntegratedTerminal: next.useIntegratedTerminal,
    showDiffBeforeWrite: next.showDiffBeforeWrite,
    knowledgeEmbeddings: next.knowledgeEmbeddings,
    callGraph: next.callGraph
  });

  const merged = mergeApiKeys(next.apiKeys, incomingKeys);
  next.apiKeys = merged.keys;
  for (const { provider, key } of merged.store) {
    await context.secrets.store(`ahi_key_${provider}`, key);
  }
  for (const provider of merged.remove) {
    await context.secrets.delete(`ahi_key_${provider}`);
  }

  // Arayüz seçimlerini VS Code ayarlarıyla eşitle; buradaki hata zaten
  // uygulanmış bellek içi ayarları geçersiz kılmamalı.
  try {
    const config = vscode.workspace.getConfiguration('ahiCode');
    await Promise.all([
      config.update('selectedProvider', next.selectedProvider, vscode.ConfigurationTarget.Global),
      config.update('selectedModel', next.selectedModel, vscode.ConfigurationTarget.Global),
      config.update('autonomy', next.autonomy ?? 'manual', vscode.ConfigurationTarget.Global)
    ]);
  } catch {
    // Ayar kaydetme başarısız olsa bile oturum ayarları geçerli kalır.
  }

  return next;
}

/** Webview için ayar yükü: gerçek API anahtarları host'tan asla çıkmaz. */
export function safeSettingsForWebview(settings: UserSettings): UserSettings {
  return {
    ...settings,
    apiKeys: maskApiKeys(settings.apiKeys),
    apiKeyStatus: {
      evren: Boolean(settings.apiKeys.evren),
      openrouter: Boolean(settings.apiKeys.openrouter),
      openaiCompatible: Boolean(settings.apiKeys.openaiCompatible)
    }
  };
}

/** Webview'ın kullanıcının editör/terminal ayarlarından yansıttığı yazı tipi ayarları. */
export function readThemeConfig(): VsCodeThemeConfig {
  const editorConfig = vscode.workspace.getConfiguration('editor');
  const terminalConfig = vscode.workspace.getConfiguration('terminal.integrated');
  return {
    editorFontFamily: editorConfig.get<string>('fontFamily') || '',
    editorFontSize: editorConfig.get<number>('fontSize') || 13,
    editorFontWeight: editorConfig.get<string>('fontWeight') || 'normal',
    terminalFontFamily: terminalConfig.get<string>('fontFamily') || '',
    terminalFontSize: terminalConfig.get<number>('fontSize') || editorConfig.get<number>('fontSize') || 13
  };
}
