/**
 * Ayarlar ekranı için model kataloğu sorgusu.
 *
 * Webview mesaj işleyicisinden ayrıldı; sağlayıcı listesi mantığı VS Code
 * host'u olmadan test edilebilir. Fonksiyonlar düz kimlik listesi döndürür;
 * hata durumunda istisna fırlar ve arayüz, sonradan 404 verecek uydurma bir
 * kimlik yazmak yerine serbest metin model alanını korur.
 */
import { DEFAULT_PROVIDER_URLS, HTTP_TIMEOUT_MS } from '@ahicode/core/shared/constants';
import { normalizeBaseUrl } from '@ahicode/core/providers/openai';
import { isRecord } from '@ahicode/core/shared/errors';
import { classifyModelCapability } from '@ahicode/core/shared/modelCapability';

export interface ModelCatalogRequest {
  provider: string;
  /** Arayüzde yazılan anahtar; maskelenmiş yer tutucu olabilir. */
  apiKey?: string;
  baseUrl?: string;
  /** SecretStorage'da duran anahtarlar; arayüz maske gönderdiğinde kullanılır. */
  storedKeys: Partial<Record<'evren' | 'openrouter' | 'openaiCompatible', string>>;
  storedOllamaBaseUrl?: string;
  storedOpenAiCompatibleBaseUrl?: string;
  storedCustomBaseUrl?: string;
}

/** Açılır listede gösterilecek en fazla kayıt; sağlayıcılar binlerce döndürebilir. */
const MAX_MODELS = 50;

function pickApiKey(provided: string | undefined, stored: string | undefined): string {
  const value = (provided || '').trim();
  // Webview yalnızca maske görür, maskelenmiş değer "değişmedi" demektir.
  if (!value || value.includes('•')) return stored || '';
  return value;
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}.`);
  }
  return response.json();
}

function isRecordArray(value: unknown, key: string): Array<Record<string, unknown>> {
  if (!isRecord(value)) return [];
  const list = value[key];
  if (!Array.isArray(list)) return [];
  return list.filter((item): item is Record<string, unknown> => isRecord(item));
}

async function fetchEvrenModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const root = baseUrl.replace(/\/+$/, '');
  const data = await fetchJson(`${root}/models`, {
    headers: {
      'X-API-Key': apiKey,
      Authorization: `Bearer ${apiKey}`
    },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS.modelList)
  });
  // Sohbet/model seçici yalnızca konuşabilen modelleri listeler: embedding,
  // rerank, OCR, ses ve görüntü üretim modelleri kendi özelliklerinde
  // kullanılır; kod yazma modeli olarak seçilmez (görüş modelleri kalır).
  return isRecordArray(data, 'data')
    .filter((item) => typeof item.id === 'string')
    .map((item) => item.id as string)
    .filter((id) => {
      const capability = classifyModelCapability(id);
      return capability === 'chat' || capability === 'vision';
    });
}

async function fetchOpenRouterModels(apiKey: string): Promise<string[]> {
  const data = await fetchJson(`${DEFAULT_PROVIDER_URLS.openrouter}/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS.modelList)
  });
  return isRecordArray(data, 'data')
    .filter((item) => typeof item.id === 'string')
    .map((item) => item.id as string)
    .slice(0, MAX_MODELS);
}

async function fetchOllamaModels(baseUrl: string): Promise<string[]> {
  // `/api/tags` sunucu kökünde, `/v1` altında değil; kullanıcılar sık sık sohbet
  // adresini yapıştırır, uç noktayı kurmadan önce normalize et.
  const root = normalizeBaseUrl(baseUrl, ['/v1']);
  const data = await fetchJson(`${root}/api/tags`, {
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS.modelList)
  });
  return isRecordArray(data, 'models')
    .filter((item) => typeof item.name === 'string')
    .map((item) => item.name as string);
}

async function fetchOpenAiCompatibleModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const root = baseUrl.replace(/\/+$/, '');
  const data = await fetchJson(`${root}/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS.modelList)
  });
  return isRecordArray(data, 'data')
    .filter((item) => typeof item.id === 'string')
    .map((item) => item.id as string);
}

/**
 * Bir sağlayıcı için seçilebilir model kimliklerini çözer.
 *
 * Sağlayıcıya ulaşılamazsa istisna fırlatır; çağıran hatayı bildirir ve tahmin
 * edilmiş bir kimlik yerine boş liste gösterir.
 */
export async function fetchModelIds(request: ModelCatalogRequest): Promise<string[]> {
  switch (request.provider) {
    case 'evren': {
      const apiKey = pickApiKey(request.apiKey, request.storedKeys.evren);
      if (!apiKey) return ['auto'];
      const models = await fetchEvrenModels(
        request.baseUrl || request.storedCustomBaseUrl || DEFAULT_PROVIDER_URLS.evren,
        apiKey
      );
      return models.includes('auto') ? models : ['auto', ...models];
    }

    case 'openrouter':
      return fetchOpenRouterModels(pickApiKey(request.apiKey, request.storedKeys.openrouter));

    case 'ollama':
      return fetchOllamaModels(
        request.baseUrl || request.storedOllamaBaseUrl || DEFAULT_PROVIDER_URLS.ollama
      );

    case 'openai-compatible':
      return fetchOpenAiCompatibleModels(
        request.baseUrl || request.storedOpenAiCompatibleBaseUrl || DEFAULT_PROVIDER_URLS.lmstudio,
        pickApiKey(request.apiKey, request.storedKeys.openaiCompatible)
      );

    default:
      return [];
  }
}
