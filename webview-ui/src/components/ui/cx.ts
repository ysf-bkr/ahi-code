/** Sınıf adlarını birleştirir; boş ve yanlış değerleri atar. */
export const cx = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(' ');
