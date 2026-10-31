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

export interface MergeResult {
  /** Yama ana çalışma alanına uygulandı mı? */
  applied: boolean;
  message: string;
  /** `--3way` birleştirmesinin çözemediği dosyalar. */
  conflictedFiles: string[];
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

  /**
   * Worktree değişikliklerini ana çalışma alanına uygular.
   *
   * Birleştirmeden önce çatışma kontrolü yapılır: `git apply --check` temiz
   * geçerse yama doğrudan uygulanır; geçmezse `--3way` denenir ve kalan
   * çatışma dosyaları `git ls-files -u` ile listelenir. Çatışmalı birleştime
   * "başarılı" sayılmaz; kullanıcıya hangi dosyaların elle çözülmesi
   * gerektiği açıkça bildirilir.
   */
  public async mergeDiffIntoMain(worktreePath: string, workspaceRoot: string): Promise<MergeResult> {
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
      if (!diff.trim()) return { applied: false, message: 'No changes to merge.', conflictedFiles: [] };

      const patchPath = path.join(worktreePath, '..', `${path.basename(worktreePath)}.patch`);
      await fs.writeFile(patchPath, diff, 'utf-8');
      try {
        // Ön kontrol: temiz uygulanabiliyorsa doğrudan uygula (çatışmasız yol).
        let appliesCleanly = true;
        try {
          await execFileAsync('git', ['apply', '--check', patchPath], {
            cwd: workspaceRoot,
            maxBuffer: 8 * 1024 * 1024
          });
        } catch {
          appliesCleanly = false;
        }

        if (appliesCleanly) {
          await execFileAsync('git', ['apply', patchPath], {
            cwd: workspaceRoot,
            maxBuffer: 8 * 1024 * 1024
          });
          return {
            applied: true,
            message: 'Worktree changes applied to the main workspace.',
            conflictedFiles: []
          };
        }

        // Kirli uygulama: 3-yollu birleştirme dene ve kalan çatışmaları raporla.
        try {
          await execFileAsync('git', ['apply', '--3way', patchPath], {
            cwd: workspaceRoot,
            maxBuffer: 8 * 1024 * 1024
          });
        } catch {
          // Çatışma beklentisi: aşağıdaki ls-files kontrolü karar verir.
        }
        const { stdout: unmerged } = await execFileAsync('git', ['ls-files', '-u'], {
          cwd: workspaceRoot,
          maxBuffer: 4 * 1024 * 1024
        });
        const conflictedFiles = [
          ...new Set(
            unmerged
              .split('\n')
              .filter((line) => line.trim())
              .map((line) => line.split('\t').pop() || line.trim())
          )
        ];
        if (conflictedFiles.length > 0) {
          return {
            applied: false,
            conflictedFiles,
            message:
              `Could not merge: ${conflictedFiles.length} file(s) conflict with the main workspace ` +
              `(${conflictedFiles.slice(0, 8).join(', ')}). Resolve them manually or discard the worktree.`
          };
        }
        return {
          applied: true,
          message: 'Worktree changes applied to the main workspace (3-way merge).',
          conflictedFiles: []
        };
      } finally {
        await fs.rm(patchPath, { force: true }).catch(() => {});
      }
    } catch (err) {
      const stderr = isRecord(err) && typeof err.stderr === 'string' ? err.stderr.trim() : '';
      return {
        applied: false,
        conflictedFiles: [],
        message: `Could not merge changes (there may be a conflict): ${stderr || errorMessage(err)}`
      };
    }
  }

  public async remove(workspaceRoot: string, name: string, force = false): Promise<void> {
    const safeName = this.sanitizeName(name);
    const target = path.join(this.worktreesRoot(workspaceRoot), safeName);
    const args = ['worktree', 'remove', ...(force ? ['--force'] : []), target];
    await execFileAsync('git', args, { cwd: workspaceRoot, maxBuffer: 4 * 1024 * 1024 });
  }
}
