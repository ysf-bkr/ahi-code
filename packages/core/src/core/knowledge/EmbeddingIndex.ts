/**
 * Bilgi tabanı için yerel anlamsal arama.
 *
 * Ollama embedding uç noktası kullanır (varsayılan model: nomic-embed-text),
 * böylece her şey kullanıcının makinesinde kalır; sunucu tarafı indeksleme
 * yoktur. Vektörler `.ahi/knowledge/embeddings.jsonl` içinde içerik
 * hash'ine göre önbelleklenir; değişmeyen özet ve notlar yeniden gömülmez.
 *
 * Her hata `undefined`'a düşer ve çağıran mevcut alt dize aramasına döner;
 * anlamsal arama tamamen ek bir katmandır.
 */
import * as path from 'path';
import * as fs from 'fs/promises';
import { assertSafeUrl } from '../../tools/web';

const EMBEDDINGS_FILE = 'embeddings.jsonl';
/** Tek çağrı kümesinde gömülecek metinler için üst sınır. */
const EMBED_BATCH_SIZE = 32;
/** Arama başına yeni gömülecek derlem kaydı için üst sınır. */
const MAX_NEW_EMBEDDINGS_PER_SEARCH = 512;
/** Bu süreden uzun istekler kullanılamaz sayılır. */
const REQUEST_TIMEOUT_MS = 20_000;

export interface EmbeddingCorpusEntry {
  key: string;
  text: string;
  hash: string;
}

export interface EmbeddingMatch {
  key: string;
  score: number;
}

