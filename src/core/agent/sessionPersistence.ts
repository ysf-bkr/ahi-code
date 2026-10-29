/**
 * Oturum bazlı geri alma kayıtlarını (snapshot + checkpoint) çok köklü
 * çalışma alanlarında yönetir.
 *
 * Her kök ve oturum çifti için ayrı yönetici tutulur. Kök değişip geri
 * dönüldüğünde aynı örnekler yeniden kullanılır; böylece dosyadan tekrar
 * yükleme yapılmaz.
 */
import { CheckpointManager } from '../checkpoint/CheckpointManager';
import { SnapshotManager } from '../snapshot/SnapshotManager';

interface SessionEntry {
  snapshotManager: SnapshotManager;
  checkpointManager: CheckpointManager;
  sessionId: string;
}

export interface EnsureSessionResult {
  /** Yöneticiler değişti mi? Değiştiyse bağımlı nesneler yeniden kurulmalı. */
  managersChanged: boolean;
  /** Çalışma alanı kökü değişti mi? */
  rootChanged: boolean;
}

export class SessionPersistence {
  private active: SessionEntry = {
    snapshotManager: new SnapshotManager(),
    checkpointManager: new CheckpointManager(),
    sessionId: ''
  };
  private root = '';
  private byRoot = new Map<string, SessionEntry>();

  /** Takip edilen kök; onay akışı kök bulamazsa buna düşer. */
  public get currentRoot(): string {
    return this.root;
  }

  /** Kayıtları ve kök takibini sıfırlar (yeni oturum/oturum yükleme). */
  public reset(): void {
    this.byRoot.clear();
    this.root = '';
    this.active = {
      snapshotManager: new SnapshotManager(),
      checkpointManager: new CheckpointManager(),
      sessionId: ''
    };
  }

  /** O anki oturumun anlık görüntü yöneticisi. */
  public get snapshotManager(): SnapshotManager {
    return this.active.snapshotManager;
  }

  /** O anki oturumun checkpoint yöneticisi. */
  public get checkpointManager(): CheckpointManager {
    return this.active.checkpointManager;
  }

  /**
   * Verilen kök ve oturum için kayıtları diskten yükler. Aynı kök/oturum
   * ikilisi için ikinci kez çağrıldığında hiçbir şey yapmaz.
   */
  public async ensure(
    workspaceRoot: string,
    sessionId: string,
    resolvedRoot: string
  ): Promise<EnsureSessionResult> {
    if (this.active.sessionId === sessionId && this.root === resolvedRoot) {
      return { managersChanged: false, rootChanged: false };
    }

    const rootChanged = Boolean(this.root) && this.root !== resolvedRoot;

    // Mevcut kökün yöneticilerini sakla; kök ileride geri dönerse aynı
    // örnekler kullanılsın.
    if (this.root) {
      this.byRoot.set(this.root, {
        snapshotManager: this.active.snapshotManager,
        checkpointManager: this.active.checkpointManager,
        sessionId: this.active.sessionId || sessionId
      });
    }

    let entry = this.byRoot.get(resolvedRoot);
    if (!entry || entry.sessionId !== sessionId) {
      const snapshotManager = new SnapshotManager();
      const checkpointManager = new CheckpointManager();
      await snapshotManager.attachSession(workspaceRoot, sessionId);
      await checkpointManager.attachSession(workspaceRoot, sessionId);
      entry = { snapshotManager, checkpointManager, sessionId };
      this.byRoot.set(resolvedRoot, entry);
    }

    const managersChanged =
      this.active.snapshotManager !== entry.snapshotManager ||
      this.active.checkpointManager !== entry.checkpointManager;

    this.active = entry;
    this.root = resolvedRoot;

    return { managersChanged, rootChanged };
  }
}
