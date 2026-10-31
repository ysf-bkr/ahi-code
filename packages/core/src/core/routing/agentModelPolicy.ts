/**
 * Ajan bazlı model politikası.
 *
 * Model seçimi yalnızca kullanıcının ilk mesajına göre değil, her alt ajanın
 * rolüne ve alt görevin içeriğine göre yapılır. Çözümleme sırası:
 * (1) kullanıcının rol bazlı override'ı, (2) sağlayıcı hazır ayarı,
 * (3) rol sınıfı varsayılanı, (4) seçili model.
 *
 * EVREN seçildiğinde orkestrasyon ve akıl yürütme rolleri glm-5.3 ile,
 * keşif rolü mimo-v2.6-pro ile çalışır; glm-5.3 kullanılamazsa otomatik
 * fallback MiMo-V2.6-Pro'dur. Fallback yalnızca sağlayıcı gerçekten hata
 * verdiğinde devreye girer ve mesaj geçmişi korunduğu için bağlam kaybolmaz.
 */
import { OrchestratorRole, normalizeRole } from '../../shared/agents/routing';
import { isConversationModel } from '../../shared/modelCapability';
import type { UserSettings } from '../../shared/types';

export interface AgentModelChoice {
  /** Kullanılacak model; tanımsızsa ana sağlayıcının modeli kullanılır. */
  model?: string;
  /** Sağlayıcı hata verdiğinde denenacak yedek model. */
  fallbackModel?: string;
  /** Kullanıcıya gösterilecek kısa gerekçe. */
  reason: string;
  /** Seçim, kullanıcının seçtiği modelden farklı mı? */
  routed: boolean;
}

interface PresetEntry {
  model: string;
  fallback?: string;
}

export const EVREN_MODEL_GLM = 'glm-5.3';
export const EVREN_MODEL_MIMO = 'mimo-v2.6-pro';
export const EVREN_MODEL_DEEPSEEK = 'deepseek-v4.1-flash';

/**
 * EVREN LLM için rol bazlı hazır ayar (kullanıcı override'ı yoksa geçerli).
 * Kimlikler kataloğun sunucudaki canonical (küçük) biçimidir; eski yazımlar
 * 404 + öneri iyileştirmesiyle düzelir ama her ilk çağrıya bir gidiş-dönüş
 * maliyeti bindirirdi. Sohbet hattına yalnızca Sohbet sınıfındaki modeller
 * verilir; Karar/Görsel/OCR/Gömme modelleri kendi özellik uç noktalarında
 * kullanılır, araç çağıran kod hattına verilmez.
 */
const EVREN_ROLE_PRESETS: Readonly<Partial<Record<OrchestratorRole, PresetEntry>>> = {
  manager: { model: EVREN_MODEL_GLM, fallback: EVREN_MODEL_MIMO },
  architect: { model: EVREN_MODEL_GLM, fallback: EVREN_MODEL_MIMO },
  analyst: { model: EVREN_MODEL_GLM, fallback: EVREN_MODEL_MIMO },
  quality: { model: EVREN_MODEL_GLM, fallback: EVREN_MODEL_MIMO },
  security: { model: EVREN_MODEL_GLM, fallback: EVREN_MODEL_MIMO },
  explorer: { model: EVREN_MODEL_MIMO, fallback: EVREN_MODEL_DEEPSEEK }
};

/** Bağımsız inceleme ve orkestrasyon rolleri; güçlü model isterler. */
const REVIEW_ROLES: ReadonlySet<OrchestratorRole> = new Set(['quality', 'security']);
const ORCHESTRATION_ROLES: ReadonlySet<OrchestratorRole> = new Set(['manager', 'architect']);
/** Salt-okunur keşif rolleri; ucuz/hızlı model yeterlidir. */
const RECON_ROLES: ReadonlySet<OrchestratorRole> = new Set(['explorer', 'git']);

function presetForProvider(
  settings: UserSettings
): Partial<Record<OrchestratorRole, PresetEntry>> | undefined {
  return settings.selectedProvider === 'evren' ? EVREN_ROLE_PRESETS : undefined;
}

