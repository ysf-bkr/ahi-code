import { UserSettings } from '@ahicode/core/shared/types';
import { MASKED_KEY } from '@ahicode/core/shared/constants';

export { MASKED_KEY };

export type ApiKeyProvider = keyof UserSettings['apiKeys'];

/**
 * Webview'dan gelen API anahtarlarını mevcut ayarlarla birleştirir.
 *
 * Webview gerçek anahtarları hiç görmez; her kayıtta `MASKED_KEY` yer
 * tutucusunu geri gönderir. Bu yer tutucuyu gerçek değer saymak
 * bellekteki anahtarı ezer ve sonraki model isteğini bozar; bu yüzden
 * "değişmedi" anlamına gelir. Boş dize "anahtarı sil" demektir.
 *
 * Yeni anahtar haritasını ve SecretStorage'a yazılması gerekenleri döndürür.
 */
export function mergeApiKeys(
  current: UserSettings['apiKeys'],
  incoming: UserSettings['apiKeys'] | undefined
): {
  keys: UserSettings['apiKeys'];
  store: Array<{ provider: ApiKeyProvider; key: string }>;
  remove: ApiKeyProvider[];
} {
  const keys: UserSettings['apiKeys'] = { ...current };
  const store: Array<{ provider: ApiKeyProvider; key: string }> = [];
  const remove: ApiKeyProvider[] = [];

  if (!incoming) return { keys, store, remove };

  for (const provider of Object.keys(incoming) as ApiKeyProvider[]) {
    const value = incoming[provider];
    if (value === undefined) continue;

    if (value === MASKED_KEY) continue; // unchanged

    const trimmed = value.trim();
    if (trimmed) {
      keys[provider] = trimmed;
      store.push({ provider, key: trimmed });
    } else {
      delete keys[provider];
      remove.push(provider);
    }
  }

  return { keys, store, remove };
}

/** Ayarlar webview'a gönderilmeden önce gerçek anahtarları yer tutucuyla değiştirir. */
export function maskApiKeys(keys: UserSettings['apiKeys']): UserSettings['apiKeys'] {
  return {
    evren: keys.evren ? MASKED_KEY : '',
    openrouter: keys.openrouter ? MASKED_KEY : '',
    openaiCompatible: keys.openaiCompatible ? MASKED_KEY : ''
  };
}
