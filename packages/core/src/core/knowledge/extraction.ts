/**
 * Bilgi tabanının saf çıkarım fonksiyonları.
 *
 * Dosya sistemi ve `vscode` bağımlılığı yoktur; doğrudan test edilebilir.
 * `KnowledgeStore` bu fonksiyonları kullanır ve geriye dönük uyumluluk için
 * yeniden dışa aktarır.
 */
import * as path from 'path';
import { createHash } from 'crypto';
import { KnowledgeSymbolRecord } from './types';
import { SENSITIVE_PATTERNS, SOURCE_EXTENSIONS } from './paths';

export function isSensitivePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function sha256Content(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

export function toRelativePath(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).replace(/\\/g, '/');
}

function symbolKindFor(line: string): string {
  if (/\bclass\b/.test(line)) return 'class';
  if (/\binterface\b/.test(line)) return 'interface';
  if (/\benum\b/.test(line)) return 'enum';
  if (/\b(type|struct|trait|record)\b/.test(line)) return 'type';
  if (/\b(function|def|fn|func)\b/.test(line)) return 'function';
  if (/\b(const|let|var|val)\b/.test(line)) return 'variable';
  return 'symbol';
}

const SYMBOL_PATTERNS: RegExp[] = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|enum|type|struct|trait|record)\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:const|let|var|val)\s+([A-Za-z_$][\w$]*)\s*(?::|=)/,
  /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/,
  /^\s*def\s+([A-Za-z_]\w*)/,
  /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/,
  /^\s*(?:public|private|protected|static|final|abstract|override|suspend|open|internal)\s+(?:class|interface|enum|record|fun|void|int|long|double|float|boolean|string)\s+([A-Za-z_]\w*)/
];

const IMPORT_PATTERNS: RegExp[] = [
  /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  /require\(\s*['"]([^'"]+)['"]\s*\)/g,
  /from\s+([A-Za-z0-9_.]+)\s+import/g,
  /^\s*import\s+([A-Za-z0-9_.]+)/gm,
  /^\s*use\s+([A-Za-z0-9_:]+)/gm,
  /^\s*#include\s+[<"]([^>"]+)[>"]/gm
];

export function extractSymbols(relativePath: string, content: string): KnowledgeSymbolRecord[] {
  const symbols: KnowledgeSymbolRecord[] = [];
  const lines = content.split('\n');
  lines.forEach((line, index) => {
    for (const pattern of SYMBOL_PATTERNS) {
      const match = line.match(pattern);
      if (match?.[1]) {
        symbols.push({
          name: match[1],
          kind: symbolKindFor(line),
          file: relativePath,
          line: index + 1
        });
        break;
      }
    }
  });
  // Bitiş satırları, modelin dosyanın tamamı yerine read_file offset/limit
  // ile tek bir sembolü okumasını sağlar. Bir sembol sonraki sembolün
  // başladığı satıra (veya EOF) kadar uzanır; bu bir yaklaşımdır, LSP
  // zenginleştirmesi daha sonra kesin aralıklarla değiştirir.
  symbols.forEach((symbol, index) => {
    const next = symbols[index + 1];
    symbol.endLine = next ? Math.max(symbol.line, next.line - 1) : lines.length;
  });
  return symbols;
}

export function extractImports(content: string): string[] {
  const imports = new Set<string>();
  for (const pattern of IMPORT_PATTERNS) {
    // Bazı desenler global olduğu ve yeniden kullanıldığı için lastIndex sıfırlanır.
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      if (match[1]) imports.add(match[1]);
    }
  }
  return [...imports];
}

/**
 * Göreli belirticiyi çalışma alanına göreli yola çözümler; böylece import
 * grafiğinde gezinilebilir. Çıplak paket belirticileri olduğu gibi döner.
 */
export function normalizeImport(fromFile: string, specifier: string): string {
  if (!specifier.startsWith('.')) {
    // Noktalı Python import'ları (örn. app.services.auth) yol benzerine dönüşür.
    if (!specifier.includes('/') && specifier.includes('.')) {
      return specifier.replace(/\./g, '/');
    }
    return specifier;
  }

  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  const extensions = [...SOURCE_EXTENSIONS];
  for (const extension of extensions) {
    if (resolved.endsWith(extension)) return resolved;
  }
  // "src/b", "src/b.ts"yi kastediyor olabilir; çıplak yolu koru, sonekle eşleştir.
  return resolved;
}

/** Yalnızca adlandırılmış export'lar; modülü gövdesini göndermeden tanımlamak için. */
export function extractExports(content: string): string[] {
  const exports = new Set<string>();
  const declarationPattern =
    /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|enum|type|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  const listPattern = /export\s*\{([^}]+)\}/g;

  let match: RegExpExecArray | null;
  while ((match = declarationPattern.exec(content)) !== null) {
    if (match[1]) exports.add(match[1]);
  }
  while ((match = listPattern.exec(content)) !== null) {
    const group = match[1];
    if (!group) continue;
    for (const part of group.split(',')) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name) exports.add(name);
    }
  }
  return [...exports].slice(0, 200);
}

export function parseJsonl<T>(raw: string): T[] {
  const items: T[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      items.push(JSON.parse(trimmed) as T);
    } catch {
      // Bozuk tek bir satır indeksin geri kalanını çöpe atmamalı.
    }
  }
  return items;
}

export function toJsonl(items: unknown[]): string {
  return items.map((item) => JSON.stringify(item)).join('\n') + (items.length > 0 ? '\n' : '');
}

/**
 * Dosya tabanlı proje bilgi tabanı.
 *
 * İki katman:
 * - statik: semboller, import'lar, export'lar ve içerik hash'leri (model maliyeti yok)
 * - model: bir dosya ilk kez derinlemesine kullanıldığında tembel üretilen özetler
 *
 * Güncellik içerik hash'leri ve `git diff` üzerinden belirlenir; böylece oturum
 * tüm projeyi yeniden taramak yerine yalnızca değişenleri tazeler.
 */