/** Bilinen bir rol sınıfı varsayılanı üretir; yoksa undefined. */
function roleKindDefault(
  role: OrchestratorRole,
  settings: UserSettings
): { model?: string; fallback?: string; reason: string } | undefined {
  const routing = settings.modelRouting;
  if (!routing?.enabled) return undefined;
  if (REVIEW_ROLES.has(role)) {
    return {
      model: routing.reviewModel || routing.deepModel,
      fallback: routing.deepModel || undefined,
      reason: 'Bağımsız inceleme rolü → inceleme modeli.'
    };
  }
  if (ORCHESTRATION_ROLES.has(role)) {
    return {
      model: routing.deepModel,
      fallback: undefined,
      reason: 'Orkestrasyon rolü → derin akıl yürütme modeli.'
    };
  }
  if (RECON_ROLES.has(role)) {
    return {
      model: routing.fastModel,
      fallback: undefined,
      reason: 'Keşif rolü → hızlı/düşük maliyetli model.'
    };
  }
  return undefined;
}

/** Basit/kısa alt görev işareti; güçlü modeli gereksiz çalıştırmamak için. */
function isLightTask(text: string): boolean {
  const value = String(text || '').trim();
  if (!value) return false;
  return (
    value.length < 160 &&
    /^(kısaca|açıkla|listele|oku|bul|kontrol et|ne demek|what|explain|list|read|find|check)\b/i.test(value)
  );
}

/**
 * Bir alt ajan görevi için model ve yedek model çözümler.
 *
 * Medya/embedding modelleri kod yazma hattına asla atanmaz; bir ayar
 * yanlışlıkla böyle bir modele işaret ediyorsa seçim yok sayılır. Basit
 * inceleme görevleri güçlü model yerine hafif modelle çalışır (maliyet
 * disiplini: sadece işin gerektirdiği gücü kullan).
 */
export function resolveAgentModel(rawRole: string, task: string, settings: UserSettings): AgentModelChoice {
  const role = normalizeRole(rawRole);
  const selected = settings.selectedModel?.trim();
  const noRoute: AgentModelChoice = { model: selected, reason: '', routed: false };
  if (!role) return noRoute;

  const presets = presetForProvider(settings);
  const overrides = settings.agentModels;
  const override = overrides?.[role]?.trim();

  const usable = (model: string | undefined): model is string =>
    Boolean(model && model !== 'auto' && isConversationModel(model) && model !== selected);

  // 1. Kullanıcının rol bazlı açık seçimi her şeyi ezer.
  if (override) {
    if (!isConversationModel(override)) return noRoute;
    const preset = presets?.[role];
    return {
      model: override,
      fallbackModel: preset?.fallback,
      reason: `Rol yönlendirmesi: @${role} için yapılandırılmış model.`,
      routed: override !== selected
    };
  }

  // 2. Sağlayıcı hazır ayarı (EVREN otomatik uygulanır; diğerleri yönlendirme
  //    açıksa rol sınıfı varsayılanıyla çalışır).
  const preset = presets?.[role];
  if (preset && isConversationModel(preset.model)) {
    const fallback = preset.fallback && isConversationModel(preset.fallback) ? preset.fallback : undefined;
    // Basit inceleme görevi güçlü modeli hak etmez: hafif modele in.
    const downgrade = fallback && isLightTask(task) && REVIEW_ROLES.has(role);
    const chosen = downgrade ? fallback : preset.model;
    return {
      model: chosen === selected ? undefined : chosen,
      fallbackModel: downgrade ? undefined : fallback,
      reason: downgrade
        ? `EVREN hazır ayarı: basit görev → hafif model ${chosen}.`
        : `EVREN hazır ayarı: @${role} → ${preset.model}${fallback ? ` (yedek: ${fallback})` : ''}.`,
      routed: chosen !== selected
    };
  }

  // 3. Rol sınıfı varsayılanı (model yönlendirme etkinse).
  const kindDefault = roleKindDefault(role, settings);
  if (kindDefault && usable(kindDefault.model)) {
    return {
      model: kindDefault.model,
      fallbackModel: usable(kindDefault.fallback) ? kindDefault.fallback : undefined,
      reason: `${kindDefault.reason} (@${role})`,
      routed: true
    };
  }

  // 4. Seçili model; görev metni yalnızca ilerideki iyileştirmeler için ayrılır.
  void task;
  return noRoute;
}
