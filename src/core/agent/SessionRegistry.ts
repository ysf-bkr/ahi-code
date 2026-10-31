import type * as vscode from 'vscode';
import { AgentCore, AgentCoreDependencies, SharedServices } from './AgentCore';
import type { TaskState, UserSettings } from '@ahicode/core/shared/types';
import { logWarning } from '@ahicode/core/shared/logging';

/** Kayıt defterindeki bir oturumun arayüze bakan özeti. */
export interface SessionSnapshot {
  /** Kayıt defteri anahtarı; oturum kimliği atanana kadar da sabittir. */
  key: string;
  /** Kalıcı oturum kimliği (mesaj gönderilmeden önce boş). */
  id: string;
  prompt: string;
  status: TaskState['status'];
  /** Tur şu anda çalışıyor mu (arka planda olsa bile)? */
  running: boolean;
  messageCount: number;
}

export interface SessionRegistryOptions {
  context: vscode.ExtensionContext;
  settings: () => UserSettings;
  shared: SharedServices;
  /** Her oturum için ayrı durum yayını; anahtar ile etiketlenir. */
  onStateUpdate: (key: string, state: TaskState) => void;
  onNotify: (key: string, notification: { level: 'info' | 'warning' | 'error'; message: string }) => void;
  onStreamChunk: (key: string, messageId: string, chunk: string) => void;
  /** Oturum listesi değiştiğinde (yeni oturum, biten tur) çağrılır. */
  onSessionsChanged?: () => void;
}

/** Taslak oturum sayacı; oturum kimliği atanana kadar benzersiz anahtar üretir. */
let draftCounter = 0;

/**
 * Bellekte tutulan en fazla boşta oturum sayısı. Çalışan oturumlar asla
 * budanmaz; geçmiş zaten kalıcı olduğu için boşta bir oturumu kapatmak veri
 * kaybı değildir, yalnızca yeniden açılışta geçmişten yüklenir.
 */
const MAX_IDLE_SESSIONS = 6;

/**
 * Oturum kayıt defteri.
 *
 * Her sohbet kendi `AgentCore` örneğinde yaşar. Başka bir sohbete geçmek ya da
 * yeni sohbet açmak **çalışan turu durdurmaz**: çekirdek arka planda çalışmaya
 * devam eder, alt ajanları da sürer. Kullanıcı yalnızca görüntülediği oturumu
 * değiştirir.
 *
 * Ağır servisler (MCP, LSP, çağrı haritası, bilgi tabanı) paylaşılır; oturuma
 * özel durum (plan, snapshot, doğrulama baseline'ı) her çekirdekte kalır.
 */
export class SessionRegistry {
  private readonly cores = new Map<string, AgentCore>();
  private activeKey?: string;
  /** Kapanan oturumların son durumu; yeniden açılınca geçmişten tazelenir. */
  private readonly keysBySessionId = new Map<string, string>();

  constructor(private readonly options: SessionRegistryOptions) {}

  /** Etkin oturumun anahtarı. */
  public get active(): string | undefined {
    return this.activeKey;
  }

  /**
   * Eklenti açılışında çağrılır: son etkin oturumu geri yükler, bulunamazsa
   * boş bir sohbet açar. Arka planda bırakılmış çalışan oturum yoktur.
   */
  public bootstrap(): AgentCore {
    const lastId = this.options.context.workspaceState.get<string>('ahi_active_session_id');
    if (lastId) {
      const restored = this.activate(lastId);
      if (restored) return restored;
    }
    return this.openNewSession();
  }

  public getActiveCore(): AgentCore | undefined {
    return this.activeKey ? this.cores.get(this.activeKey) : undefined;
  }

  public getCore(key: string): AgentCore | undefined {
    return this.cores.get(key);
  }

  /**
   * Yeni boş oturum açar ve etkin yapar. Çalışan diğer oturumlar durdurulmaz.
   */
  public openNewSession(): AgentCore {
    const key = this.nextDraftKey();
    const core = this.createCore(key, { initialSessionId: null });
    this.cores.set(key, core);
    this.activeKey = key;
    void this.options.context.workspaceState.update('ahi_active_session_id', undefined);
    this.pruneIdleSessions();
    this.publish();
    return core;
  }

  /**
   * Boşta oturum sayısını sınırlar. Çalışan bir tur varken çekirdek kapatılmaz;
   * aksi halde kullanıcının arka plandaki işi habersiz kesilirdi.
   */
  private pruneIdleSessions(): void {
    const idle = [...this.cores.entries()].filter(([key, core]) => key !== this.activeKey && !core.isBusy());
    let excess = idle.length + 1 - MAX_IDLE_SESSIONS;
    for (const [key, core] of idle) {
      if (excess <= 0) break;
      this.cores.delete(key);
      const sessionId = core.getState().id;
      if (sessionId) this.keysBySessionId.delete(sessionId);
      core.dispose();
      excess -= 1;
    }
  }

