/**
 * Değişiklikler ekranının Git sorguları.
 *
 * Hepsi salt-okunur: çalışma ağacı durumu ve son commit'ler. Webview
 * işleyicisinden ayrıldığı için VS Code host'u olmadan test edilebilir.
 * Tek dosyanın side-by-side farkı SidebarProvider.showGitFileDiff içinde
 * HEAD içeriği üzerinden üretilir; burada ayrı bir diff yolu yoktur.
 */
import { GitChangesPayload } from '../shared/types';
import { GitManager } from '../core/git/GitManager';
import { errorMessage } from '../shared/errors';

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

    return { isRepository: true, branch, files, commits };
  } catch (err) {
    return emptyGitPayload(errorMessage(err, 'Git durumu alınamadı.'));
  }
}
