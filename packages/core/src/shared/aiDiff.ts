/**
 * AI/LLM modelleri için token tasarruflu, kompakt Git diff biçimlendirici.
 *
 * Standart birleşik farktaki (unified diff) gereksiz üstbilgileri ve aşırı bağlamı
 * temizler; devasa kilit dosyalarını (lockfile) ve ikili varlıkları otomatik katlar.
 */

export interface AiDiffOptions {
  /** Maksimum karakter bütçesi (bağlam penceresi taşmasını önler). */
  maxChars?: number;
  /** Yalnızca bu dosya istendiyse kilit dosyası katlamasını atlar. */
  targetPath?: string;
  /** Kilit dosyalarını katlayıp katlamayacağı (varsayılan: true). */
  collapseLockfiles?: boolean;
  /** Statik varlıkları ve minifiye dosyaları katlayıp katlamayacağı (varsayılan: true). */
  collapseAssets?: boolean;
}

/** Yaygın bağımlılık kilit dosyaları; diff'leri çok büyük token harcar. */
const LOCKFILE_PATTERNS = [
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'Cargo.lock',
  'Gemfile.lock',
  'composer.lock',
  'poetry.lock',
  'flake.lock',
  'go.sum',
  'Podfile.lock'
];

/** Üretilmiş veya metin olarak incelenmesi anlamsız varlık uzantıları. */
const ASSET_EXTENSIONS = ['.min.js', '.min.css', '.map', '.svg', '.bundle.js'];

/** Bir dosya yolunun kilit dosyası olup olmadığını belirler. */
export function isLockfile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const basename = normalized.split('/').pop() || normalized;
  return LOCKFILE_PATTERNS.includes(basename);
}

/** Bir dosyanın üretilmiş varlık olup olmadığını belirler. */
export function isAsset(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return ASSET_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

interface ParsedFileDiff {
  path: string;
  oldPath?: string;
  status: 'M' | 'A' | 'D' | 'R' | 'B';
  additions: number;
  deletions: number;
  isLockfile: boolean;
  isAsset: boolean;
  hunkBodies: string[];
}

/**
 * Ham git diff çıktısını dosyalarına ve hunlarına ayıklar.
 */
function parseRawDiff(rawDiff: string): ParsedFileDiff[] {
  const files: ParsedFileDiff[] = [];
  // Her dosya diff'i "diff --git a/... b/..." ile başlar.
  const rawBlocks = rawDiff.split(/^diff --git /m).filter(Boolean);

  for (const block of rawBlocks) {
    const lines = block.split('\n');
    const headerLine = lines[0] ?? '';

    // "a/path b/path" ayrıştırması
    const pathsMatch = headerLine.match(/^a\/(.+?)\s+b\/(.+)$/);
    let filePath = pathsMatch ? (pathsMatch[2] ?? '') : '';
    let oldPath: string | undefined = pathsMatch ? pathsMatch[1] : undefined;

    let status: 'M' | 'A' | 'D' | 'R' | 'B' = 'M';
    let isBinary = false;

    for (const line of lines) {
      if (line.startsWith('new file mode')) {
        status = 'A';
      } else if (line.startsWith('deleted file mode')) {
        status = 'D';
      } else if (line.startsWith('rename from ')) {
        status = 'R';
        oldPath = line.replace('rename from ', '').trim();
      } else if (line.startsWith('rename to ')) {
        filePath = line.replace('rename to ', '').trim();
      } else if (line.startsWith('Binary files ') && line.includes('differ')) {
        isBinary = true;
        status = 'B';
      }
    }

    if (!filePath && oldPath) {
      filePath = oldPath;
    }
    if (!filePath) continue;

    // Tırnakları temizle (ASCII dışı yollarda git tırnak ekler)
    if (filePath.startsWith('"') && filePath.endsWith('"')) {
      filePath = filePath.slice(1, -1);
    }

    const hunkBodies: string[] = [];
    let currentHunk: string[] | null = null;
    let additions = 0;
    let deletions = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (line.startsWith('@@ ')) {
        if (currentHunk) {
          hunkBodies.push(currentHunk.join('\n'));
        }
        // Hunk başlığını sadeleştir: @@ -10,5 +10,6 @@ functionName -> @@ L10 [functionName]:
        const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
        const lineNo = hunkMatch ? hunkMatch[1] : '';
        const symbolHint = hunkMatch && hunkMatch[2] ? hunkMatch[2].trim() : '';
        const cleanHeader = symbolHint ? `@@ L${lineNo} [${symbolHint}]:` : `@@ L${lineNo}:`;
        currentHunk = [cleanHeader];
      } else if (currentHunk) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          additions++;
          currentHunk.push(line);
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          deletions++;
          currentHunk.push(line);
        } else if (line.startsWith(' ')) {
          currentHunk.push(line);
        }
      }
    }

    if (currentHunk) {
      hunkBodies.push(currentHunk.join('\n'));
    }

    files.push({
      path: filePath,
      oldPath: status === 'R' ? oldPath : undefined,
      status,
      additions,
      deletions,
      isLockfile: isLockfile(filePath),
      isAsset: isAsset(filePath),
      hunkBodies: isBinary ? [] : hunkBodies
    });
  }

  return files;
}

