import * as path from 'path';
import * as fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { errorCode, errorMessage, isRecord } from '../../shared/errors';
import { AHI_DIR, AHI_SUBDIRS } from '../../shared/constants';

const execFileAsync = promisify(execFile);

export interface WorktreeInfo {
  name: string;
  path: string;
  branch: string;
  createdAt: number;
}

export interface WorktreeCreateOptions {
  /** Oluşturulacak dal adı; verilmezse ahi/<ad> kullanılır. */
  branch?: string;
  /** Başlangıç referansı (varsayılan HEAD). */
  baseRef?: string;
}

/**
 * Alt ajanların ana çalışma alanını bozmadan paralel çalışmasını sağlayan
 * Git worktree yönetimi. Worktree'ler `.ahi/worktrees/` altında tutulur ve
 * `.gitignore` kapsamındadır; değişiklikler ana dala otomatik birleştirilmez.
 */
export class WorktreeManager {
  public async isGitRepository(workspaceRoot: string): Promise<boolean> {
    try {
      await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: workspaceRoot });
      return true;
    } catch {
      // Git deposu değil: worktree yalıtımı kullanılamaz.
      return false;
    }
  }

  private sanitizeName(name: string): string {
    const sanitized = String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    if (!sanitized || sanitized === '.' || sanitized === '..') {
      throw new Error('Invalid worktree name.');
    }
    return sanitized;
  }

  private worktreesRoot(workspaceRoot: string): string {
    return path.join(workspaceRoot, AHI_DIR, AHI_SUBDIRS.worktrees);
  }

  private async realPath(target: string): Promise<string> {
    try {
      return await fs.realpath(target);
    } catch {
      // realpath henüz olmayan yollarda başarısız olur; sözdizimsel olarak çöz.
      return path.resolve(target);
    }
  }

  public async list(workspaceRoot: string): Promise<WorktreeInfo[]> {
    try {
      const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
        cwd: workspaceRoot
      });
      const roots = await this.realPath(this.worktreesRoot(workspaceRoot));
      const entries: WorktreeInfo[] = [];
      const blocks = stdout.split('\n\n');
      for (const block of blocks) {
        const lines = block.split('\n');
        const wtPath = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length);
        const branchRef = lines.find((line) => line.startsWith('branch '))?.slice('branch '.length);
        if (!wtPath) continue;
        const realWtPath = await this.realPath(wtPath);
        if (!realWtPath.startsWith(`${roots}${path.sep}`)) continue;
        entries.push({
          name: path.basename(wtPath),
          path: wtPath,
          branch: branchRef ? branchRef.replace('refs/heads/', '') : '(detached)',
          createdAt: 0
        });
      }
      return entries;
    } catch {
      // Okunamayan worktree klasörü: kayıt yok.
      return [];
    }
  }

  public async create(
    workspaceRoot: string,
    name: string,
    options: WorktreeCreateOptions = {}
  ): Promise<WorktreeInfo> {
    if (!(await this.isGitRepository(workspaceRoot))) {
      throw new Error('The workspace must be a Git repository to create an isolated worktree.');
    }

    const safeName = this.sanitizeName(name);
    const root = this.worktreesRoot(workspaceRoot);
    const target = path.join(root, safeName);
    const branch = options.branch || `ahi/${safeName}`;
    const baseRef = options.baseRef || 'HEAD';

    try {
      await fs.access(target);
      throw new Error(`Worktree already exists: ${safeName}`);
    } catch (err) {
      if (errorCode(err) !== 'ENOENT') throw err;
    }

    await fs.mkdir(root, { recursive: true });

    try {
      await execFileAsync('git', ['worktree', 'add', '-b', branch, target, baseRef], {
        cwd: workspaceRoot,
        maxBuffer: 4 * 1024 * 1024
      });
    } catch (err) {
      // Dal zaten varsa mevcut dalı kullan.
      const stderr = isRecord(err) && typeof err.stderr === 'string' ? err.stderr.trim() : '';
      const message = stderr || errorMessage(err);
      if (/already exists/i.test(message)) {
        await execFileAsync('git', ['worktree', 'add', target, branch], {
          cwd: workspaceRoot,
          maxBuffer: 4 * 1024 * 1024
        });
      } else {
        throw new Error(`Could not create worktree: ${message}`, { cause: err });
      }
    }

    return { name: safeName, path: target, branch, createdAt: Date.now() };
  }

  public async diff(worktreePath: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
        cwd: worktreePath,
        maxBuffer: 4 * 1024 * 1024
      });
      const { stdout: diffStat } = await execFileAsync('git', ['diff', '--stat'], {
        cwd: worktreePath,
        maxBuffer: 4 * 1024 * 1024
      });
      const parts = [
        stdout.trim() ? `Changed files:\n${stdout.trim()}` : 'No changes.',
        diffStat.trim() ? `\nDiff summary:\n${diffStat.trim()}` : ''
      ];
      return parts.join('\n').trim();
    } catch (err) {
      return `Could not get worktree diff: ${errorMessage(err)}`;
    }
  }

  public async mergeDiffIntoMain(worktreePath: string, workspaceRoot: string): Promise<string> {
    try {
      // Yeni (izlenmeyen) dosyalar farka girsin diye intent-to-add kullan.
      await execFileAsync('git', ['add', '-N', '.'], {
        cwd: worktreePath,
        maxBuffer: 4 * 1024 * 1024
      });
      const { stdout: diff } = await execFileAsync('git', ['diff'], {
        cwd: worktreePath,
        maxBuffer: 16 * 1024 * 1024
      });
      if (!diff.trim()) return 'No changes to merge.';

      const patchPath = path.join(worktreePath, '..', `${path.basename(worktreePath)}.patch`);
      await fs.writeFile(patchPath, diff, 'utf-8');
      try {
        await execFileAsync('git', ['apply', '--3way', patchPath], {
          cwd: workspaceRoot,
          maxBuffer: 8 * 1024 * 1024
        });
      } finally {
        await fs.rm(patchPath, { force: true }).catch(() => {});
      }
      return 'Worktree changes applied to the main workspace.';
    } catch (err) {
      const stderr = isRecord(err) && typeof err.stderr === 'string' ? err.stderr.trim() : '';
      return `Could not merge changes (there may be a conflict): ${stderr || errorMessage(err)}`;
    }
  }

  public async remove(workspaceRoot: string, name: string, force = false): Promise<void> {
    const safeName = this.sanitizeName(name);
    const target = path.join(this.worktreesRoot(workspaceRoot), safeName);
    const args = ['worktree', 'remove', ...(force ? ['--force'] : []), target];
    await execFileAsync('git', args, { cwd: workspaceRoot, maxBuffer: 4 * 1024 * 1024 });
  }
}
