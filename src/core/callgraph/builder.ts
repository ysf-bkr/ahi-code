/**
 * Çağrı haritasını üreten ve güncel tutan inşa edici.
 *
 * İki geçiş:
 * 1. Her dosyanın sembolleri toplanır → düğümler.
 * 2. Her düğümün referansları istenir; referansın düştüğü sembol çağıran olur
 *    → ilişkiler. Yalnızca giden çağrılar sorulur; ters yön aynı veriden
 *    çevrilir.
 *
 * Dosya başına parmak izi (SHA-256) tutulur; değişmeyen dosya yeniden
 * taranmaz.
 */
import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import {
  CallGraphDocument,
  CallGraphEdge,
  CallGraphFileMeta,
  CallGraphNode,
  CallGraphFileStatus
} from './types';
import { buildFileNodes, enclosingNode, RawSymbol } from './extractor';
import { CALLGRAPH_VERSION } from './store';
import { CallGraphLanguageService } from './languageService';
import { IGNORED_DIRECTORIES, isSensitivePath, isSupportedSource } from './identity';

/** Tek dosya için tarama zaman aşımı. */
const FILE_TIMEOUT_MS = 20_000;
/** Aynı anda işlenen dosya sayısı (editör donmasın diye küçük tutulur). */
const CONCURRENCY = 4;
/** Büyük projelerde üst sınır. */
const MAX_FILES = 5_000;
/** Hata mesajında gösterilecek en fazla dosya sayısı. */
const MAX_REPORTED_FILES = 10;

export interface BuildOptions {
  signal?: AbortSignal;
  /** İlerleme bildirimi: işlenen/toplam dosya. */
  onProgress?: (done: number, total: number) => void;
  /** Yalnızca bu dosyaları tara (artımlı güncelleme). */
  onlyFiles?: string[];
  /** Testler için üst sınırı değiştir. */
  maxFiles?: number;
}

export interface BuildResult {
  document: CallGraphDocument;
  /** Dil sunucusu olmadığı için taranamayan dosya sayısı. */
  unsupportedFiles: number;
}

/** Dosya içeriğinin SHA-256 parmak izi. */
export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Çalışma alanındaki tarancak dosyaları toplar.
 *
 * `node_modules`, `dist`, `.git`, `.ahi` gibi klasörler ve hassas dosyalar
 * dışarıda bırakılır.
 */
export async function collectSourceFiles(workspaceRoot: string, maxFiles = MAX_FILES): Promise<string[]> {
  const found: string[] = [];

  const walk = async (directory: string): Promise<void> => {
    if (found.length >= maxFiles) return;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return; // Okunamayan klasör: atla.
    }

    for (const entry of entries) {
      if (found.length >= maxFiles) return;
      const full = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;

      const relative = path.relative(workspaceRoot, full).replace(/\\/g, '/');
      if (!isSupportedSource(relative)) continue;
      if (isSensitivePath(relative)) continue;
      found.push(relative);
    }
  };

  await walk(workspaceRoot);
  return found.sort();
}

/** Zaman aşımı yarışı; dil sunucusu takılırsa tarama durmasın. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(undefined);
      });
  });
}

/** Basit eşzamanlılık havuzu. */
async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
  shouldStop: () => boolean
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      if (shouldStop()) return;
      const index = cursor++;
      const item = items[index];
      if (item === undefined) continue;
      await worker(item, index);
    }
  });
  await Promise.all(runners);
}

/**
 * Tam tarama yapar ve yeni bir harita döndürür.
 *
 * Dil sunucusu hiç cevap vermezse dosyalar `failed` işaretlenir; tarama
 * durmaz ve sonuç yine döner.
 */
