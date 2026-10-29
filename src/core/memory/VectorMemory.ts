/**
 * AhiCode — Vektör Bellek (Vector Memory)
 *
 * Projede yapılan geçmiş görevleri, çözülen hataları, mimari kararları,
 * kod kurallarını ve modül özetlerini vektörel uzayda indeksler.
 *
 * İki katmanlı çalışır:
 * 1. Yerleşik Vektör Uzay Modeli (TF-IDF + Karakter N-Gram + Kosinüs Benzerliği):
 *    Harici sunucu/ağ gerektirmez; %100 yerel, anlık ve sandbox uyumlu çalışır.
 * 2. Yoğun Nöral Gömme (EmbeddingIndex):
 *    Ollama veya gömme sağlayıcısı yapılandırılmışsa nöral vektörlerle eşleşmeyi derinleştirir.
 *
 * Model her yeni görev aldığında kullanıcının istemiyle ilişkili geçmiş görevler
 * ve proje kararları otomatik olarak taranır ve isteme enjekte edilir.
 * Böylece ajan geçmişte yaptıklarını ve projedeki kuralları asla unutmaz.
 */
import * as path from 'path';
import * as crypto from 'crypto';
import { AHI_DIR } from '../../shared/constants';
import { ProjectMemoryManager, ProjectMemoryEntry } from './ProjectMemoryManager';
import { KnowledgeStore } from '../knowledge/KnowledgeStore';
import { EmbeddingIndex } from '../knowledge/EmbeddingIndex';
import { logWarning } from '../../shared/logging';

export type VectorMemoryCategory = 'task' | 'decision' | 'convention' | 'note' | 'code';

export interface VectorMemoryItem {
  id: string;
  category: VectorMemoryCategory;
  title: string;
  content: string;
  hash: string;
  timestamp?: number;
  metadata?: {
    files?: string[];
    commit?: string;
    status?: string;
    path?: string;
  };
}

export interface VectorMemoryMatch {
  item: VectorMemoryItem;
  score: number;
  method: 'neural' | 'vsm' | 'hybrid';
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf-8').digest('hex').slice(0, 16);
}

/**
 * Metni küçük harfli sözcük token'larına ve 3-gram alt sözcüklerine ayırır.
 * Türkçe ek yapısını ve morfolojik varyasyonları eşleştirmek için etkilidir.
 */
function extractTokens(text: string): { words: string[]; grams: string[] } {
  const normalized = text.toLowerCase();
  const words = normalized
    .replace(/[^\p{L}\p{N}_]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 2);

  const grams = new Set<string>();
  for (const word of words) {
    if (word.length >= 4 && word.length <= 15) {
      for (let i = 0; i <= word.length - 3; i++) {
        grams.add(`_${word.slice(i, i + 3)}`);
      }
    }
  }

  return { words: Array.from(new Set(words)), grams: Array.from(grams) };
}

/**
 * Seyrek vektör temsili: token -> ağırlık
 */
type SparseVector = Map<string, number>;

export class VectorMemory {
  private items = new Map<string, VectorMemoryItem>();
  private sparseVectors = new Map<string, SparseVector>();
  private idfMap = new Map<string, number>();
  private lastIndexedWorkspace?: string;
  private lastIndexedTime = 0;

  constructor(
    private readonly projectMemory: ProjectMemoryManager,
    private readonly knowledgeStore: KnowledgeStore,
    private readonly getEmbeddingIndex?: () => EmbeddingIndex | undefined
  ) {}

