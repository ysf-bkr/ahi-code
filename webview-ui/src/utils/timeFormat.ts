/**
 * Kullanıcıya dönük tarih/saat ve boyut biçimlendirme yardımcıları.
 *
 * Değişiklikler ekranı "bu dosya ne zaman değişti?" sorusunu tek bakışta
 * yanıtlamalı: ham epoch yerine Türkçe, bağlamsal biçim ("Bugün 14:32").
 */

const DATE_FMT = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
const TIME_FMT = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' });

/** Epoch ms'den "Bugün 14:32" / "Dün 09:05" / "12 Haz 2026 14:32" üretir. */
export function formatDateTime(ms: number | undefined, now: number = Date.now()): string | undefined {
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return undefined;
  const date = new Date(ms);
  const today = new Date(now);
  const yesterday = new Date(now - 24 * 60 * 60 * 1000);
  const time = TIME_FMT.format(date);
  if (date.toDateString() === today.toDateString()) return `Bugün ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `Dün ${time}`;
  return `${DATE_FMT.format(date)} ${time}`;
}

/** Bayt sayısını insani boyuta çevirir (1,2 MB). */
export function formatBytes(bytes: number | undefined): string | undefined {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1).replace('.', ',')} ${units[unitIndex]}`;
}
