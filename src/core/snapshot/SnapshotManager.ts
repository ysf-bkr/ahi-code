import * as path from 'path';
import * as fs from 'fs/promises';
import { resolveWorkspacePath } from '../../tools/pathSafety';
import { errorCode, errorMessage } from '../../shared/errors';
import { AHI_DIR, AHI_SUBDIRS } from '../../shared/constants';

export interface FileSnapshot {
  id: string;
  filePath: string;
  originalContent: string | null; // null if file was created newly
  existsBefore: boolean;
  timestamp: number;
  toolCallId?: string;
  description?: string;
}

interface SnapshotPersistence {
  dir: string;
  sessionId: string;
}

export class SnapshotManager {
  private snapshots: FileSnapshot[] = [];
  private maxSnapshots = 50;
  private maxSnapshotBytes = 5 * 1024 * 1024;
  private persistence?: SnapshotPersistence;

  /**
   * Anlık görüntüleri `.ahi/snapshots/<oturumId>/` altında saklar; böylece
   * eklenti yeniden yüklendikten sonra da erişilebilir kalır.
   */
  public async attachSession(workspaceRoot: string | undefined, sessionId: string): Promise<void> {
    if (!workspaceRoot || !sessionId) {
      this.persistence = undefined;
      this.snapshots = [];
      return;
    }

    const dir = path.join(
      workspaceRoot,
      AHI_DIR,
      AHI_SUBDIRS.snapshots,
      sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')
    );
    this.persistence = { dir, sessionId };
    this.snapshots = [];

    try {
      const files = await fs.readdir(dir);
      const loaded: FileSnapshot[] = [];
      for (const file of files.filter((name) => name.endsWith('.json')).slice(-this.maxSnapshots)) {
        try {
          const raw = await fs.readFile(path.join(dir, file), 'utf-8');
          const parsed = JSON.parse(raw) as FileSnapshot;
          if (parsed && parsed.id && parsed.filePath) loaded.push(parsed);
        } catch {
          // Tek bozuk kayıt tüm oturumu engellememeli.
        }
      }
      this.snapshots = loaded.sort((a, b) => a.timestamp - b.timestamp).slice(-this.maxSnapshots);
    } catch {
      // Dizin yok: ilk oturum
    }
  }

  private async persistSnapshot(snapshot: FileSnapshot): Promise<void> {
    if (!this.persistence) return;
    try {
      await fs.mkdir(this.persistence.dir, { recursive: true });
      await fs.writeFile(path.join(this.persistence.dir, `${snapshot.id}.json`), JSON.stringify(snapshot), {
        encoding: 'utf-8',
        mode: 0o600
      });
    } catch {
      // Kalıcılık ana iş akışını engellememeli.
    }
  }

  private async removePersisted(ids: string[]): Promise<void> {
    if (!this.persistence) return;
    for (const id of ids) {
      try {
        await fs.rm(path.join(this.persistence.dir, `${id}.json`), { force: true });
      } catch {
        // yoksay
      }
    }
  }

  /**
   * Bir dosyanın durumunu değiştirilmeden veya yazılmadan önce kopyalar.
   */
  public async createSnapshot(
    filePath: string,
    workspaceRoot?: string,
    toolCallId?: string,
    description?: string
  ): Promise<string> {
    const fullPath = workspaceRoot
      ? resolveWorkspacePath(filePath, workspaceRoot)
      : path.isAbsolute(filePath)
        ? filePath
        : filePath;

    let originalContent: string | null;
    let existsBefore: boolean;

    try {
      const stat = await fs.stat(fullPath);
      if (stat.size > this.maxSnapshotBytes) {
        throw new Error(
          `File snapshot for undo is too large (${Math.round(stat.size / 1024 / 1024)} MB, limit ${Math.round(this.maxSnapshotBytes / 1024 / 1024)} MB): ${filePath}`
        );
      }
      originalContent = await fs.readFile(fullPath, 'utf-8');
      existsBefore = true;
    } catch (err) {
      if (errorMessage(err).includes('File snapshot for undo is too large')) throw err;
      // "Dosya yok" ile "dosya okunamıyor" ayrımını koru: EACCES/EPERM gibi
      // hatalarda existsBefore=false demek, var olan bir dosyanın geri alırken
      // yanlışlıkla silinmesine yol açabilir.
      if (errorCode(err) !== 'ENOENT') throw err;
      existsBefore = false;
      originalContent = null;
    }

    const id = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const snapshot: FileSnapshot = {
      id,
      filePath,
      originalContent,
      existsBefore,
      timestamp: Date.now(),
      toolCallId,
      description
    };

    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.maxSnapshots) {
      const removed = this.snapshots.shift();
      if (removed) void this.removePersisted([removed.id]);
    }