export async function buildCallGraph(
  workspaceRoot: string,
  language: CallGraphLanguageService,
  options: BuildOptions = {}
): Promise<BuildResult> {
  const files = options.onlyFiles
    ? options.onlyFiles
    : await collectSourceFiles(workspaceRoot, options.maxFiles ?? MAX_FILES);

  const document: CallGraphDocument = {
    meta: {
      version: CALLGRAPH_VERSION,
      root: workspaceRoot,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      languageServers: [],
      nodeCount: 0,
      edgeCount: 0,
      fileCount: 0,
      incompleteFiles: 0
    },
    nodes: [],
    edges: [],
    files: {}
  };

  const nodesByFile = new Map<string, CallGraphNode[]>();
  const contents = new Map<string, string>();
  let done = 0;
  let unsupportedFiles = 0;

  // 1. geçiş: semboller
  await runPool(
    files,
    CONCURRENCY,
    async (relative) => {
      const started = Date.now();
      const fullPath = path.join(workspaceRoot, relative);

      let content: string;
      try {
        content = await fs.readFile(fullPath, 'utf-8');
      } catch {
        document.files[relative] = failedMeta('', 'read-error', started);
        return;
      }
      contents.set(relative, content);

      const symbols = await withTimeout(language.documentSymbols(relative), FILE_TIMEOUT_MS);
      if (symbols === undefined) {
        // Dil sunucusu yok: dosya haritaya giremez ama tarama sürer.
        unsupportedFiles++;
        document.files[relative] = {
          hash: hashContent(content),
          status: 'skipped',
          nodeCount: 0,
          edgeCount: 0,
          externalCalls: 0,
          scannedAt: Date.now(),
          reason: 'language-server-unavailable'
        };
        done++;
        options.onProgress?.(done, files.length);
        return;
      }

      const nodes = buildFileNodes(relative, content, symbols as RawSymbol[]);
      nodesByFile.set(relative, nodes);
      document.nodes.push(...nodes);
      document.files[relative] = {
        hash: hashContent(content),
        status: 'complete',
        nodeCount: nodes.length,
        edgeCount: 0,
        externalCalls: 0,
        scannedAt: Date.now()
      };

      done++;
      options.onProgress?.(done, files.length);
    },
    () => options.signal?.aborted === true
  );

  if (options.signal?.aborted) {
    return { document, unsupportedFiles };
  }

  // 2. geçiş: referanslar → ilişkiler
  const edgeMap = new Map<string, CallGraphEdge>();
  const externalCounts = new Map<string, number>();

  await runPool(
    [...nodesByFile.keys()],
    CONCURRENCY,
    async (relative) => {
      const fileNodes = nodesByFile.get(relative) ?? [];
      for (const node of fileNodes) {
        if (options.signal?.aborted) return;

        const references = await withTimeout(language.references(relative, node.startLine), FILE_TIMEOUT_MS);
        if (references === undefined) {
          document.files[relative] = {
            ...(document.files[relative] as CallGraphFileMeta),
            status: 'partial',
            reason: 'references-unavailable'
          };
          continue;
        }

        for (const reference of references) {
          // Tanımın kendisi referans listesinde gelir; kenar üretmez.
          if (reference.file === relative && reference.line === node.startLine) continue;

          const targetNodes = nodesByFile.get(reference.file);
          if (!targetNodes) {
            // Proje dışı ya da taranmamış dosya: dış çağrı olarak sayılır.
            externalCounts.set(relative, (externalCounts.get(relative) ?? 0) + 1);
            continue;
          }

          const caller = enclosingNode(targetNodes, reference.line);
          if (!caller || caller.id === node.id) {
            externalCounts.set(relative, (externalCounts.get(relative) ?? 0) + 1);
            continue;
          }

          addEdge(edgeMap, caller.id, node.id, reference.line);
        }
      }
    },
    () => options.signal?.aborted === true
  );

  document.edges = [...edgeMap.values()];
  for (const [file, count] of externalCounts) {
    const meta = document.files[file];
    if (meta) document.files[file] = { ...meta, externalCalls: count };
  }
  for (const [file, nodes] of nodesByFile) {
    const meta = document.files[file];
    if (!meta) continue;
    const edgeCount = document.edges.filter((edge) => nodes.some((node) => node.id === edge.from)).length;
    document.files[file] = { ...meta, edgeCount };
  }

  return { document, unsupportedFiles };
}

/** İki ucu da verilen düğüm kümesinde bulunan kenarları döndürür. */
function edgesAmong(edges: CallGraphEdge[], nodes: CallGraphNode[]): CallGraphEdge[] {
  const valid = new Set(nodes.map((node) => node.id));
  return edges.filter((edge) => valid.has(edge.from) && valid.has(edge.to));
}

/** Aynı çift için tek kenar tutar, satırları biriktirir. */
function addEdge(map: Map<string, CallGraphEdge>, from: string, to: string, line: number): void {
  const key = `${from}->${to}`;
  const existing = map.get(key);
  if (existing) {
    if (!existing.lines.includes(line)) existing.lines.push(line);
    existing.lines.sort((a, b) => a - b);
    return;
  }
  map.set(key, { from, to, lines: [line], confidence: 'exact' });
}

