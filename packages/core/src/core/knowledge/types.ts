/**
 * Bilgi tabanı tipleri.
 *
 * Bilgi tabanı `.ahi/knowledge/` altında yaşar ve bilinçli olarak
 * dosya tabanlıdır (Markdown + JSONL); kullanıcılar veritabanı olmadan
 * okuyup düzenleyebilir. SQLite, gerçek bir ihtiyaç doğana kadar kullanılmaz.
 */

export type KnowledgeSource = 'static' | 'model' | 'manual';

export interface KnowledgeFileRecord {
  /** Eğik çizgili, çalışma alanına göreli yol. */
  path: string;
  /** İndeksleme anındaki dosya içeriğinin SHA-256'sı. */
  hash: string;
  /** Tembel üretilen model özeti ya da kullanıcı yazımı özet. */
  summary?: string;
  /** Statik olarak çıkarılan dışa aktarılan sembol adları. */
  exports: string[];
  /** Statik olarak çıkarılan normalize import belirteçleri. */
  imports: string[];
  bytes: number;
  updatedAt: number;
  source: KnowledgeSource;
}

export interface KnowledgeSymbolRecord {
  name: string;
  kind: string;
  file: string;
  line: number;
  /** Sembol gövdesinin kapsayıcı bitiş satırı; aralıklı read_file çağrılarını sağlar. */
  endLine?: number;
}

export interface KnowledgeIndexState {
  root: string;
  /** İndeksin oluşturulduğu veya yenilendiği son git commit'i. */
  lastCommit?: string;
  indexedAt: number;
  fileCount: number;
  symbolCount: number;
  /** İndeksin taşınabilsin diye biçim sürümü. */
  version: number;
}

export interface KnowledgeStatus {
  ready: boolean;
  root?: string;
  indexedAt?: number;
  lastCommit?: string;
  fileCount: number;
  symbolCount: number;
  /** Özeti olan dosyalar (model ya da elle). */
  summarizedCount: number;
  staleFiles: string[];
  notesLength: number;
}

export interface KnowledgeSearchHit {
  kind: 'file' | 'symbol' | 'note' | 'module' | 'decision';
  title: string;
  detail: string;
  /** Sonuç bir dosyayı gösteriyorsa çalışma alanına göreli yol. */
  path?: string;
  line?: number;
}

export interface KnowledgeIndexOptions {
  signal?: AbortSignal;
  maxFiles?: number;
  maxFileBytes?: number;
  /** Hash'leri yeniden kullanmak yerine özeti zorla yenile. */
  force?: boolean;
}
