/**
 * Çağrı haritasının yaşam döngüsü yöneticisi.
 *
 * - Kök başına tek harita tutar (çok köklü çalışma alanı).
 * - İlk tarama arka planda çalışır; bitmeden sorgu gelirse "hazırlanıyor" der.
 * - Dosya değişince yalnızca o dosyayı günceller.
 * - Ayar kapalıysa araçlar "kapalı" cevabı verir; mevcut davranış bozulmaz.
 */
import { CallGraphDocument, CallGraphStatus } from './types';
import { buildCallGraph, updateCallGraph } from './builder';
import { loadCallGraph, saveCallGraph, deleteCallGraph } from './store';
import { CallGraphLanguageService } from './languageService';
import { logWarning } from '../../shared/logging';

interface RootState {
  document?: CallGraphDocument;
  building: boolean;
  progress?: number;
  /** Artımlı güncelleme sırasında aynı dosyayı iki kez taramamak için. */
  pendingFiles: Set<string>;
  loaded: boolean;
  controller?: AbortController;
}

export interface CallGraphManagerOptions {
  /** Özellik kapalıysa hiçbir tarama yapılmaz. */
  enabled: () => boolean;
  /** Dil servisi üreteci; her kök için ayrı. */
  language: (workspaceRoot: string) => CallGraphLanguageService;
  /** İlerleme değişince arayüzü bilgilendirir. */
  onChange?: (status: CallGraphStatus) => void;
}

export class CallGraphManager {
  private states = new Map<string, RootState>();
  /** Kayıt fırtınasında disk yazımını seyreltmek için bekleyen zamanlayıcılar. */
  private saveTimers = new Map<string, NodeJS.Timeout>();

  constructor(private options: CallGraphManagerOptions) {}

  private state(root: string): RootState {
    let state = this.states.get(root);
    if (!state) {
      state = { building: false, pendingFiles: new Set(), loaded: false };
      this.states.set(root, state);
    }
    return state;
  }

  /** Özellik kullanılabilir mi? */
  public isEnabled(): boolean {
    return this.options.enabled();
  }

  /**
   * Haritayı diskten yükler; yoksa arka planda taramayı başlatır.
   *
   * Çağrı bloklamaz: tarama `void` olarak başlatılır, durum hemen döner.
   */
  public async ensureReady(workspaceRoot: string | undefined): Promise<CallGraphStatus> {
    if (!workspaceRoot) return this.statusMessage(undefined, 'Açık bir çalışma alanı yok.');
    if (!this.isEnabled()) {
      return this.statusMessage(workspaceRoot, 'Çağrı haritası ayarlardan kapatılmış.');
    }

    const state = this.state(workspaceRoot);

    if (!state.loaded) {
      state.document = await loadCallGraph(workspaceRoot);
      state.loaded = true;
    }

    if (state.document) {
      return this.statusMessage(workspaceRoot, 'Çağrı haritası hazır.');
    }

    if (!state.building) {
      void this.startBuild(workspaceRoot);
    }

    return this.statusMessage(
      workspaceRoot,
      state.progress === undefined
        ? 'Çağrı haritası hazırlanıyor…'
        : `Çağrı haritası hazırlanıyor: %${state.progress}`
    );
  }

  /** Tam taramayı arka planda başlatır. */
  public async startBuild(workspaceRoot: string): Promise<void> {
    const state = this.state(workspaceRoot);
    if (state.building) return;

    state.building = true;
    state.progress = 0;
    state.controller = new AbortController();
    this.emit(workspaceRoot);

    try {
      const result = await buildCallGraph(workspaceRoot, this.options.language(workspaceRoot), {
        signal: state.controller.signal,
        onProgress: (done, total) => {
          state.progress = total === 0 ? 100 : Math.round((done / total) * 100);
          this.emit(workspaceRoot);
        }
      });

      if (state.controller.signal.aborted) {
        // İptal edilen taramanın yarım sonucu diske yazılmaz.
        return;
      }

      state.document = result.document;
      await saveCallGraph(workspaceRoot, result.document);
      if (result.unsupportedFiles > 0) {
        logWarning(`[CallGraph] ${result.unsupportedFiles} dosya dil sunucusu olmadığı için taranamadı.`);
      }
    } catch (err) {
      logWarning('[CallGraph] Tarama başarısız', err);
    } finally {
      state.building = false;
      state.progress = undefined;
      state.controller = undefined;
      this.emit(workspaceRoot);
    }
  }

