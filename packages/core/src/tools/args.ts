/** Araç tanımları için paylaşılan argüman yardımcıları. */
export function argString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return fallback;
  return String(value);
}

export function argBoolean(value: unknown): boolean {
  return value === true || value === 'true';
}

export function toPositiveInt(value: unknown, fallback: number): number {
  const parsed = parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
