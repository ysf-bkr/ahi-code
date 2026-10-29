import * as path from 'path';
import * as fs from 'fs/promises';
import { ChatMessage, CheckpointSummary, TaskPlan, TaskState } from '../../shared/types';
import { AHI_DIR, AHI_SUBDIRS } from '../../shared/constants';
import { SnapshotManager } from '../snapshot/SnapshotManager';

export interface CheckpointRecord {
  id: string;
  turnIndex: number;
  preview: string;
  timestamp: number;
  messagesSnapshot: ChatMessage[];
  statsSnapshot: TaskState['stats'];
  planSnapshot?: TaskPlan;
  snapshotIds: string[];
}

interface CheckpointPersistence {
  dir: string;
  file: string;
}

export class CheckpointManager {
  private checkpoints: CheckpointRecord[] = [];
  private maxCheckpoints = 20;
  private maxPersistedBytes = 4 * 1024 * 1024;
  private persistence?: CheckpointPersistence;

  /**
   * Oturum checkpoint'lerini `.ahi/checkpoints/<oturumId>.json` altında
   * saklar; böylece eklenti yeniden yüklendikten sonra da erişilebilir kalır.
   */
  public async attachSession(workspaceRoot: string | undefined, sessionId: string): Promise<void> {
    if (!workspaceRoot || !sessionId) {
      this.persistence = undefined;
      this.checkpoints = [];
      return;
    }

    const dir = path.join(workspaceRoot, AHI_DIR, AHI_SUBDIRS.checkpoints);
    const file = path.join(dir, `${sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
    this.persistence = { dir, file };
    this.checkpoints = [];

    try {
      const raw = await fs.readFile(file, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.checkpoints = parsed
          .filter((item) => item && item.id && Array.isArray(item.messagesSnapshot))
          .slice(-this.maxCheckpoints);
      }
    } catch {
      // Kayıt yok ya da bozuk: boş başla.
    }
  }

  /** Testlerde ve kapanıştan önce disk yazımlarını bekler. */
  public async flush(): Promise<void> {
    await this.persist();
  }

  /**
   * Diske yazılacak kopyayı boyut sınırına sığacak şekilde kısaltır.
   * Bellekteki tam checkpoint korunur; yalnızca kalıcı kopya küçültülür.
   */
  private compactForStorage(records: CheckpointRecord[]): CheckpointRecord[] {
    const truncate = (value: string | undefined, limit: number): string | undefined =>
      value && value.length > limit
        ? `${value.slice(0, limit)}\n... [truncated for the persisted copy]`
        : value;

    const compact = records.map((record) => ({
      ...record,
      messagesSnapshot: record.messagesSnapshot.slice(-120).map((message) => ({
        ...message,
        content: truncate(message.content, 2_000) || '',
        toolCalls: message.toolCalls?.map((tc) => ({
          ...tc,
          result: truncate(tc.result, 2_000),
          error: truncate(tc.error, 1_000)
        }))
      }))
    }));

    let serialized = JSON.stringify(compact);
    if (serialized.length <= this.maxPersistedBytes) return compact;

    // Hâlâ çok büyükse yalnızca en son checkpoint'leri tut.
    let trimmed = compact.slice(-10);
    serialized = JSON.stringify(trimmed);
    if (serialized.length <= this.maxPersistedBytes) return trimmed;

    trimmed = compact.slice(-3);
    return trimmed;
  }

  private async persist(): Promise<void> {
    if (!this.persistence) return;
    try {
      await fs.mkdir(this.persistence.dir, { recursive: true });
      const data = this.compactForStorage(this.checkpoints);
      await fs.writeFile(this.persistence.file, JSON.stringify(data), {
        encoding: 'utf-8',
        mode: 0o600
      });
    } catch {
      // Kalıcılık ana iş akışını engellememeli.
    }
  }

  public createCheckpoint(state: TaskState, turnIndex: number, snapshotIds: string[] = []): CheckpointRecord {
    const lastUserMsg = [...state.messages].reverse().find((m) => m.role === 'user');
    const preview = lastUserMsg ? lastUserMsg.content.slice(0, 40) : `Tur #${turnIndex}`;

    const id = `cp_${Date.now()}_${turnIndex}`;
    const record: CheckpointRecord = {
      id,
      turnIndex,
      preview,
      timestamp: Date.now(),
      // Mesajları ve istatistikleri derin kopyala
      messagesSnapshot: JSON.parse(JSON.stringify(state.messages)),
      statsSnapshot: JSON.parse(JSON.stringify(state.stats)),
      planSnapshot: state.plan ? JSON.parse(JSON.stringify(state.plan)) : undefined,
      snapshotIds: [...snapshotIds]
    };

    this.checkpoints.push(record);
    if (this.checkpoints.length > this.maxCheckpoints) {
      this.checkpoints.shift();
    }
    void this.persist();

    return record;
  }

  public async rewindToCheckpoint(
    checkpointId: string,
    state: TaskState,
    snapshotManager: SnapshotManager,
    workspaceRoot?: string
  ): Promise<{ success: boolean; message: string; restoredState?: TaskState }> {
    const cpIndex = this.checkpoints.findIndex((c) => c.id === checkpointId);
    if (cpIndex === -1) {
      return { success: false, message: `Kontrol noktası bulunamadı: ${checkpointId}` };
    }

    const targetCp = this.checkpoints[cpIndex];
    if (!targetCp) {
      return { success: false, message: `Kontrol noktası bulunamadı: ${checkpointId}` };
    }
    const failedSnapshots: string[] = [];

    // Hedef checkpoint ve sonrakilerdeki tüm dosya değişikliklerini ters sırayla geri al.
    const laterCheckpoints = this.checkpoints.slice(cpIndex).reverse();
    for (const cp of laterCheckpoints) {
      for (const snapId of [...cp.snapshotIds].reverse()) {
        const res = await snapshotManager.revertSnapshot(snapId, workspaceRoot);
        if (!res.success) {
          failedSnapshots.push(res.message);
        }
      }
    }

    // Konuşma mesajlarını ve istatistikleri geri yükle
    state.messages = JSON.parse(JSON.stringify(targetCp.messagesSnapshot));
    state.stats = JSON.parse(JSON.stringify(targetCp.statsSnapshot));
    state.plan = targetCp.planSnapshot ? JSON.parse(JSON.stringify(targetCp.planSnapshot)) : state.plan;
    state.status = 'idle';
    state.pendingToolCall = undefined;
    state.pendingQuestion = undefined;

    // Hedefin ilerisindeki checkpoint'leri buda
    this.checkpoints = this.checkpoints.slice(0, cpIndex + 1);
    // Hedef checkpoint'in dosya değişiklikleri artık geri alındı.
    targetCp.snapshotIds = [];
    await this.persist();

    const warning =
      failedSnapshots.length > 0
        ? ` (${failedSnapshots.length} dosya geri alınamadı: ${failedSnapshots.slice(0, 3).join('; ')})`
        : '';

    return {
      success: true,
      message: `"${targetCp.preview}" noktasına başarıyla geri dönüldü.${warning}`,
      restoredState: state
    };
  }

  /**
   * Aktif (en son oluşturulan) checkpoint'e bir dosya anlık görüntüsü bağlar;
   * böylece bu turda yapılan değişiklikler geri sarmada da geri alınır.
   */
  public addSnapshotToLatestCheckpoint(snapshotId: string): void {
    const latest = this.checkpoints[this.checkpoints.length - 1];
    if (latest && !latest.snapshotIds.includes(snapshotId)) {
      latest.snapshotIds.push(snapshotId);
    }
  }

  public getSummaries(): CheckpointSummary[] {
    return this.checkpoints.map((c) => ({
      id: c.id,
      turnIndex: c.turnIndex,
      timestamp: c.timestamp,
      preview: c.preview
    }));
  }

  /**
   * Yalnızca belleği temizler. Diskteki oturum kayıtları korunur; kullanıcı
   * önceki oturuma dönebilir.
   */
  public async clear(): Promise<void> {
    this.checkpoints = [];
  }
}
