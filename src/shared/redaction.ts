/**
 * Denetim günlüğü ve hata yüzeyleri için gizli bilgi maskeleme.
 *
 * Denetim günlüğü araç argümanlarını kaydeder, böylece görev sonradan
 * incelenebilir. Bu değerli olsa da `curl -H "Authorization: Bearer sk-..."`
 * gibi bir komut canlı bir kimlik bilgisini diske yazabilir. Komutun tamamını
 * atmak (denetim izini yok eder) yerine yalnızca gizli görünen kısımlar
 * maskelenir.
 */

const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Authorization başlıkları ve bearer tokenlar.
  { pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, replacement: '$1 [REDACTED]' },
  // Bilinen anahtar biçimleri.
  { pattern: /\bsk-[A-Za-z0-9_-]{12,}/g, replacement: '[REDACTED_KEY]' },
  { pattern: /\bghp_[A-Za-z0-9]{20,}/g, replacement: '[REDACTED_KEY]' },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, replacement: '[REDACTED_KEY]' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '[REDACTED_KEY]' },
  // `--token=değer`, `--api-key değer`, `password=değer` biçimli bayraklar.
  {
    pattern:
      /\b([\w-]*(?:api[-_]?key|token|secret|password|passwd|pwd|credential)[\w-]*)\s*[=:]\s*("[^"]*"|'[^']*'|\S+)/gi,
    replacement: '$1=[REDACTED]'
  },
  {
    pattern: /\b(--(?:api[-_]?key|token|secret|password|passwd|auth[-_]?token))\s+("[^"]*"|'[^']*'|\S+)/gi,
    replacement: '$1 [REDACTED]'
  }
];

/** Serbest metin içindeki kimlik bilgisi görünümlü parçaları maskeler. */
export function redactSecrets(value: string): string {
  let result = String(value ?? '');
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/** Denetim günlüğünde tamamen maskelenen, gövdesi büyük metin alanları. */
const BULK_TEXT_KEYS = /^(content|targetText|replacementText|newContent|oldContent|diff|patch)$/i;

/** Hassas anahtarları ve kimlik benzeri metinleri maskeleyen JSON dönüştürücüsü. */
export function redactForAudit(key: string, value: unknown): unknown {
  if (/key|token|secret|password|authorization|credential/i.test(key) && typeof value === 'string') {
    return '[REDACTED]';
  }
  // Dosya gövdeleri ve replacement metinleri denetim için gerekli değildir;
  // yalnızca varlıkları ve boyutları izlenir. Böylece içerikteki bilinen
  // desenlere uymayan kimlik bilgileri de diske yazılmaz.
  if (BULK_TEXT_KEYS.test(key) && typeof value === 'string') {
    return value.length > 0 ? `[REDACTED ${value.length} chars]` : '';
  }
  if (typeof value === 'string') {
    return redactSecrets(value);
  }
  return value;
}
