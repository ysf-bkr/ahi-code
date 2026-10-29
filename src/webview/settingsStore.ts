/**
 * Kenar çubuğu sağlayıcısı için ayar kalıcılığı.
 *
 * Webview bağlantısı okunur kalsın ve varsayılan/eşitleme/geri yükleme
 * kuralları tek yerden incelenebilsin diye `SidebarProvider`'dan ayrıldı.
 * VS Code depolama erişimi yalnızca burada; sağlayıcı bellekteki kopyayı tutar.
 */
import * as vscode from 'vscode';
import { UserSettings, VsCodeThemeConfig } from '../shared/types';
import { API_KEY_PROVIDERS, DEFAULT_USER_SETTINGS, VALID_PROVIDERS } from '../shared/constants';
import { maskApiKeys, mergeApiKeys } from './apiKeys';

const SETTINGS_KEY = 'ahi_settings';

/** VS Code ayarından gelen serbest metni geçerli otonomi seviyesine indirger. */
function readAutonomy(value: string | undefined): UserSettings['autonomy'] {
  return value === 'guided' || value === 'auto' ? value : 'manual';
}

/** Yeni kurulum için gereken ayarlar: yerel öncelikli, hesap gerekmez. */
export function loadDefaultSettings(): UserSettings {
  const config = vscode.workspace.getConfiguration('ahiCode');
  const provider = config.get<string>('selectedProvider');
  return {
    ...DEFAULT_USER_SETTINGS,
    selectedProvider: (provider && (VALID_PROVIDERS as readonly string[]).includes(provider)
      ? provider
      : DEFAULT_USER_SETTINGS.selectedProvider) as UserSettings['selectedProvider'],
    selectedModel: config.get<string>('selectedModel') || DEFAULT_USER_SETTINGS.selectedModel,
    autoVerify: config.get<boolean>('autoVerify') ?? true,
    autonomy: readAutonomy(config.get<string>('autonomy')),
    captureBaseline: config.get<boolean>('captureBaseline') ?? false,
    maxRepairAttempts: config.get<number>('maxRepairAttempts') ?? 2,
    maxStepsPerTask: config.get<number>('maxStepsPerTask') ?? 25,
    maxTokensPerTask: config.get<number>('maxTokensPerTask') ?? 0,
    maxContinuations: config.get<number>('maxContinuations') ?? 12,
    modelRouting: {
      enabled: config.get<boolean>('modelRoutingEnabled') ?? false,
      fastModel: config.get<string>('fastModel') || undefined,
      deepModel: config.get<string>('deepModel') || undefined,
      reviewModel: config.get<string>('reviewModel') || undefined
    },
    autoAcceptTerms: config.get<boolean>('autoAcceptTerms') ?? false,
    promptCaching: config.get<boolean>('promptCaching') ?? true,
    useIntegratedTerminal: config.get<boolean>('useIntegratedTerminal') ?? true,
    showDiffBeforeWrite: config.get<boolean>('showDiffBeforeWrite') ?? true,
    knowledgeEmbeddings: {
      enabled: config.get<boolean>('knowledgeEmbeddings') ?? false,
      model: config.get<string>('embeddingModel') || 'nomic-embed-text'
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

  return {
    ...current,
    selectedProvider: (provider && (VALID_PROVIDERS as readonly string[]).includes(provider)
      ? provider
      : current.selectedProvider) as UserSettings['selectedProvider'],
    selectedModel: pick('selectedModel', current.selectedModel),
    autoVerify: pick('autoVerify', current.autoVerify ?? true),
    autonomy: readAutonomy(pick('autonomy', current.autonomy ?? 'manual')),
    captureBaseline: pick('captureBaseline', current.captureBaseline ?? false),
    maxRepairAttempts: pick('maxRepairAttempts', current.maxRepairAttempts ?? 2),
    maxStepsPerTask: pick('maxStepsPerTask', current.maxStepsPerTask ?? 25),
    maxTokensPerTask: pick('maxTokensPerTask', current.maxTokensPerTask ?? 0),
    maxContinuations: pick('maxContinuations', current.maxContinuations ?? 12),
    modelRouting: {
      enabled: pick('modelRoutingEnabled', current.modelRouting?.enabled ?? false),
      fastModel: pick('fastModel', '') || current.modelRouting?.fastModel,
      deepModel: pick('deepModel', '') || current.modelRouting?.deepModel,
      reviewModel: pick('reviewModel', '') || current.modelRouting?.reviewModel
    },
    autoAcceptTerms: pick('autoAcceptTerms', current.autoAcceptTerms ?? false),
    promptCaching: pick('promptCaching', current.promptCaching ?? true),
    useIntegratedTerminal: pick('useIntegratedTerminal', current.useIntegratedTerminal ?? true),
    showDiffBeforeWrite: pick('showDiffBeforeWrite', current.showDiffBeforeWrite ?? true),
    knowledgeEmbeddings: {
      enabled: pick('knowledgeEmbeddings', current.knowledgeEmbeddings?.enabled ?? false),
      model: pick('embeddingModel', '') || current.knowledgeEmbeddings?.model || 'nomic-embed-text'
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
    a.selectedProvider !== b.selectedProvider ||
    a.selectedModel !== b.selectedModel ||
    a.autoVerify !== b.autoVerify ||
    a.autonomy !== b.autonomy ||
    a.captureBaseline !== b.captureBaseline ||
    a.maxRepairAttempts !== b.maxRepairAttempts ||
    a.maxStepsPerTask !== b.maxStepsPerTask ||
    a.maxTokensPerTask !== b.maxTokensPerTask ||
    a.maxContinuations !== b.maxContinuations ||
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
    const {
      apiKeys: legacyApiKeys,
      apiKeyStatus: _legacyStatus,
      maxTokensPerTask: legacyTokenBudget,
      maxCostPerTaskUsd: legacyCostBudget,
      ...safeConfig
    } = savedConfig as Partial<UserSettings> & {
      maxTokensPerTask?: number;
      maxCostPerTaskUsd?: number;
    };

    Object.assign(next, safeConfig);
    if (legacyApiKeys || legacyTokenBudget !== undefined || legacyCostBudget !== undefined) {
      await context.globalState.update(SETTINGS_KEY, safeConfig);
    }
  }

  for (const provider of API_KEY_PROVIDERS) {
    const key = await context.secrets.get(`ahi_key_${provider}`);
    if (key) next.apiKeys[provider] = key;
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
  const next: UserSettings = { ...current, ...rest, apiKeys: { ...current.apiKeys } };

  await context.globalState.update(SETTINGS_KEY, {
    selectedProvider: next.selectedProvider,
    selectedModel: next.selectedModel,
    autoApprove: next.autoApprove,
    customBaseUrl: next.customBaseUrl,
    openAiCompatibleBaseUrl: next.openAiCompatibleBaseUrl,
    ollamaBaseUrl: next.ollamaBaseUrl,
    autoVerify: next.autoVerify,
    autonomy: next.autonomy ?? 'manual',
    captureBaseline: next.captureBaseline,
    maxRepairAttempts: next.maxRepairAttempts,
    maxStepsPerTask: next.maxStepsPerTask,
    maxTokensPerTask: next.maxTokensPerTask,
    maxContinuations: next.maxContinuations,
    modelRouting: next.modelRouting,
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
      config.update('autonomy', next.autonomy ?? 'manual', vscode.ConfigurationTarget.Global),
      config.update('maxStepsPerTask', next.maxStepsPerTask ?? 25, vscode.ConfigurationTarget.Global),
      config.update('maxTokensPerTask', next.maxTokensPerTask ?? 0, vscode.ConfigurationTarget.Global),
      config.update('maxContinuations', next.maxContinuations ?? 12, vscode.ConfigurationTarget.Global)
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
    editorLineHeight: editorConfig.get<number>('lineHeight') || 0,
    terminalFontFamily: terminalConfig.get<string>('fontFamily') || '',
    terminalFontSize: terminalConfig.get<number>('fontSize') || editorConfig.get<number>('fontSize') || 13
  };
}
