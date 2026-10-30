import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { errorMessage, isRecord } from '../../shared/errors';
import { GitCommitSummary, GitFileChange } from '../../shared/types';
import { formatAiDiff, AiDiffOptions } from '../../shared/aiDiff';

export interface GitDiffOptions extends AiDiffOptions {
  path?: string;
  staged?: boolean;
  compact?: boolean;
  statOnly?: boolean;
  contextLines?: number;
}

const execFileAsync = promisify(execFile);

/**
 * Git komutunu çalıştırır.
 *
 * `trim()` varsayılan; ancak `git status --short` çıktısında ilk iki karakter
 * durum harfleridir ve baştaki boşluk anlamlıdır. `raw` seçeneği yalnızca
 * sondaki satır sonlarını temizler, böylece dosya adları kırpılmaz.
 */
async function git(args: string[], cwd: string, options: { raw?: boolean } = {}): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 16 * 1024 * 1024
  });
  return options.raw ? stdout.replace(/\s+$/, '') : stdout.trim();
}

/** `git status --short` satırlarını yapılandırılmış dosya değişikliklerine çevirir. */
function parseGitStatusShort(output: string): GitFileChange[] {
  const changes: GitFileChange[] = [];
  for (const line of output.split('\n')) {
    if (line.length < 4) continue;
    const indexStatus = line[0] ?? ' ';
    const workTreeStatus = line[1] ?? ' ';
    let rawPath = line.slice(3);
    // Yeniden adlandırma "R  eski -> yeni" olarak gelir; sonuç yolunu göster.
    if (rawPath.includes(' -> ')) {
      rawPath = rawPath.split(' -> ').pop() || rawPath;
    }
    // Tırnaklı yollar (ASCII dışı) --short çıktısında tırnaklarıyla kalır.
    if (rawPath.startsWith('"') && rawPath.endsWith('"')) {
      rawPath = rawPath.slice(1, -1);
    }
    if (!rawPath) continue;
    changes.push({ path: rawPath, indexStatus, workTreeStatus });
  }
  return changes;
}

/** `git log --oneline` satırlarını yapılandırılmış commit'lere çevirir. */
function parseGitLogOneline(output: string): GitCommitSummary[] {
  const commits: GitCommitSummary[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const spaceIndex = trimmed.indexOf(' ');
    if (spaceIndex <= 0) continue;
    commits.push({
      hash: trimmed.slice(0, spaceIndex),
      subject: trimmed.slice(spaceIndex + 1)
    });
  }
  return commits;
}

export interface CommandCheckpoint {
  root: string;
  /** Komut çalışmadan önce eşleşen çalışma ağacı commit'i. */
  head: string;
  createdAt: number;
  /**
   * Komutun bittiği an. Geri alma yalnızca bu andan önce değişmiş dosyaları
   * geri alır; sonradan gelen değişiklikler kullanıcına aittir ve korunur
   * (denetim bulgusu F07). Eski kayıtlarda alan yoktur.
   */
  completedAt?: number;
}

export interface PrBodyOptions {
  title?: string;
  summary?: string;
  tests?: string;
}

export class GitManager {
  public async isRepository(workspaceRoot: string): Promise<boolean> {
    try {
      await git(['rev-parse', '--is-inside-work-tree'], workspaceRoot);
      return true;
    } catch {
      // Git deposu değil: çağıranlar bunu "Git özelliği yok" olarak ele alır.
      return false;
    }
  }

  public async status(workspaceRoot: string): Promise<string> {
    return (await git(['status', '--short'], workspaceRoot)) || 'Working tree is clean.';
  }

  public async diff(workspaceRoot: string, options: GitDiffOptions = {}): Promise<string> {
    if (options.statOnly) {
      return this.diffStat(workspaceRoot, options.staged);
    }
    const args = ['diff'];
    if (options.staged) {
      args.push('--cached');
    }
    const context = options.contextLines ?? (options.compact !== false ? 1 : 3);
    args.push(`-U${context}`);
    if (options.path) {
      const rel = options.path.replace(/\\/g, '/').trim();
      if (rel && !rel.includes('..') && !rel.startsWith('/')) {
        args.push('--', rel);
      }
    }
    const raw = await git(args, workspaceRoot);
    if (!raw) {
      return '(No diff)';
    }
    if (options.compact === false) {
      return raw;
    }
    return formatAiDiff(raw, {
      maxChars: options.maxChars ?? 10_000,
      targetPath: options.path,
      collapseLockfiles: options.collapseLockfiles,
      collapseAssets: options.collapseAssets
    });
  }