    await this.persistSnapshot(snapshot);
    return id;
  }

  /**
   * Belirli bir anlık görüntüye geri döner.
   */
  public async revertSnapshot(
    snapshotId: string,
    workspaceRoot?: string
  ): Promise<{ success: boolean; message: string; filePath: string }> {
    const snapshot = this.snapshots.find((s) => s.id === snapshotId);
    if (!snapshot) {
      return { success: false, message: `Anlık görüntü bulunamadı: ${snapshotId}`, filePath: '' };
    }

    const fullPath = workspaceRoot
      ? resolveWorkspacePath(snapshot.filePath, workspaceRoot)
      : path.isAbsolute(snapshot.filePath)
        ? snapshot.filePath
        : snapshot.filePath;

    try {
      if (snapshot.existsBefore && snapshot.originalContent !== null) {
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, snapshot.originalContent, 'utf-8');
        this.removeSnapshots([snapshot.id]);
        await this.removePersisted([snapshot.id]);
        return {
          success: true,
          message: `"${snapshot.filePath}" önceki durumuna döndürüldü.`,
          filePath: snapshot.filePath
        };
      } else {
        // Dosya önceden yoktu; yeni oluşturulmuş, bu yüzden sil.
        try {
          await fs.unlink(fullPath);
        } catch (err) {
          if (errorCode(err) !== 'ENOENT') throw err;
        }
        this.removeSnapshots([snapshot.id]);
        await this.removePersisted([snapshot.id]);
        return {
          success: true,
          message: `Yeni oluşturulan "${snapshot.filePath}" dosyası silinerek geri alındı.`,
          filePath: snapshot.filePath
        };
      }
    } catch (err) {
      return {
        success: false,
        message: `Geri alma başarısız: ${errorMessage(err)}`,
        filePath: snapshot.filePath
      };
    }
  }

  /**
   * En son dosya değişikliğini geri alır (Geri Al).
   */
  public async revertLast(
    workspaceRoot?: string
  ): Promise<{ success: boolean; message: string; filePath?: string }> {
    if (this.snapshots.length === 0) {
      return { success: false, message: 'Geri alınacak dosya değişikliği yok.' };
    }

    const last = this.snapshots[this.snapshots.length - 1];
    if (!last) {
      return { success: false, message: 'Geri alınacak dosya değişikliği bulunamadı.' };
    }
    const res = await this.revertSnapshot(last.id, workspaceRoot);
    if (!res.success) {
      // Geri alma başarısızsa anlık görüntüyü kaybetme.
      if (!this.snapshots.some((s) => s.id === last.id)) {
        this.snapshots.push(last);
      }
    }
    return res;
  }

  public getSnapshots(): FileSnapshot[] {
    return [...this.snapshots];
  }

  public getSnapshotByToolCall(toolCallId: string): FileSnapshot | undefined {
    return [...this.snapshots].reverse().find((s) => s.toolCallId === toolCallId);
  }

  public removeSnapshots(ids: string[]): void {
    const remove = new Set(ids);
    this.snapshots = this.snapshots.filter((s) => !remove.has(s.id));
  }

  /**
   * Yalnızca belleği temizler. Oturum değiştiğinde diskteki geri alma
   * kayıtları korunur; kullanıcı önceki oturuma dönebilir.
   */
  public async clear(): Promise<void> {
    this.snapshots = [];
  }
}
