/**
 * Değişiklikler ekranının Git sorguları.
 *
 * Hepsi salt-okunur: çalışma ağacı durumu ve son commit'ler. Webview
 * işleyicisinden ayrıldığı için VS Code host'u olmadan test edilebilir.
 * Tek dosyanın side-by-side farkı SidebarProvider.showGitFileDiff içinde
 * HEAD içeriği üzerinden üretilir; burada ayrı bir diff yolu yoktur.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { GitChangesPayload, GitFileChange } from '@ahicode/core/shared/types';
import { GitManager } from '@ahicode/core/core/git/GitManager';
import { errorMessage } from '@ahicode/core/shared/errors';

/** Son commit listesinde gösterilecek kayıt sayısı. */
const RECENT_COMMIT_LIMIT = 10;

/** Boş/açıklamasız bir değişiklik listesi üretir. */
export function emptyGitPayload(error?: string): GitChangesPayload {
  return {
    isRepository: false,
    branch: '',
    files: [],
    commits: [],
    ...(error === undefined ? {} : { error })
  };
}

/**
 * Çalışma alanının Git durumunu toplar. Depo değilse bunu açıkça bildirir;
 * sorgu hataları boş liste olarak değil, `error` alanıyla döner.
 */
export async function collectGitChanges(
  workspaceRoot: string | undefined,
  git: GitManager | undefined
): Promise<GitChangesPayload> {
  if (!workspaceRoot || !git) {
    return emptyGitPayload('Açık bir çalışma alanı yok.');
  }

  try {
    const isRepository = await git.isRepository(workspaceRoot);
    if (!isRepository) {
      return emptyGitPayload();
    }

    const [branch, files, commits] = await Promise.all([
      // Dal adı alınamazsa (yeni depo) boş göster; listeyi komple düşürme.
      git.currentBranch(workspaceRoot).catch(() => ''),
      git.listChanges(workspaceRoot),
      git.listRecentCommits(workspaceRoot, RECENT_COMMIT_LIMIT)
    ]);

    // Değişiklik tarih/saati ve boyut diskten okunur; kullanıcı "bu dosya ne
    // zaman değişti?" sorusunu terminalde sormak zorunda kalmasın.
    const enriched = await Promise.all(
      files.map(async (file): Promise<GitFileChange> => {
        try {
          const stat = await fs.stat(path.join(workspaceRoot, file.path));
          return { ...file, modifiedAt: stat.mtimeMs, sizeBytes: stat.size };
        } catch {
          // Silinmiş ya da erişilemeyen dosya: zaman/boyut yok, silindi işaretlenir.
          return { ...file, deleted: true };
        }
      })
    );

    return { isRepository: true, branch, files: enriched, commits };
  } catch (err) {
    return emptyGitPayload(errorMessage(err, 'Git durumu alınamadı.'));
  }
}
