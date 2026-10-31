export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Güvenlik kontrollerinde (yol hapsi, tehlikeli komutlar vb.) fırlatılır.
 * Mesaj metnini eşleştirmek yerine `instanceof SecurityError` kullanın;
 * mesajlar kullanıcıya gösterilmek üzere yazılır.
 */
export class SecurityError extends Error {
  public override readonly name = 'SecurityError';

  constructor(message: string) {
    super(message);
  }
}

export function isSecurityError(error: unknown): error is SecurityError {
  return error instanceof SecurityError;
}

export function errorMessage(error: unknown, fallback = 'Bilinmeyen hata'): string {
  const primary = extractMessage(error);
  if (!primary) return fallback;
  // Node fetch hataları asıl nedeni `cause` içinde tutar; AggregateError ise
  // `errors` dizisinde: "fetch failed" → "connect ECONNREFUSED ...".
  const nested = nestedError(error);
  const nestedMessage = nested ? extractMessage(nested) : '';
  return nestedMessage && nestedMessage !== primary ? `${primary} (neden: ${nestedMessage})` : primary;
}

function nestedError(value: unknown): unknown {
  if (value instanceof Error || isRecord(value)) {
    const record = value as { errors?: unknown; cause?: unknown };
    if (Array.isArray(record.errors) && record.errors.length > 0) return record.errors[0];
    return record.cause;
  }
  return undefined;
}

function extractMessage(value: unknown, depth = 0): string {
  if (depth > 4 || !value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Error || isRecord(value)) {
    const message = value instanceof Error ? value.message : undefined;
    if (message) return message;
    if (isRecord(value)) {
      const stderr = value.stderr;
      if (typeof stderr === 'string' && stderr.trim()) return stderr.trim();
    }
    const code = (value as { code?: unknown }).code;
    if (typeof code === 'string' && code) return code;
    // Mesajı boş sarmalayıcılarda (örn. AggregateError) iç hatayı incele.
    const nested = nestedError(value);
    return nested ? extractMessage(nested, depth + 1) : '';
  }
  return '';
}

export function errorCode(error: unknown): string | undefined {
  if (isRecord(error) && typeof error.code === 'string') return error.code;
  return undefined;
}