  /**
   * Projedeki geçmiş görevleri ve bilgi tabanını derleyip vektör indeksini günceller.
   */
  public async sync(workspaceRoot: string, force = false): Promise<void> {
    const now = Date.now();
    // 5 saniyeden önce indekslendiyse ve zorlanmadıysa tekrar tarama
    if (!force && this.lastIndexedWorkspace === workspaceRoot && now - this.lastIndexedTime < 5000) {
      return;
    }

    const items: VectorMemoryItem[] = [];

    // 1. Geçmiş Görevler (Yaptıklarımız)
    try {
      const taskEntries: ProjectMemoryEntry[] = await this.projectMemory.loadEntries(workspaceRoot);
      for (const entry of taskEntries) {
        const parts = [
          `Görev: ${entry.prompt}`,
          entry.summary ? `Sonuç: ${entry.summary}` : '',
          entry.files.length > 0 ? `Değişen Dosyalar: ${entry.files.join(', ')}` : '',
          entry.commit ? `Commit: ${entry.commit}` : '',
          `Durum: ${entry.status}`
        ].filter(Boolean);

        const content = parts.join('\n');
        items.push({
          id: `task:${entry.taskId}`,
          category: 'task',
          title: `Görev #${entry.taskId.split(':').pop() || ''}: ${entry.prompt.slice(0, 60)}`,
          content,
          hash: sha256(content),
          timestamp: entry.timestamp,
          metadata: {
            files: entry.files,
            commit: entry.commit,
            status: entry.status
          }
        });
      }
    } catch (err) {
      logWarning('VectorMemory: Geçmiş görevler yüklenemedi', err);
    }

    // 2. Bilgi Tabanı — İnsan Notları ve Kararlar (Projemizdekiler)
    const humanFiles: Array<{
      name: 'project' | 'conventions' | 'decisions' | 'notes';
      category: VectorMemoryCategory;
      title: string;
    }> = [
      { name: 'decisions', category: 'decision', title: 'Mimari Karar (decisions.md)' },
      { name: 'conventions', category: 'convention', title: 'Kodlama Standardı (conventions.md)' },
      { name: 'project', category: 'note', title: 'Proje Tanımı (project.md)' },
      { name: 'notes', category: 'note', title: 'Proje Notu (notes.md)' }
    ];

    for (const { name, category, title } of humanFiles) {
      const text = await this.knowledgeStore.getHumanFile(name);
      if (text && typeof text === 'string' && text.trim()) {
        // Bloklara böl (başlıklara göre parçala ki granüler vektörleşsin)
        const sections = text.split(/\n(?=##?\s)/);
        sections.forEach((sec, idx) => {
          const trimmed = sec.trim();
          if (!trimmed) return;
          const firstLine = trimmed.split('\n')[0] || title;
          items.push({
            id: `human:${name}:${idx}`,
            category,
            title: `${title} — ${firstLine.replace(/^#+\s*/, '').slice(0, 50)}`,
            content: trimmed,
            hash: sha256(trimmed)
          });
        });
      }
    }

    // 3. Bilgi Tabanı — Modül ve Kod Özetleri
    try {
      const summarizedFiles = this.knowledgeStore.getSummarizedFiles();
      for (const file of summarizedFiles) {
        if (!file.summary) continue;
        const content = `Dosya: ${file.path}\nÖzet: ${file.summary}`;
        items.push({
          id: `code:${file.path}`,
          category: 'code',
          title: `Modül: ${file.path}`,
          content,
          hash: sha256(content),
          metadata: { path: file.path }
        });
      }
    } catch {
      // Özet yoksa devam et
    }

    this.items.clear();
    for (const item of items) {
      this.items.set(item.id, item);
    }

    this.computeSparseVectors();
    this.lastIndexedWorkspace = workspaceRoot;
    this.lastIndexedTime = now;
  }

  /**
   * Tüm kayıtlar için IDF ve seyrek TF-IDF vektörlerini hesaplar.
   */
  private computeSparseVectors(): void {
    const docCount = this.items.size;
    if (docCount === 0) return;

    // Belge frekansları
    const docFreq = new Map<string, number>();
    const docTokens = new Map<string, { words: string[]; grams: string[] }>();

    for (const [id, item] of this.items.entries()) {
      const extracted = extractTokens(`${item.title}\n${item.content}`);
      docTokens.set(id, extracted);
      const allTokens = new Set([...extracted.words, ...extracted.grams]);
      for (const t of allTokens) {
        docFreq.set(t, (docFreq.get(t) || 0) + 1);
      }
    }

    // IDF haritası (scikit-learn / Lucene tarzı yumuşatılmış IDF)
    this.idfMap.clear();
    for (const [token, df] of docFreq.entries()) {
      this.idfMap.set(token, Math.log(1 + docCount / (df + 0.5)) + 1.0);
    }

    // TF-IDF vektörleri (L2 normalize)
    this.sparseVectors.clear();
    for (const [id, extracted] of docTokens.entries()) {
      const vec: SparseVector = new Map();
      let sumSq = 0;

      for (const w of extracted.words) {
        const idf = this.idfMap.get(w) || 1.0;
        const weight = idf * 1.0; // Tam kelimeler yüksek ağırlık alır
        vec.set(w, (vec.get(w) || 0) + weight);
        sumSq += weight * weight;
      }

      for (const g of extracted.grams) {
        const idf = this.idfMap.get(g) || 0.5;
        const weight = idf * 0.35; // Alt parçalar yardımcı ağırlık alır
        vec.set(g, (vec.get(g) || 0) + weight);
        sumSq += weight * weight;
      }

      const norm = Math.sqrt(sumSq) || 1;
      for (const [t, w] of vec.entries()) {
        vec.set(t, w / norm);
      }

      this.sparseVectors.set(id, vec);
    }
  }

  /**
   * Sorguyu vektör uzayında arar ve kosinüs benzerliğine göre sıralar.
   */
  public async search(
    workspaceRoot: string,
    query: string,
    limit = 6,
    minScore = 0.1
  ): Promise<VectorMemoryMatch[]> {
    const needle = query.trim();
    if (!needle) return [];

    await this.sync(workspaceRoot);
    if (this.items.size === 0) return [];

    // Sorgu vektörü
    const extracted = extractTokens(needle);
    const qVec: SparseVector = new Map();
    let qSumSq = 0;

    for (const w of extracted.words) {
      const idf = this.idfMap.get(w) || 1.0;
      const weight = idf * 1.0;
      qVec.set(w, (qVec.get(w) || 0) + weight);
      qSumSq += weight * weight;
    }

    for (const g of extracted.grams) {
      const idf = this.idfMap.get(g) || 0.5;
      const weight = idf * 0.35;
      qVec.set(g, (qVec.get(g) || 0) + weight);
      qSumSq += weight * weight;
    }

    const qNorm = Math.sqrt(qSumSq) || 1;
    for (const [t, w] of qVec.entries()) {
      qVec.set(t, w / qNorm);
    }

    // Kosinüs Benzerliği
    const matches: VectorMemoryMatch[] = [];

    for (const [id, docVec] of this.sparseVectors.entries()) {
      let dot = 0;
      for (const [t, qw] of qVec.entries()) {
        const dw = docVec.get(t);
        if (dw !== undefined) {
          dot += qw * dw;
        }
      }

      if (dot >= minScore) {
        const item = this.items.get(id);
        if (item) {
          matches.push({ item, score: dot, method: 'vsm' });
        }
      }
    }

    // Eğer EmbeddingIndex varsa nöral gömmeler ile sonuçları birleştir
    const embedIndex = this.getEmbeddingIndex?.();
    if (embedIndex) {
      try {
        const corpus = Array.from(this.items.values()).map((item) => ({
          key: item.id,
          text: `${item.title}\n${item.content.slice(0, 600)}`,
          hash: item.hash
        }));

        const neuralRankings = await embedIndex.rank(needle, corpus, {
          dir: path.join(workspaceRoot, AHI_DIR, 'knowledge')
        });

        if (neuralRankings && neuralRankings.length > 0) {
          const neuralMap = new Map(neuralRankings.map((r) => [r.key, r.score]));
          for (const m of matches) {
            const nScore = neuralMap.get(m.item.id);
            if (nScore !== undefined) {
              m.score = Math.max(m.score, nScore);
              m.method = 'hybrid';
            }
          }

          // Yalnızca nöral gömmede yakalananları ekle
          for (const nr of neuralRankings) {
            if (nr.score >= minScore && !matches.some((m) => m.item.id === nr.key)) {
              const item = this.items.get(nr.key);
              if (item) {
                matches.push({ item, score: nr.score, method: 'neural' });
              }
            }
          }
        }
      } catch {
        // Nöral gömme başarısız olsa bile VSM sonuçları tam olarak çalışır
      }
    }

    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, limit);
  }

  /**
   * İstem (system prompt) için kullanıcının göreviyle ilişkili hafızayı biçimlendirir.
   */
  public async formatForPrompt(workspaceRoot: string, userPrompt: string, limit = 4): Promise<string> {
    const matches = await this.search(workspaceRoot, userPrompt, limit, 0.2);
    if (matches.length === 0) return '';

    const lines: string[] = [
      '=== VEKTÖR BELLEK (Vector Memory & Proje Hafızası) ===',
      'Aşağıdaki geçmiş görev ve proje kayıtları, mevcut görevinizle anlamsal olarak yüksek oranda eşleşmiştir.',
      'Bu hafızayı dikkate alarak çalışın: önceki kararları çiğnemeyin, çözülmüş hataları tekrarlamayın ve bağlamı koruyun:',
      ''
    ];

    matches.forEach((m, idx) => {
      const typeLabel =
        m.item.category === 'task'
          ? 'Geçmiş Görev'
          : m.item.category === 'decision'
            ? 'Mimari Karar'
            : m.item.category === 'convention'
              ? 'Standart'
              : 'Bilgi';

      const simPct = Math.round(m.score * 100);
      lines.push(`${idx + 1}. [${typeLabel} · %${simPct} alaka] ${m.item.title}`);
      lines.push(`   ${m.item.content.replace(/\r?\n/g, ' ').slice(0, 280)}`);
      if (m.item.metadata?.files && m.item.metadata.files.length > 0) {
        lines.push(`   İlgili dosyalar: ${m.item.metadata.files.slice(0, 6).join(', ')}`);
      }
      lines.push('');
    });

    lines.push('=== VEKTÖR BELLEK SONU ===');
    return lines.join('\n');
  }

  /**
   * İndekslenen hafıza istatistikleri.
   */
  public getStats(): { total: number; tasks: number; decisions: number; modules: number } {
    let tasks = 0;
    let decisions = 0;
    let modules = 0;

    for (const item of this.items.values()) {
      if (item.category === 'task') tasks++;
      else if (item.category === 'decision' || item.category === 'convention') decisions++;
      else if (item.category === 'code') modules++;
    }

    return {
      total: this.items.size,
      tasks,
      decisions,
      modules
    };
  }
}
