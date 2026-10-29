/**
 * Depodan gelen kod için parmak izi kapsamlı onay.
 *
 * Hem `.ahi/mcp_config.json` (sunucu komutları) hem `.ahi/hooks.json`
 * (hook komutları) depoya commit edilen bir dosyanın kullanıcının
 * makinesinde kod çalıştırmasına izin verir. Aynı sözleşmeyi paylaşırlar:
 *
 * - güvenilmeyen çalışma alanında asla çalışmazlar;
 * - güvenilir çalışma alanında dosya içeriği başına bir kez sorulur;
 * - karar, içeriğin SHA-256 parmak izine bağlı saklanır; her düzenleme
 * yeniden sorar;
 * - cevabı saklayacak yer yoksa güvenli tarafta kalınır.
 */
import * as crypto from 'crypto';

/** Köklerin çakışmaması için çalışma alanına özgü sabit depolama anahtarı. */
export function approvalStorageKey(scope: 'mcp' | 'hooks', workspaceRoot: string): string {
  const rootHash = crypto.createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 16);
  return `ahi:${scope}:approval:${rootHash}`;
}

/** Düzenlemeleri algılamak için yapılandırma yükünün SHA-256'sı. */
export function fingerprintOf(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export interface ApprovalRecord {
  fingerprint: string;
  approved: boolean;
}

/** İki VS Code Memento'sunun da sağladığı en küçük depo biçimi. */
export interface ApprovalStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: ApprovalRecord): Promise<void> | Thenable<void>;
}

export interface FingerprintApprovalOptions {
  scope: 'mcp' | 'hooks';
  workspaceRoot: string;
  fingerprint: string;
  /** Yalnızca bu parmak izi için kayıtlı karar yoksa sorulur. */
  ask: () => Promise<boolean>;
  /** Yoksa (CLI, hostsuz testler) hiçbir şey otomatik onaylanmaz. */
  store?: ApprovalStore;
}

/**
 * Bu içeriğin saklanmış kararını döndürür; yoksa kullanıcıya sorup cevabı
 * saklar. Çağıran taraf çalışma alanı güvenini yine de kendisi kontrol etmelidir.
 */
export async function requestFingerprintApproval(options: FingerprintApprovalOptions): Promise<boolean> {
  const { store, scope, workspaceRoot, fingerprint } = options;
  if (!store) return false;

  const key = approvalStorageKey(scope, workspaceRoot);
  const stored = store.get<ApprovalRecord>(key);
  if (stored && stored.fingerprint === fingerprint) {
    return stored.approved;
  }

  const approved = await options.ask();
  await store.update(key, { fingerprint, approved });
  return approved;
}
