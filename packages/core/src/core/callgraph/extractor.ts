/**
 * Dil sunucusundan düğüm çıkarma.
 *
 * VS Code API'si çağrı hiyerarşisini (call hierarchy) doğrudan açmaz. Bu yüzden
 * çağrılar **referans tabanlı** çıkarılır: bir sembolün referansları istenir,
 * her referans konumunun hangi sembolün gövdesine düştüğü bulunur; o sembol
 * çağırandır.
 *
 * Bu yaklaşım LSP cevabına dayandığı için `exact` sayılır. Ancak dinamik
 * çağrıları, geri çağrıları ve yansımayı göremez; bu sınırlar belgelenmiştir.
 */
import { CallGraphNode, CallGraphNodeKind } from './types';
import { isTestFile, nodeId } from './identity';

/** LSP'den gelen ham sembol; `LspClient.getDocumentSymbols` çıktısıyla uyumlu. */
export interface RawSymbol {
  name: string;
  kind: string;
  line: number;
  endLine?: number;
}

/** LSP sembol türü etiketini harita türüne çevirir. */
export function toNodeKind(kind: string): CallGraphNodeKind | undefined {
  const normalized = kind.toLowerCase();
  if (normalized === 'class') return 'class';
  if (normalized === 'method' || normalized === 'constructor') return 'method';
  if (
    normalized === 'function' ||
    normalized === 'arrow function' ||
    normalized === 'const' ||
    normalized === 'variable' ||
    normalized === 'let'
  ) {
    return 'function';
  }
  return undefined;
}

/**
 * Sembolün dışa aktarılıp aktarılmadığını tahmin eder.
 *
 * LSP bunu doğrudan söylemez; tanım satırının `export` ile başlayıp
 * başlamadığına bakılır. Bu bir sezgiseldir, kesin değildir.
 */
export function looksExported(contentLines: string[], startLine: number): boolean {
  // Tanım satırı ve bir önceki satır kontrol edilir: dekoratörler ve çok
  // satırlı `export` bildirimleri için pay bırakılır.
  for (let offset = 0; offset <= 2; offset++) {
    const line = contentLines[startLine - 1 + offset];
    if (!line) continue;
    if (/^\s*export\b/.test(line)) return true;
    // `export const x = () =>` gibi satır içi tanımlar.
    if (/\bexport\s+(default\s+)?(async\s+)?(function|class|const|let|var)\b/.test(line)) return true;
  }
  return false;
}

/**
 * Bir dosyanın sembollerinden düğümler üretir.
 *
 * Aynı ada sahip semboller sıra numarasıyla ayrılır: `#ad`, `#ad:2`.
 */
export function buildFileNodes(relativePath: string, content: string, symbols: RawSymbol[]): CallGraphNode[] {
  const lines = content.split('\n');
  const seen = new Map<string, number>();
  const nodes: CallGraphNode[] = [];

  for (const symbol of symbols) {
    const kind = toNodeKind(symbol.kind);
    if (!kind) continue;
    if (!symbol.name.trim()) continue;

    // `Sınıf.metot` biçimindeki adları ayır (bazı dil sunucuları böyle verir).
    const dotIndex = symbol.name.lastIndexOf('.');
    const className = dotIndex > 0 ? symbol.name.slice(0, dotIndex) : undefined;
    const simpleName = dotIndex > 0 ? symbol.name.slice(dotIndex + 1) : symbol.name;

    const base = `${className ?? ''}#${simpleName}`;
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);

    nodes.push({
      id: nodeId(relativePath, simpleName, { className, occurrence }),
      name: simpleName,
      kind,
      file: relativePath,
      startLine: symbol.line,
      endLine: symbol.endLine ?? symbol.line,
      exported: looksExported(lines, symbol.line),
      isTest: isTestFile(relativePath),
      ...(className === undefined ? {} : { className })
    });
  }

  return nodes;
}

/** Konum verilen düğümün gövdesi içinde mi? */
function containsLine(node: CallGraphNode, line: number): boolean {
  return line >= node.startLine && line <= node.endLine;
}

/**
 * Bir satırı kapsayan en dar düğümü bulur.
 *
 * İç içe fonksiyonlarda en dar kapsam doğru çağırandır; bu yüzden aralığı en
 * küçük olan düğüm seçilir.
 */
export function enclosingNode(nodes: CallGraphNode[], line: number): CallGraphNode | undefined {
  let best: CallGraphNode | undefined;
  for (const node of nodes) {
    if (!containsLine(node, line)) continue;
    if (!best) {
      best = node;
      continue;
    }
    const currentSpan = node.endLine - node.startLine;
    const bestSpan = best.endLine - best.startLine;
    if (currentSpan < bestSpan) best = node;
  }
  return best;
}