  public async diffStat(workspaceRoot: string, staged?: boolean): Promise<string> {
    const args = staged ? ['diff', '--stat', '--cached'] : ['diff', '--stat'];
    return (await git(args, workspaceRoot)) || '(No diff statistics)';
  }

  public async currentBranch(workspaceRoot: string): Promise<string> {
    return git(['rev-parse', '--abbrev-ref', 'HEAD'], workspaceRoot);
  }

  public async recentCommits(workspaceRoot: string, count = 5): Promise<string> {
    return git(['log', `-${Math.max(1, Math.min(count, 20))}`, '--oneline'], workspaceRoot);
  }

  /** Değişiklikler ekranı için yapılandırılmış çalışma ağacı durumu. */
  public async listChanges(workspaceRoot: string): Promise<GitFileChange[]> {
    // Ham çıktı şart: baştaki boşluk çalışma ağacı durumunun bir parçası.
    const output = await git(['status', '--short'], workspaceRoot, { raw: true });
    return parseGitStatusShort(output);
  }

  /** Değişiklikler ekranı için yapılandırılmış son commit listesi. */
  public async listRecentCommits(workspaceRoot: string, count = 10): Promise<GitCommitSummary[]> {
    const output = await git(['log', `-${Math.max(1, Math.min(count, 30))}`, '--oneline'], workspaceRoot);
    return parseGitLogOneline(output);
  }

  /** Tek bir commit'in tam yaması; diff belgesinde gösterilir. */
  public async commitDetail(workspaceRoot: string, commitHash: string): Promise<string> {
    const hash = commitHash.trim();
    if (!/^[0-9a-f]{7,40}$/i.test(hash)) {
      throw new Error('Geçersiz commit kimliği.');
    }
    return git(['show', '--stat', '--patch', hash], workspaceRoot);
  }

  /** İzlenen tek dosyanın commit edilmemiş farkı (çalışma ağacı + indeks vs HEAD). */
  public async diffFile(workspaceRoot: string, filePath: string): Promise<string> {
    const rel = filePath.replace(/\\/g, '/').trim();
    if (!rel || rel.includes('..') || rel.startsWith('/')) {
      throw new Error('Geçersiz dosya yolu.');
    }
    return git(['diff', 'HEAD', '--', rel], workspaceRoot);
  }

  /** Dosyanın Git HEAD sürümünün içeriğini okur; dosya yeni veya izlenmiyorsa boş döner. */
  public async getFileHeadContent(workspaceRoot: string, filePath: string): Promise<string> {
    const rel = filePath.replace(/\\/g, '/').trim();
    if (!rel || rel.includes('..') || rel.startsWith('/')) {
      throw new Error('Geçersiz dosya yolu.');
    }
    return git(['show', `HEAD:${rel}`], workspaceRoot, { raw: true }).catch(() => '');
  }

