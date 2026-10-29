/**
 * Çağrı haritası sorguları.
 *
 * Tüm sorgular salt-okunur ve saf: yalnızca bellekteki haritayı gezer.
 * Sonuçlar her zaman güven etiketi (exact/estimated) taşır ve hiçbir zaman
 * "kesinlikle etkilenmez" demez; en fazla "haritaya göre etkilenmiyor" der.
 */
import { CallGraphDocument, CallGraphImpactResult, CallGraphNeighbor, CallGraphNode } from './types';

/** Derinlik varsayılanı. Üst sınır yoktur; gezinme iterative olduğu için derinlik yığın taşması yapmaz. */
export const DEFAULT_DEPTH = 1;

/** Etki alanı bu sayıdan büyükse sonuç özetlenir. */
const WIDE_IMPACT_THRESHOLD = 50;

/** Sorgu için düğüm çözümleme: kimlik, ad ya da `dosya#ad`. */
export function resolveNodes(document: CallGraphDocument, query: string): CallGraphNode[] {
  const value = query.trim();
  if (!value) return [];

  const normalize = (text: string) => text.replace(/\\/g, '/').toLowerCase();
  const needle = normalize(value);

  // 1. Tam kimlik eşleşmesi.
  const exact = document.nodes.filter((node) => normalize(node.id) === needle);
  if (exact.length > 0) return exact;

  // 2. `dosya#ad` biçimi.
  if (needle.includes('#')) {
    const byId = document.nodes.filter((node) => normalize(node.id).endsWith(needle));
    if (byId.length > 0) return byId;
  }

  // 3. Sadece ad.
  return document.nodes.filter((node) => normalize(node.name) === needle);
}

/** Adı sorguyla eşleşen düğümler (kısmi eşleşme; öneri için). */
export function suggestNodes(document: CallGraphDocument, query: string, limit = 10): CallGraphNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return document.nodes.filter((node) => node.name.toLowerCase().includes(needle)).slice(0, limit);
}

/** Haritada dışa aktarılan ve hiç çağıranı olmayan düğümler dış kullanım olabilir. */
function hasCallers(document: CallGraphDocument, nodeId: string): boolean {
  return document.edges.some((edge) => edge.to === nodeId);
}

/**
 * Derinliği normalize eder.
 *
 * `0` ya da negatif değer "sınırsız" demektir: tüm ulaşılabilir düğümler
 * gezilir. Yapay bir üst sınır yoktur; `traverse` iterative ve ziyaret edilen
 * düğümleri işaretlediği için derinlik yığın taşması üretmez.
 */
export function clampDepth(depth: number | undefined): number {
  if (depth === undefined || !Number.isFinite(depth)) return DEFAULT_DEPTH;
  if (depth <= 0) return Number.MAX_SAFE_INTEGER;
  return Math.floor(depth);
}

/**
 * Bir düğümün çağıranlarını genişlik-öncelikli gezer.
 *
 * Döngüler (A→B→A) bir kez gezilir; sonsuz döngü oluşmaz.
 */
export function findCallers(
  document: CallGraphDocument,
  nodeIds: string[],
  depth: number
): CallGraphNeighbor[] {
  return traverse(document, nodeIds, depth, 'callers');
}

/** Bir düğümün çağırdıklarını gezer. */
export function findCallees(
  document: CallGraphDocument,
  nodeIds: string[],
  depth: number
): CallGraphNeighbor[] {
  return traverse(document, nodeIds, depth, 'callees');
}

/** Ortak gezinme: yön 'callers' ise gelen kenarlar, 'callees' ise giden kenarlar. */
function traverse(
  document: CallGraphDocument,
  startIds: string[],
  depth: number,
  direction: 'callers' | 'callees'
): CallGraphNeighbor[] {
  const byId = new Map(document.nodes.map((node) => [node.id, node]));
  const visited = new Set(startIds);
  const results: CallGraphNeighbor[] = [];
  let frontier = [...startIds];

  for (let level = 1; level <= depth; level++) {
    const next: string[] = [];
    for (const current of frontier) {
      const edges =
        direction === 'callers'
          ? document.edges.filter((edge) => edge.to === current)
          : document.edges.filter((edge) => edge.from === current);

      for (const edge of edges) {
        const neighborId = direction === 'callers' ? edge.from : edge.to;
        if (visited.has(neighborId)) continue;
        const node = byId.get(neighborId);
        if (!node) continue;

        visited.add(neighborId);
        results.push({
          node,
          depth: level,
          lines: edge.lines,
          confidence: edge.confidence
        });
        next.push(neighborId);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  return results;
}

/**
 * Etki analizi: verilen sembollerin değişmesi hâlinde nelerin etkilendiğini
 * hesaplar.
 *
 * Sonuç üç gruba ayrılır: doğrudan çağıranlar (derinlik 1), dolaylı çağıranlar
 * (derinlik > 1) ve etkilenen testler.
 */
export function analyzeCallGraphImpact(
  document: CallGraphDocument,
  nodeIds: string[],
  depth: number
): CallGraphImpactResult {
  const callers = findCallers(document, nodeIds, depth);
  const startNodes = nodeIds
    .map((id) => document.nodes.find((node) => node.id === id))
    .filter((node): node is CallGraphNode => node !== undefined);

  const directCallers = callers.filter((neighbor) => neighbor.depth === 1);
  const indirectCallers = callers.filter((neighbor) => neighbor.depth > 1);
  const affectedTests = callers.filter((neighbor) => neighbor.node.isTest);

  const affectedFiles = [
    ...new Set([...callers.map((neighbor) => neighbor.node.file), ...startNodes.map((node) => node.file)])
  ].sort();

  // Dışa aktarılan ve haritada çağıranı olmayan bir sembol başka paketlerden
  // kullanılıyor olabilir; harita bunu göremez.
  const exportedChange = startNodes.some((node) => node.exported && !hasCallers(document, node.id));

  const warnings: string[] = [];
  if (document.meta.incompleteFiles > 0) {
    warnings.push(
      `${document.meta.incompleteFiles} dosya eksik tarandı; etki alanı olduğundan dar görünebilir.`
    );
  }
  if (exportedChange) {
    warnings.push('Dışa aktarılan sembol değişiyor; başka paketlerden kullanım haritada görünmez.');
  }
  if (callers.length > WIDE_IMPACT_THRESHOLD) {
    warnings.push(
      `Etki alanı geniş (${callers.length} düğüm); sonuç özetlendi. Daha dar bir sembolle deneyin.`
    );
  }

  return {
    directCallers,
    indirectCallers: indirectCallers.slice(0, WIDE_IMPACT_THRESHOLD),
    affectedTests,
    affectedFiles,
    exportedChange,
    warnings
  };
}

/** Geniş sonuçları kırpmak için komşu listesini sınırlar. */
export function limitNeighbors(
  neighbors: CallGraphNeighbor[],
  limit: number
): { items: CallGraphNeighbor[]; omitted: number } {
  if (neighbors.length <= limit) return { items: neighbors, omitted: 0 };
  return { items: neighbors.slice(0, limit), omitted: neighbors.length - limit };
}

/** Haritada test olarak işaretli düğümler. */
export function testNodes(document: CallGraphDocument): CallGraphNode[] {
  return document.nodes.filter((node) => node.isTest);
}

/** Düğümü `dosya:satır` biçiminde kısa etiketler. */
export function nodeLabel(node: CallGraphNode): string {
  return `${node.file}:${node.startLine} ${node.name}`;
}
