/**
 * Otomatik doğrulama için onarım döngüsü politikası.
 *
 * Ajan dosya değiştirdikten sonra test/lint çalıştırır. Başarısız olursa
 * sınırlı sayıda onarım talimatı ekleyebilir; bu modül sıradaki adıma
 * karar verir. `vscode` bağımsız ve saf tutulur; böylece karar tablosu
 * eklenti ana bilgisayarı olmadan test edilebilir.
 */

export interface RepairDecisionInput {
  /** Bu koşunun doğrulama sonucu. */
  status: 'passed' | 'failed' | 'skipped';
  /** Kaydedilmiş başlangıç durumunda olmayan hata imzaları. */
  newFailures: string[];
  /** Değişiklik öncesi başlangıç durumu var mı? */
  hasBaseline: boolean;
  /** Bu turda kullanılmış onarım denemesi sayısı. */
  attempts: number;
  /** Yapılandırılmış üst sınır. */
  maxAttempts: number;
}

export type RepairDecision =
  | { action: 'retry'; attempts: number; reason: 'new-failures' }
  | { action: 'abort'; reason: 'budget-exhausted' }
  | { action: 'proceed'; reason: 'passed' | 'skipped' | 'only-preexisting' };

/**
 * Görev başlamadan önce var olan hatalar ajanın sorumluluğunda değildir,
 * bu yüzden onarım bütçesini tüketmezler. Diğer her hata `maxAttempts`
 * kadar onarım turu alır.
 */
export function decideRepair(input: RepairDecisionInput): RepairDecision {
  if (input.status === 'skipped') {
    return { action: 'proceed', reason: 'skipped' };
  }
  if (input.status === 'passed') {
    return { action: 'proceed', reason: 'passed' };
  }

  const onlyPreexisting = input.hasBaseline && input.newFailures.length === 0;
  if (onlyPreexisting) {
    return { action: 'proceed', reason: 'only-preexisting' };
  }

  const maxAttempts = Math.max(0, input.maxAttempts);
  if (input.attempts < maxAttempts) {
    return { action: 'retry', attempts: input.attempts + 1, reason: 'new-failures' };
  }

  return { action: 'abort', reason: 'budget-exhausted' };
}