  public async createBranch(workspaceRoot: string, name: string): Promise<string> {
    const branch = name.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]{1,80}$/.test(branch) || branch.includes('..')) {
      throw new Error('Invalid branch name.');
    }
    // 2.23 öncesi Git sürümleriyle uyum için checkout -b kullan.
    await git(['checkout', '-b', branch], workspaceRoot);
    return `Created and checked out branch: ${branch}`;
  }

  public async stage(workspaceRoot: string, paths: string[] = []): Promise<string> {
    if (paths.length === 0) {
      await git(['add', '-A'], workspaceRoot);
      return 'All changes staged.';
    }
    const safePaths = paths.filter((item) => item.trim() && !item.includes('..'));
    if (safePaths.length === 0) {
      throw new Error('No valid paths to stage.');
    }
    await git(['add', '--', ...safePaths], workspaceRoot);
    return `Staged: ${safePaths.join(', ')}`;
  }

  public async commit(workspaceRoot: string, message: string): Promise<string> {
    const text = message.trim();
    if (text.length < 3) {
      throw new Error('The commit message must be at least 3 characters long.');
    }
    const staged = await git(['diff', '--cached', '--name-only'], workspaceRoot).catch(() => '');
    if (!staged.trim()) {
      const porcelain = await git(['status', '--porcelain'], workspaceRoot).catch(() => '');
      if (!porcelain.trim()) {
        return 'No changes to commit (working tree is clean).';
      }
      return 'No staged files to commit. Run "git_stage" first or stage the changes.';
    }
    await git(['commit', '-m', text], workspaceRoot);
    const hash = await git(['rev-parse', '--short', 'HEAD'], workspaceRoot);
    return `Commit created: ${hash} — ${text.split('\n')[0]}`;
  }

  private async resolveBaseBranch(workspaceRoot: string): Promise<string> {
    for (const branch of ['main', 'master', 'develop']) {
      try {
        await git(['rev-parse', '--verify', branch], workspaceRoot);
        return branch;
      } catch {
        // sıradaki aday
      }
    }
    return 'HEAD~1';
  }

  public async preparePrBody(workspaceRoot: string, options: PrBodyOptions = {}): Promise<string> {
    if (!(await this.isRepository(workspaceRoot))) {
      throw new Error('The workspace is not a Git repository.');
    }

    const base = await this.resolveBaseBranch(workspaceRoot);
    const [branch, status, stat, commits] = await Promise.all([
      this.currentBranch(workspaceRoot),
      this.status(workspaceRoot),
      git(['diff', '--stat', `${base}...HEAD`], workspaceRoot).catch(() => this.diffStat(workspaceRoot)),
      git(['log', `${base}..HEAD`, '--oneline'], workspaceRoot).catch(() => this.recentCommits(workspaceRoot))
    ]);

    const title = options.title?.trim() || `AhiCode changes (${branch})`;
    const summary = options.summary?.trim() || 'This PR contains changes prepared by the AhiCode agent.';
    const tests =
      options.tests?.trim() || 'Test results were verified during the task; see the task output for details.';

    return [
      `## ${title}`,
      '',
      '### Summary',
      summary,
      '',
      '### Branch',
      `\`${branch}\``,
      '',
      '### Change summary',
      '```',
      stat,
      '```',
      '',
      '### Working tree status',
      '```',
      status,
      '```',
      '',
      '### Recent commits',
      '```',
      commits || '(no commits)',
      '```',
      '',
      '### Tests',
      tests,
      '',
      '> Note: This tool does not automatically push or open a PR; user approval is required.'
    ].join('\n');
  }

  /**
   * Komut düzeyinde geri alma desteği.
   *
   * Dosya anlık görüntüleri bir kabuk komutunun yaptığını kapsayamaz
   * (`npm install`, migration'lar, kod üreticileri). Çalışma alanı temiz bir
   * Git deposuysa komut öncesi HEAD ve izlenmeyen dosya listesi kaydedilir,
   * komut sonrası o durum geri yüklenir.
   */
  public async createCommandCheckpoint(workspaceRoot: string): Promise<CommandCheckpoint | undefined> {
    if (!(await this.isRepository(workspaceRoot))) return undefined;
    try {
      const head = await git(['rev-parse', 'HEAD'], workspaceRoot);
      const status = await git(['status', '--porcelain'], workspaceRoot);
      // Zaten kirli bir ağaç tam olarak geri yüklenemez; kullanıcının commit
      // edilmemiş işini sessizce yok etmek yerine reddet.
      if (status.trim()) return undefined;
      return { root: workspaceRoot, head, createdAt: Date.now() };
    } catch {
      // HEAD yok ya da git çalıştırılabilir dosyası yok: komut checkpoint'i alınamaz.
      return undefined;
    }
  }

  /**
   * Çalışma ağacını verilen checkpoint'e geri yükler: izlenen değişiklikleri
   * atar, silinen dosyaları geri getirir ve komutun oluşturduğu izlenmeyen
   * dosyaları siler.
   *
   * Komutun bitişinden (`completedAt`) sonra değişen ya da oluşan dosyalar
   * kullanıcının işi sayılır: geri alınmaz, sonuç mesajında listelenir. Toplu
   * `clean` yalnızca komuta ait etkiler için çalıştırılır; korunacak dosyalar
   * önce belleğe alınır ve geri yüklemelerden sonra tekrar yazılır (F07).
   */
  public async restoreCommandCheckpoint(checkpoint: CommandCheckpoint): Promise<string> {
    const { root, head } = checkpoint;
    const currentCheck: CommandCheckpoint | undefined = await (async () => {
      try {
        return { root, head: await git(['rev-parse', 'HEAD'], root), createdAt: Date.now() };
      } catch {
        // HEAD artık okunamıyor, checkpoint doğrulanamaz.
        return undefined;
      }
    })();
    if (!currentCheck) throw new Error('The workspace is no longer a Git repository.');

    // Komut bittikten kısa süre sonra yazılan dosyalar hâlâ komutun etkisi
    // olabilir (zaman uyumsuz tampon boşaltması); küçük bir hoşgörü payı ekle.
    const COMMAND_POST_GRACE_MS = 2_000;
    const cutoff = checkpoint.completedAt ? checkpoint.completedAt + COMMAND_POST_GRACE_MS : undefined;

    // Kullanıcına ait değişiklikleri belirle: komut bittikten sonra değişmiş
    // her dosya korunur. Checkpoint'te bitiş zamanı yoksa (eski kayıt) ayırt
    // edilemez; önceki davranışla uyum için her şey geri alınır.
    const status = await git(['status', '--porcelain'], root, { raw: true });
    const changedPaths: string[] = [];
    for (const line of status.split('\n')) {
      if (line.length < 4) continue;
      let rawPath = line.slice(3);
      if (rawPath.includes(' -> ')) rawPath = rawPath.split(' -> ').pop() || rawPath;
      if (rawPath.startsWith('"') && rawPath.endsWith('"')) rawPath = rawPath.slice(1, -1);
      if (rawPath) changedPaths.push(rawPath);
    }

    const keptFiles: Array<{ relative: string; content: Buffer; mode?: number }> = [];
    if (cutoff !== undefined) {
      for (const relative of changedPaths) {
        let stat;
        try {
          stat = await fs.stat(path.join(root, relative));
        } catch {
          continue; // Silinmiş dosya: sahibi belirsiz, güvenli taraf geri yükle.
        }
        if (stat.mtimeMs > cutoff) {
          try {
            const content = await fs.readFile(path.join(root, relative));
            keptFiles.push({ relative, content, mode: stat.mode });
          } catch {
            // Okunamayan dosya korunamaz; toplu geri alma devam eder.
          }
        }
      }
    }

    // Komutun yaptığı commit'leri de geri al ki HEAD checkpoint ile eşleşsin.
    if (currentCheck.head !== head) {
      await git(['reset', '--hard', head], root);
    } else {
      await git(['checkout', '--', '.'], root);
    }
    // Komutun oluşturduğu (izlenmeyen) dosyaları sil, ama ignore edilen yollara dokunma.
    await git(['clean', '-fd'], root);

    // Korunan kullanıcı dosyalarını tekrar yaz: aynı içerik ve izinlerle.
    for (const file of keptFiles) {
      try {
        await fs.mkdir(path.dirname(path.join(root, file.relative)), { recursive: true });
        await fs.writeFile(path.join(root, file.relative), file.content, { mode: file.mode });
      } catch {
        // Korunan dosya geri yazılamadıysa bunu sonuçta bildir.
      }
    }

    const finalStatus = await git(['status', '--porcelain'], root, { raw: true });
    const keptNames = keptFiles.map((file) => file.relative);
    const keptNote =
      keptNames.length > 0
        ? `\nKullanıcı değişiklikleri korundu (komut bittikten sonra değişti): ${keptNames.slice(0, 10).join(', ')}${keptNames.length > 10 ? ', …' : ''}`
        : '';

    if (finalStatus.trim()) {
      return `Command changes were partially reverted; remaining changes:\n${finalStatus}${keptNote}`;
    }
    return `Command changes were reverted (working tree matches the checkpoint).${keptNote}`;
  }

  public static describeError(error: unknown): string {
    if (isRecord(error) && typeof error.stderr === 'string' && error.stderr.trim()) {
      return error.stderr.trim();
    }
    return errorMessage(error);
  }
}