  /**
   * Verilen oturumu etkin yapar.
   *
   * Oturum zaten bellekte çalışıyorsa aynı çekirdek kullanılır: arka plandaki
   * tur ve alt ajanları kesintisiz sürer. Bellekte yoksa geçmişten yüklenir.
   */
  public activate(sessionId: string): AgentCore | undefined {
    // 1. Canlı çekirdek var mı? (çalışıyor ya da daha önce açılmış)
    for (const [key, core] of this.cores) {
      if (core.getState().id === sessionId) {
        this.activeKey = key;
        void this.options.context.workspaceState.update('ahi_active_session_id', sessionId);
        this.publish();
        return core;
      }
    }

    // 2. Aynı oturum daha önce açılıp kapanmış olabilir.
    const knownKey = this.keysBySessionId.get(sessionId);
    const knownCore = knownKey ? this.cores.get(knownKey) : undefined;
    if (knownKey && knownCore) {
      this.activeKey = knownKey;
      void this.options.context.workspaceState.update('ahi_active_session_id', sessionId);
      this.publish();
      return knownCore;
    }

    // 3. Geçmişten yükle.
    const saved = this.options.shared.historyManager.getTask(sessionId);
    if (!saved) return undefined;

    const key = `session:${sessionId}`;
    const core = this.createCore(key, { initialSessionId: sessionId });
    this.cores.set(key, core);
    this.keysBySessionId.set(sessionId, key);
    this.activeKey = key;
    void this.options.context.workspaceState.update('ahi_active_session_id', sessionId);
    this.publish();
    return core;
  }

  /** Etkin oturumu kapatır; arka plandaki diğerleri çalışmaya devam eder. */
  public async close(key: string): Promise<void> {
    const core = this.cores.get(key);
    if (!core) return;
    this.cores.delete(key);
    const sessionId = core.getState().id;
    if (sessionId) this.keysBySessionId.delete(sessionId);
    core.dispose();
    if (this.activeKey === key) {
      this.activeKey = undefined;
      this.publish();
    } else {
      this.options.onSessionsChanged?.();
    }
  }

  /** Tüm oturumları kapatır (eklenti kapanırken). */
  public disposeAll(): void {
    for (const core of this.cores.values()) core.dispose();
    this.cores.clear();
    this.keysBySessionId.clear();
    this.activeKey = undefined;
    // Paylaşılan servislerin ömrü kayıt defterine bağlıdır; MCP sunucuları
    // ancak burada, tüm oturumlar kapandığında durdurulur.
    this.options.shared.mcpHub.stopAll();
  }

  /**
   * Ayarlar tüm oturumlara uygulanır: model, otonomi ve izinler globaldir.
   * Çalışan bir tur varsa yeni ayar bir sonraki istekte geçerli olur.
   */
  public updateSettings(settings: UserSettings): void {
    for (const core of this.cores.values()) {
      try {
        core.updateSettings(settings);
      } catch (err) {
        logWarning('Could not apply settings to a session', err);
      }
    }
  }

  /** Arayüzde listelemek için oturum özetleri (etkin olan önce). */
  public snapshots(): SessionSnapshot[] {
    const list: SessionSnapshot[] = [];
    for (const [key, core] of this.cores) {
      const state = core.getState();
      list.push({
        key,
        id: state.id,
        prompt: state.prompt,
        status: state.status,
        running: core.isBusy(),
        messageCount: state.messages.length
      });
    }
    return list.sort((a, b) => Number(b.key === this.activeKey) - Number(a.key === this.activeKey));
  }

  private nextDraftKey(): string {
    draftCounter += 1;
    return `draft:${Date.now()}:${draftCounter}`;
  }

  private createCore(key: string, dependencies: AgentCoreDependencies): AgentCore {
    let lastSignature = '';
    return new AgentCore(
      this.options.context,
      this.options.settings(),
      (state) => {
        // Yeni oturum ilk mesajı aldığında kalıcı kimliği oluşur; listede
        // görünmesi için anahtarı eşle.
        if (state.id) this.keysBySessionId.set(state.id, key);
        this.options.onStateUpdate(key, state);

        // Liste yalnızca görünen alanlar değiştiğinde yenilenir; her akış
        // parçasında arayüze yeni bir liste göndermek gereksiz gürültüdür.
        const signature = `${state.status}|${state.messages.length}|${this.cores.get(key)?.isBusy()}`;
        if (signature !== lastSignature) {
          lastSignature = signature;
          this.options.onSessionsChanged?.();
        }
      },
      (notification) => this.options.onNotify(key, notification),
      (messageId, chunk) => this.options.onStreamChunk(key, messageId, chunk),
      { ...dependencies, shared: this.options.shared }
    );
  }

  private publish(): void {
    const core = this.getActiveCore();
    if (core) this.options.onStateUpdate(this.activeKey as string, core.getState());
    this.options.onSessionsChanged?.();
  }
}