/** Eşit uzunluktaki vektörler için kosinüs benzerliği; uyumsuz girdide 0. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

interface StoredEmbedding {
  key: string;
  hash: string;
  vector: number[];
}

export type EmbedFn = (texts: string[], signal?: AbortSignal) => Promise<number[][] | undefined>;

export class EmbeddingIndex {
  private entries = new Map<string, StoredEmbedding>();
  private loadedDir?: string;

  constructor(
    private readonly options: {
      baseUrl: string;
      model: string;
      /** Testler için enjekte edilebilir; varsayılan sağlayıcının uç noktası. */
      embedFn?: EmbedFn;
      /** `ollama` → `/api/embed`; `openai` → `/embeddings` (EVREN gibi). */
      style?: 'ollama' | 'openai';
      /** OpenAI uyumlu uç noktalar için Bearer anahtarı (gizli depodan gelir). */
      apiKey?: string;
    }
  ) {}

  private get embed(): EmbedFn {
    return (
      this.options.embedFn ??
      (async (texts: string[], signal?: AbortSignal) => {
        const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
        const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
        const style = this.options.style ?? 'ollama';
        const root = this.options.baseUrl.replace(/\/+$/, '');
        const url = style === 'openai' ? `${root}/embeddings` : `${root}/api/embed`;
        // OpenAI tarzı uç nokta gizli anahtar ve bilgi tabanı metni taşır:
        // yerel sunucu (loopback) istisna; gerisi HTTPS + genel adres denetimi.
        // Kötü niyetli bir ayar değişikliği anahtarı uzak sunucuya taşıyamaz.
        if (style === 'openai') {
          let target: URL;
          try {
            target = new URL(url);
          } catch {
            return undefined;
          }
          const host = target.hostname.toLowerCase().replace(/^\[|\]$/g, '');
          const loopback = host === 'localhost' || host === '::1' || host.startsWith('127.');
          if (!loopback) {
            if (target.protocol !== 'https:') return undefined;
            try {
              await assertSafeUrl(url);
            } catch {
              return undefined;
            }
          }
        }
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (style === 'openai' && this.options.apiKey) {
          headers.Authorization = `Bearer ${this.options.apiKey}`;
        }
        // Ollama `input: string[]`, OpenAI uyumlu uç noktalar da dizi kabul eder.
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ model: this.options.model, input: texts }),
          signal: combined
        });
        if (!res.ok) return undefined;
        const data: unknown = await res.json();
        const parsed = this.parseEmbeddings(data, style);
        return parsed;
      })
    );
  }

  /** İki uç noktanın farklı yanıt şeklini tek biçime indirger. */
  private parseEmbeddings(data: unknown, style: 'ollama' | 'openai'): number[][] | undefined {
    if (style === 'ollama') {
      const embeddings = (data as { embeddings?: unknown }).embeddings;
      if (!Array.isArray(embeddings)) return undefined;
      return embeddings.filter((item): item is number[] => Array.isArray(item));
    }
    // OpenAI: { data: [{ embedding: number[], index }] }
    const list = (data as { data?: unknown }).data;
    if (!Array.isArray(list)) return undefined;
    return list
      .map((item) => (item as { embedding?: unknown }).embedding)
      .filter((item): item is number[] => Array.isArray(item));
  }

  private async load(dir: string): Promise<void> {
    if (this.loadedDir === dir) return;
    this.loadedDir = dir;
    this.entries.clear();
    try {
      const raw = await fs.readFile(path.join(dir, EMBEDDINGS_FILE), 'utf-8');
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as StoredEmbedding;
          if (parsed.key && parsed.hash && Array.isArray(parsed.vector)) {
            this.entries.set(parsed.key, parsed);
          }
        } catch {
          // Bozuk satırı atla; kayıt yeniden gömülecek.
        }
      }
    } catch {
      // Henüz embedding yok.
    }
  }

  private async save(dir: string): Promise<void> {
    try {
      await fs.mkdir(dir, { recursive: true });
      const lines = [...this.entries.values()].map((entry) => JSON.stringify(entry));
      await fs.writeFile(path.join(dir, EMBEDDINGS_FILE), `${lines.join('\n')}\n`, {
        encoding: 'utf-8',
        mode: 0o600
      });
    } catch {
      // Kalıcılık en iyi çabadır; sıralama bellekte yine çalışır.
    }
  }

  /**
   * Derlem kayıtlarını sorguya göre sıralar. Önce eksik/bayat kayıtları
   * (sınırlı sayıda), sonra sorguyu gömer ve kosinüs benzerliğine göre
   * sıralanmış anahtarları döndürür. Embedding yoksa undefined döner;
   * çağıran alt dize aramasına dönmelidir.
   */
  public async rank(
    query: string,
    corpus: EmbeddingCorpusEntry[],
    context: { dir?: string; signal?: AbortSignal } = {}
  ): Promise<EmbeddingMatch[] | undefined> {
    const needle = query.trim();
    if (!needle || corpus.length === 0) return undefined;
    if (context.dir) await this.load(context.dir);

    // Eksik/bayat kayıtları sınırlı kümeler hâlinde göm.
    const missing = corpus
      .filter((entry) => {
        const existing = this.entries.get(entry.key);
        return !existing || existing.hash !== entry.hash;
      })
      .slice(0, MAX_NEW_EMBEDDINGS_PER_SEARCH);

    for (let start = 0; start < missing.length; start += EMBED_BATCH_SIZE) {
      const batch = missing.slice(start, start + EMBED_BATCH_SIZE);
      const vectors = await this.embed(
        batch.map((entry) => entry.text.slice(0, 2_000)),
        context.signal
      );
      if (!vectors) break;
      batch.forEach((entry, index) => {
        const vector = vectors[index];
        if (vector) this.entries.set(entry.key, { key: entry.key, hash: entry.hash, vector });
      });
    }

    if (this.entries.size === 0) return undefined;

    const queryVectors = await this.embed([needle], context.signal);
    const queryVector = queryVectors?.[0];
    if (!queryVector) return undefined;

    if (missing.length > 0 && context.dir) {
      await this.save(context.dir);
    }

    return corpus
      .map((entry) => {
        const vector = this.entries.get(entry.key)?.vector;
        return { key: entry.key, score: vector ? cosineSimilarity(queryVector, vector) : 0 };
      })
      .filter((match) => match.score > 0.2)
      .sort((a, b) => b.score - a.score);
  }
}