function failedMeta(hash: string, reason: string, startedAt: number): CallGraphFileMeta {
  return {
    hash,
    status: 'failed' as CallGraphFileStatus,
    nodeCount: 0,
    edgeCount: 0,
    externalCalls: 0,
    scannedAt: startedAt,
    reason
  };
}

/**
 * Değişen dosyaları bulur ve haritayı yalnızca onlar için günceller.
 *
 * Dönen harita, `previous` üzerine yeni düğüm/ilişkiler yazılarak oluşur.
 * Silinen dosyaların düğümleri ve ilişkileri temizlenir.
 */
export async function updateCallGraph(
  workspaceRoot: string,
  previous: CallGraphDocument,
  language: CallGraphLanguageService,
  options: BuildOptions = {}
): Promise<BuildResult> {
  // Hedefli güncelleme: yalnızca bildirilen dosyalar kontrol edilir. Her
  // kayıtta tüm projeyi okumak büyük depolarda kabul edilemez bir maliyettir.
  const targeted = options.onlyFiles?.length ? options.onlyFiles : undefined;

  const candidates = targeted ?? (await collectSourceFiles(workspaceRoot, options.maxFiles ?? MAX_FILES));

  // Tam taramada listeden düşen dosyalar silinmiş demektir; hedefli modda
  // yalnızca bildirilen dosya diskte yoksa silinmiş sayılır.
  const removed = new Set<string>();
  if (targeted) {
    for (const relative of targeted) {
      const full = path.join(workspaceRoot, relative);
      const exists = await fs.access(full).then(
        () => true,
        () => false
      );
      if (!exists) removed.add(relative);
    }
  } else {
    const current = new Set(candidates);
    for (const file of Object.keys(previous.files)) {
      if (!current.has(file)) removed.add(file);
    }
  }

  const nodesAfterRemoval = previous.nodes.filter((node) => !removed.has(node.file));
  let document: CallGraphDocument = {
    ...previous,
    nodes: nodesAfterRemoval,
    // Kenarlar düğüm kimliği taşır (`dosya#ad`), dosya yolu değil; bu yüzden
    // iki ucu da yaşayan kenarlar bırakılır.
    edges: edgesAmong(previous.edges, nodesAfterRemoval),
    files: Object.fromEntries(Object.entries(previous.files).filter(([file]) => !removed.has(file)))
  };

  // Parmak izi değişen dosyaları belirle.
  const changed: string[] = [];
  for (const relative of candidates) {
    if (removed.has(relative)) continue;
    const known = previous.files[relative];
    if (!known) {
      changed.push(relative);
      continue;
    }
    let content: string;
    try {
      content = await fs.readFile(path.join(workspaceRoot, relative), 'utf-8');
    } catch {
      continue; // Okunamayan dosya: mevcut kayıt korunur.
    }
    if (hashContent(content) !== known.hash) changed.push(relative);
  }

  if (changed.length === 0) {
    return { document, unsupportedFiles: 0 };
  }

  const changedSet = new Set(changed);
  // Değişen dosyanın düğümleri silinir; ona giden kenarlar da geçersizdir.
  const nodesAfterChange = document.nodes.filter((node) => !changedSet.has(node.file));
  const base: CallGraphDocument = {
    ...document,
    nodes: nodesAfterChange,
    edges: edgesAmong(document.edges, nodesAfterChange),
    files: Object.fromEntries(Object.entries(document.files).filter(([file]) => !changedSet.has(file)))
  };

  const incremental = await buildCallGraph(workspaceRoot, language, {
    ...options,
    onlyFiles: changed
  });

  document = {
    meta: { ...base.meta, createdAt: previous.meta.createdAt },
    nodes: [...base.nodes, ...incremental.document.nodes],
    edges: [...base.edges, ...incremental.document.edges],
    files: { ...base.files, ...incremental.document.files }
  };

  return { document, unsupportedFiles: incremental.unsupportedFiles };
}

/** Hata raporunda gösterilecek dosya listesini kısaltır. */
export function summarizeIncompleteFiles(document: CallGraphDocument): string[] {
  return Object.entries(document.files)
    .filter(([, meta]) => meta.status === 'partial' || meta.status === 'failed')
    .map(([file]) => file)
    .slice(0, MAX_REPORTED_FILES);
}
