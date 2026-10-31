/**
 * Modüller arasında paylaşılan sabitlerin tek kaynağı.
 *
 * Kurallar:
 * - İki veya daha fazla modülün kullandığı değer buraya gelir (bkz. version.ts).
 * - Tek modülün kullandığı değer o modülde kalır.
 * - Bu değerlerin kopyasını satır içine yazmayın; her zaman import edin, böylece
 * bir yerdeki değişiklik diğerlerinden kopmaz.
 */
import { EXTENSION_VERSION } from './version';
import type { ModelProviderType, TaskState, UserSettings } from './types';

/** MCP sunucularına ve HTTP kimlik başlıklarına bildirilen ad. */
export const CLIENT_NAME = 'AhiCode';

/** HTTP User-Agent / kimlik başlıkları için değer. */
export const USER_AGENT = `${CLIENT_NAME}/${EXTENSION_VERSION}`;

/** Genel depo adresi. */
export const REPO_URL = 'https://github.com/ysf-bkr/ahi-code';

/** AhiCode çalışma alanı ana klasörü. */
export const AHI_DIR = '.ahi';

/** {@link AHI_DIR} içindeki alt klasörler. */
export const AHI_SUBDIRS = {
  knowledge: 'knowledge',
  specs: 'specs',
  snapshots: 'snapshots',
  checkpoints: 'checkpoints',
  worktrees: 'worktrees'
} as const;

/** {@link AHI_DIR} içindeki dosya adları. */
export const AHI_FILES = {
  permissions: 'permissions.json',
  mcpConfig: 'mcp_config.json',
  hooks: 'hooks.json',
  auditLog: 'audit.log',
  verificationBaseline: 'verification-baseline.json'
} as const;

/**
 * Modele geri verilen araç sonuçları için çıktı sınırı. Daha büyük sonuçlar
 * kırpılır; bu sınır tek bir gürültülü komutun veya sayfanın bağlam
 * penceresini doldurmasını engeller.
 */
export const MAX_TOOL_OUTPUT_CHARS = 15_000;

/** Çalışma alanı komutu için varsayılan zaman aşımı. */
export const COMMAND_TIMEOUT_MS = 120_000;

/** Milisaniye cinsinden ağ isteği zaman aşımları. */
export const HTTP_TIMEOUT_MS = {
  /** web_fetch / web_search istekleri. */
  web: 20_000,
  /** Sağlayıcı model listesi ve sağlık kontrolü istekleri. */
  modelList: 35_000
} as const;

/** Ayarlar ekranında sunulan varsayılan sağlayıcı adresleri. */
export const DEFAULT_PROVIDER_URLS = {
  evren: 'https://evren-llmapi.ssyz.org.tr/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  lmstudio: 'http://localhost:1234/v1',
  ollama: 'http://localhost:11434'
} as const;

/** Desteklenen geçerli model sağlayıcı kimlikleri. */
export const VALID_PROVIDERS: readonly ModelProviderType[] = [
  'evren',
  'ollama',
  'openrouter',
  'openai-compatible'
] as const;

/** Güvenli kasada (SecretStorage) saklanan API anahtarı sağlayıcıları. */
export const API_KEY_PROVIDERS = ['evren', 'openrouter', 'openaiCompatible'] as const;

/** Webview'a gerçek API anahtarı yerine gönderilen yer tutucu. */
export const MASKED_KEY = '••••••••••••••••';

/** İlk açılış ve sıfırlama için varsayılan kullanıcı ayarları. */
export const DEFAULT_USER_SETTINGS: UserSettings = {
  isConfigured: false,
  selectedProvider: 'ollama',
  selectedModel: 'llama3.1',
  apiKeys: {},
  autoAcceptTerms: false,
  ollamaBaseUrl: DEFAULT_PROVIDER_URLS.ollama,
  requestTimeoutSeconds: 180,
  autoApprove: {
    readFiles: true,
    writeFiles: false,
    executeCommands: false
  },
  autoVerify: true,
  autonomy: 'manual',
  maxRepairAttempts: 2,
  // 0 = sınırsız: turlar yalnızca kullanıcı opt-in bir sınır verirse duraklatılır.
  maxStepsPerTask: 0,
  maxTokensPerTask: 0,
  maxContinuations: 12,
  useIntegratedTerminal: true
};

/**
 * Sohbetin etkinleşmesi için gereken minimum ayarların yapılıp yapılmadığını denetler.
 * Kullanıcı henüz ayarları kaydetmediyse veya seçili sağlayıcının zorunlu
 * alanları eksikse sohbet kilitli kalır.
 */
export function isChatConfigured(settings?: Partial<UserSettings>): boolean {
  if (!settings || settings.isConfigured !== true) {
    return false;
  }
  const provider = settings.selectedProvider;
  if (!provider) {
    return false;
  }
  if (provider === 'evren') {
    return Boolean(settings.apiKeys?.evren || settings.apiKeyStatus?.evren);
  }
  if (provider === 'openrouter') {
    return Boolean(settings.apiKeys?.openrouter || settings.apiKeyStatus?.openrouter);
  }
  if (provider === 'openai-compatible') {
    return Boolean(
      (settings.openAiCompatibleBaseUrl?.trim() || settings.customBaseUrl?.trim()) &&
        settings.selectedModel?.trim()
    );
  }
  if (provider === 'ollama') {
    return Boolean(settings.selectedModel?.trim());
  }
  return true;
}

/** İlk oturum için boş görev durumu. */
export const DEFAULT_TASK_STATE: TaskState = {
  id: '',
  prompt: '',
  mode: 'code',
  status: 'idle',
  messages: [],
  stats: {
    totalTokens: 0,
    stepsCount: 0,
    filesModified: []
  }
};
