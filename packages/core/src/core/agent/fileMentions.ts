import * as fs from 'fs/promises';
import { resolveWorkspacePath } from '../../tools/pathSafety';

/** Kullanıcı mesajındaki `@src/index.ts` biçimli referansları yakalar. */
const MENTION_PATTERN = /@([a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*)/g;

/** Bağlamı korumak için mesaj başına işlenecek en fazla bahis sayısı. */
const MAX_MENTIONS = 10;
/** Bahsedilen dosya başına alınacak satır sayısı. */
const MAX_LINES_PER_FILE = 250;

/** Yinelenmeyen, sırası korunan `@dosya` bahisleri. */
export function extractFileMentions(text: string): string[] {
  const mentioned = new Set<string>();
  for (const match of text.matchAll(MENTION_PATTERN)) {
    if (match[1]) mentioned.add(match[1]);
  }
  return [...mentioned];
}

export interface CollectMentionsOptions {
  workspaceRoot: string;
  /** Okumadan önce uygulanan deny kuralları ve hassas dosya koruması. */
  isBlocked?: (relativePath: string) => boolean;
  maxMentions?: number;
  maxLinesPerFile?: number;
}

/**
 * `@yol` ile belirtilen çalışma alanı dosyalarını okuyup her dosya için
 * bir istem parçası döndürür. Geçersiz yollar, klasörler ve engelli
 * dosyalar sessizce atlanır: eski bir bahis tüm turu bozmamalı.
 */
export async function collectMentionSnippets(
  text: string,
  options: CollectMentionsOptions
): Promise<string[]> {
  const maxMentions = options.maxMentions ?? MAX_MENTIONS;
  const maxLines = options.maxLinesPerFile ?? MAX_LINES_PER_FILE;
  const snippets: string[] = [];

  for (const relPath of extractFileMentions(text).slice(0, maxMentions)) {
    if (options.isBlocked?.(relPath)) continue;
    try {
      const fullPath = resolveWorkspacePath(relPath, options.workspaceRoot);
      const stat = await fs.stat(fullPath);
      if (!stat.isFile()) continue;

      const content = await fs.readFile(fullPath, 'utf-8');
      const lines = content.split('\n');
      const snippet = lines.slice(0, maxLines).join('\n');
      const suffix =
        lines.length > maxLines ? `\n... [${lines.length - maxLines} remaining lines truncated]` : '';
      snippets.push(`[Referenced File Context (@${relPath})]:\n\`\`\`\n${snippet}${suffix}\n\`\`\``);
    } catch {
      // Geçersiz yol ya da stat ile okuma arasında silinen dosya: yok say.
    }
  }

  return snippets;
}
