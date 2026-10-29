/**
 * Çağrı haritasının veri modeli.
 *
 * Harita yalnızca fonksiyon/metot/sınıf düğümlerini ve çağıran→çağrılan
 * ilişkilerini tutar. Dosya içeriği saklanmaz; yalnızca yollar, adlar ve satır
 * numaraları. Bu, haritayı hem küçük hem de paylaşılabilir tutar.
 */

/** Bir düğümün türü. */
export type CallGraphNodeKind = 'function' | 'method' | 'class';

/** İlişkinin güven kaynağı. */
export type CallGraphConfidence = 'exact' | 'estimated';

/** Bir dosyanın tarama durumu. */
export type CallGraphFileStatus = 'complete' | 'partial' | 'failed' | 'skipped';

export interface CallGraphNode {
  /** Kararlı kimlik: `dosya#sınıf.ad` ya da `dosya#ad[:sıra]`. */
  id: string;
  name: string;
  kind: CallGraphNodeKind;
  /** Çalışma alanı köküne göreli, eğik çizgili yol. */
  file: string;
  startLine: number;
  endLine: number;
  exported: boolean;
  /** Test dosyasında tanımlıysa doğrudur. */
  isTest: boolean;
  /** Sınıf üyesiyse sınıfın adı. */
  className?: string;
}

export interface CallGraphEdge {
  from: string;
  to: string;
  /** Çağrının yapıldığı satırlar; aynı çift için tek kenar tutulur. */
  lines: number[];
  confidence: CallGraphConfidence;
}

export interface CallGraphFileMeta {
  /** Dosya içeriğinin SHA-256'sı; değişmediyse yeniden taranmaz. */
  hash: string;
  status: CallGraphFileStatus;
  nodeCount: number;
  edgeCount: number;
  /** Bu dosyadan proje dışına yapılan çağrı sayısı. */
  externalCalls: number;
  scannedAt: number;
  /** Başarısız/kısmi ise neden. */
  reason?: string;
}

export interface CallGraphMeta {
  /** Biçim sürümü; uyumsuzsa harita yeniden üretilir. */
  version: number;
  /** Kök yol (çok köklü çalışma alanında ayırt edici). */
  root: string;
  createdAt: number;
  updatedAt: number;
  /** Haritayı üretirken yanıt veren dil sunucuları (bilgi amaçlı). */
  languageServers: string[];
  nodeCount: number;
  edgeCount: number;
  fileCount: number;
  /** Eksik/kısmi taranan dosya sayısı. */
  incompleteFiles: number;
}

export interface CallGraphDocument {
  meta: CallGraphMeta;
  nodes: CallGraphNode[];
  edges: CallGraphEdge[];
  files: Record<string, CallGraphFileMeta>;
}

/** Sorgu sonucunda dönen tek bir komşu düğüm. */
export interface CallGraphNeighbor {
  node: CallGraphNode;
  /** Kökten bu düğüme kaç adımda ulaşıldığı. */
  depth: number;
  /** Kenar üzerindeki çağrı satırları. */
  lines: number[];
  confidence: CallGraphConfidence;
}

export interface CallGraphImpactResult {
  directCallers: CallGraphNeighbor[];
  indirectCallers: CallGraphNeighbor[];
  /** Etkilenen test düğümleri. */
  affectedTests: CallGraphNeighbor[];
  /** Etkilenen dosyalar (göreli yollar). */
  affectedFiles: string[];
  /** Dışa aktarılan bir sembol değişiyorsa doğrudur. */
  exportedChange: boolean;
  /** Harita eksik olduğu için sonucun sınırlı olduğu durumlar. */
  warnings: string[];
}

/** Harita hazır değilken araçların döndürdüğü durum bilgisi. */
export interface CallGraphStatus {
  ready: boolean;
  building: boolean;
  /** 0-100 arası ilerleme; bilinmiyorsa undefined. */
  progress?: number;
  meta?: CallGraphMeta;
  message: string;
}
