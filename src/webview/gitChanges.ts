/**
 * Değişiklikler ekranının Git sorguları.
 *
 * Hepsi salt-okunur: çalışma ağacı durumu, son commit'ler ve tek dosya farkı.
 * Webview işleyicisinden ayrıldığı için VS Code host'u olmadan test edilebilir.
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

/**
 * Tek dosyanın commit edilmemiş farkını döndürür.
 * Değişiklik yoksa anlaşılır bir hata fırlatır; boş belge açmaz.
 */
export async function readGitFileDiff(
  workspaceRoot: string | undefined,
  git: GitManager | undefined,
  filePath: string
): Promise<string> {
  if (!workspaceRoot || !git) {
    throw new Error('Açık bir çalışma alanı yok.');
  }
  if (!(await git.isRepository(workspaceRoot))) {
    throw new Error('Bu çalışma alanı bir Git deposu değil.');
  }

  const diff = await git.diffFile(workspaceRoot, filePath);
  if (!diff.trim()) {
    throw new Error('Bu dosya için fark bulunamadı (izlenmeyen ya da değişmemiş olabilir).');
  }
  return diff;
}
