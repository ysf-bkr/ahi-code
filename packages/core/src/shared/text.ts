/**
 * Ajan döngüsü ve terminal çalıştırıcısının paylaştığı küçük metin yardımcıları.
 * `vscode` bağımsız tutulur; eklenti ana bilgisayarı olmadan test edilebilir.
 */

/** Modelin temiz metin okuması için ANSI kaçış dizilerini siler. */
export function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001B\[[0-9;?]*[A-Za-z]/g, '');
}

/**
 * Metni `maxChars` sınırında keser ve sonuna, kuyruğun sessizce kaybolmadığını
 * modele bildiren bir işaret ekler.
 */
export function limitWithMarker(
  value: string,
  maxChars: number,
  marker = '[... output truncated ...]'
): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n${marker}`;
}