  /** Kullanıcı isteğiyle tam yeniden oluşturma. */
  public async rebuild(workspaceRoot: string): Promise<CallGraphStatus> {
    const state = this.state(workspaceRoot);
    state.document = undefined;
    await deleteCallGraph(workspaceRoot);
    await this.startBuild(workspaceRoot);
    return this.statusMessage(workspaceRoot, 'Çağrı haritası yeniden oluşturuluyor…');
  }

  /** Devam eden taramayı durdurur. */
  public stop(workspaceRoot: string): void {
    const state = this.states.get(workspaceRoot);
    state?.controller?.abort();
  }

  /**
   * Bir dosya değiştiğinde artımlı güncelleme yapar.
   *
   * Ajan dosya yazdıktan hemen sonra çağrılır; böylece aynı görev içinde
   * harita bayat kalmaz. Harita henüz yoksa hiçbir şey yapmaz.
   */
  public async onFileChanged(workspaceRoot: string, relativePath: string): Promise<void> {
    if (!this.isEnabled()) return;
    const state = this.state(workspaceRoot);
    if (state.building || !state.document) return;

    const normalized = relativePath.replace(/\\/g, '/');
    if (state.pendingFiles.has(normalized)) return;
    state.pendingFiles.add(normalized);

    try {
      const result = await updateCallGraph(
        workspaceRoot,
        state.document,
        this.options.language(workspaceRoot),
        { onlyFiles: [normalized] }
      );
      state.document = result.document;
      this.scheduleSave(workspaceRoot);
      this.emit(workspaceRoot);
    } catch (err) {
      logWarning(`[CallGraph] ${normalized} güncellenemedi`, err);
    } finally {
      state.pendingFiles.delete(normalized);
    }
  }

  /**
   * Diske yazmayı erteler.
   *
   * Kullanıcı art arda kaydettiğinde her kayıtta tüm haritayı yazmak pahalıdır;
   * kısa bir gecikmeyle son durum yazılır. Bellekteki harita her zaman günceldir.
   */
  private scheduleSave(workspaceRoot: string): void {
    const existing = this.saveTimers.get(workspaceRoot);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.saveTimers.delete(workspaceRoot);
      const document = this.states.get(workspaceRoot)?.document;
      if (!document) return;
      void saveCallGraph(workspaceRoot, document).catch((err) =>
        logWarning('[CallGraph] Harita diske yazılamadı', err)
      );
    }, 800);
    // Eklenti kapanırken zamanlayıcı süreci ayakta tutmasın.
    timer.unref?.();
    this.saveTimers.set(workspaceRoot, timer);
  }

  /** Bekleyen yazımları hemen tamamlar (kapanış ve testler için). */
  public async flush(workspaceRoot: string): Promise<void> {
    const timer = this.saveTimers.get(workspaceRoot);
    if (timer) {
      clearTimeout(timer);
      this.saveTimers.delete(workspaceRoot);
    }
    const document = this.states.get(workspaceRoot)?.document;
    if (document) await saveCallGraph(workspaceRoot, document);
  }

  /** Belirli bir kök için haritayı döndürür (hazır değilse undefined). */
  public getDocument(workspaceRoot: string | undefined): CallGraphDocument | undefined {
    if (!workspaceRoot) return undefined;
    return this.states.get(workspaceRoot)?.document;
  }

  /** Arayüz ve araçlar için durum bilgisi. */
  public status(workspaceRoot: string | undefined): CallGraphStatus {
    if (!workspaceRoot) return this.statusMessage(undefined, 'Açık bir çalışma alanı yok.');
    if (!this.isEnabled()) {
      return this.statusMessage(workspaceRoot, 'Çağrı haritası ayarlardan kapatılmış.');
    }
    const state = this.states.get(workspaceRoot);
    if (state?.document) {
      return this.statusMessage(workspaceRoot, 'Çağrı haritası hazır.');
    }
    return this.statusMessage(
      workspaceRoot,
      state?.building
        ? `Çağrı haritası hazırlanıyor: %${state.progress ?? 0}`
        : 'Çağrı haritası henüz oluşturulmadı.'
    );
  }

  private statusMessage(workspaceRoot: string | undefined, message: string): CallGraphStatus {
    const state = workspaceRoot ? this.states.get(workspaceRoot) : undefined;
    return {
      ready: Boolean(state?.document),
      building: Boolean(state?.building),
      progress: state?.progress,
      meta: state?.document?.meta,
      message
    };
  }

  private emit(workspaceRoot: string): void {
    this.options.onChange?.(this.status(workspaceRoot));
  }
}
