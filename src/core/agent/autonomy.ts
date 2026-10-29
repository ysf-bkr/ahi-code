/**
 * Otonomi politikası.
 *
 * Kullanıcı "baştan sona kendi başına bitir" dediğinde ajanı durduran şey
 * spec/plan onay kartları ve tur sonudur. Bu modül, hangi duraklamaların
 * otomatik geçileceğine karar verir.
 *
 * Güvenlik kapıları burada DEĞİLDİR: yazma/komut izinleri, komut risk
 * politikası ve yıkıcı komut engeli her seviyede aynı kalır. Otonomi yalnızca
 * *akış* duraklamalarını kaldırır.
 */
import { AutonomyLevel, UserSettings } from '../../shared/types';

/** Ayarlardan otonomi seviyesini okur; tanımsızsa güvenli varsayılan. */
export function autonomyLevel(settings: UserSettings): AutonomyLevel {
  const value = settings.autonomy;
  if (value === 'guided' || value === 'auto') return value;
  return 'manual';
}

/** Spec/plan onayı kullanıcıya sorulmadan geçilebilir mi? */
export function skipsApprovalGates(settings: UserSettings): boolean {
  return autonomyLevel(settings) !== 'manual';
}

/**
 * Sonsuz döngü koruması: otonom devam sayısı bu sınırı aşarsa ajan durur ve
 * neden durduğunu dürüstçe bildirir.
 */
export const MAX_AUTO_CONTINUATIONS = 12;

export interface ContinuationInput {
  level: AutonomyLevel;
  /** Bu görevde şimdiye kadar yapılan otomatik devam sayısı. */
  continuations: number;
  cancelled: boolean;
  /** İş akışı `done` aşamasına ulaştı mı? */
  finished: boolean;
  /** Onay bekleyen bir spec/plan var mı? */
  pendingApproval: boolean;
}

export type ContinuationDecision =
  | { action: 'continue'; reason: 'not-finished' }
  | {
      action: 'stop';
      reason: 'manual-mode' | 'cancelled' | 'finished' | 'pending-approval' | 'budget';
    };

/** Tur sonunda otomatik devam kararı. */
export function decideContinuation(input: ContinuationInput): ContinuationDecision {
  if (input.level !== 'auto') return { action: 'stop', reason: 'manual-mode' };
  if (input.cancelled) return { action: 'stop', reason: 'cancelled' };
  if (input.finished) return { action: 'stop', reason: 'finished' };
  if (input.pendingApproval) return { action: 'stop', reason: 'pending-approval' };
  if (input.continuations >= MAX_AUTO_CONTINUATIONS) return { action: 'stop', reason: 'budget' };
  return { action: 'continue', reason: 'not-finished' };
}