/**
 * Ham git diff metnini AI modellerinin hızlı ve az token tüketerek
 * okuyabileceği kompakt formata çevirir.
 */
export function formatAiDiff(rawDiff: string, options: AiDiffOptions = {}): string {
  const trimmed = rawDiff.trim();
  if (!trimmed || trimmed === '(No diff)' || trimmed === '(No changes)') {
    return '(No changes)';
  }

  const maxChars = options.maxChars ?? 10_000;
  const collapseLockfiles = options.collapseLockfiles ?? true;
  const collapseAssets = options.collapseAssets ?? true;
  const targetPath = options.targetPath?.trim();

  const files = parseRawDiff(trimmed);
  if (files.length === 0) {
    return trimmed;
  }

  let totalAdditions = 0;
  let totalDeletions = 0;
  for (const f of files) {
    totalAdditions += f.additions;
    totalDeletions += f.deletions;
  }

  const outputParts: string[] = [];
  let currentLength = 0;
  let truncatedIndex = -1;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file) continue;

    const isTarget = targetPath ? file.path === targetPath || targetPath.endsWith(file.path) : false;
    const shouldCollapseLockfile =
      collapseLockfiles && file.isLockfile && !isTarget && file.additions + file.deletions > 5;
    const shouldCollapseAsset =
      collapseAssets && file.isAsset && !isTarget && file.additions + file.deletions > 5;

    const fileStatusTag =
      file.status === 'A'
        ? '[A - Added]'
        : file.status === 'D'
          ? '[D - Deleted]'
          : file.status === 'R'
            ? `[R - Renamed from ${file.oldPath}]`
            : file.status === 'B'
              ? '[B - Binary]'
              : '[M - Modified]';

    if (shouldCollapseLockfile) {
      const banner = `--- ${fileStatusTag} ${file.path} (+${file.additions}, -${file.deletions}) [Generated lockfile: hunks collapsed to save tokens. Use path="${file.path}" to expand] ---`;
      if (currentLength + banner.length > maxChars && i > 0) {
        truncatedIndex = i;
        break;
      }
      outputParts.push(banner);
      currentLength += banner.length;
      continue;
    }

    if (shouldCollapseAsset) {
      const banner = `--- ${fileStatusTag} ${file.path} (+${file.additions}, -${file.deletions}) [Asset/generated file: hunks collapsed to save tokens. Use path="${file.path}" to expand] ---`;
      if (currentLength + banner.length > maxChars && i > 0) {
        truncatedIndex = i;
        break;
      }
      outputParts.push(banner);
      currentLength += banner.length;
      continue;
    }

    if (file.status === 'B') {
      const banner = `--- ${fileStatusTag} ${file.path} (binary file changed) ---`;
      outputParts.push(banner);
      currentLength += banner.length;
      continue;
    }

    const fileHeader = `--- ${fileStatusTag} ${file.path} (+${file.additions}, -${file.deletions}) ---`;
    const hunksText = file.hunkBodies.join('\n');
    const fullBlock = hunksText ? `${fileHeader}\n${hunksText}` : fileHeader;

    if (currentLength + fullBlock.length > maxChars && i > 0) {
      truncatedIndex = i;
      break;
    }

    outputParts.push(fullBlock);
    currentLength += fullBlock.length;
  }

  // Bütçe aşımında kalan dosyaları özetle
  if (truncatedIndex !== -1) {
    const remaining = files.slice(truncatedIndex);
    const summaryList = remaining
      .map((f) => `${f.path} (+${f.additions}, -${f.deletions})`)
      .slice(0, 10)
      .join(', ');
    const more = remaining.length > 10 ? ` and ${remaining.length - 10} more` : '';
    outputParts.push(
      `\n[Diff truncated at ${maxChars} chars budget. Remaining ${remaining.length} files: ${summaryList}${more}. Use path="<file>" to inspect individual files]`
    );
  }

  const rawChars = trimmed.length;
  const aiDiffBody = outputParts.join('\n\n');
  const aiChars = aiDiffBody.length;
  const savingsPercent = rawChars > aiChars ? Math.round((1 - aiChars / rawChars) * 100) : 0;

  const headerBanner = `=== AI-Optimized Diff: ${files.length} file${files.length === 1 ? '' : 's'} (+${totalAdditions}, -${totalDeletions})${savingsPercent > 0 ? ` [~%${savingsPercent} token savings]` : ''} ===`;

  return `${headerBanner}\n\n${aiDiffBody}`;
}
