/**
 * Ajanın kullanıcı mesajına editör bağlamı eklerken kullandığı işaretler.
 *
 * Yeniden deneme kullanıcının kendi sözlerini göndermeli, önceki editör
 * anlık görüntüsünü değil: dosyalar bu arada değişmiş olabilir, bu yüzden
 * bağlam kopyalanmak yerine güncel durumdan yeniden kurulur.
 */
export const EDITOR_CONTEXT_MARKERS = [
  '\n\n[Referenced File Context (@',
  '\n\n[Selected Code in Active Editor (',
  '\n\n[Active File]: '
] as const;

/** Saklanan kullanıcı mesajından ajanın eklediği editör bağlamını temizler. */
export function stripInjectedContext(content: string): string {
  const value = String(content || '');
  let cutIndex = -1;
  for (const marker of EDITOR_CONTEXT_MARKERS) {
    const index = value.indexOf(marker);
    if (index >= 0 && (cutIndex === -1 || index < cutIndex)) {
      cutIndex = index;
    }
  }
  return (cutIndex === -1 ? value : value.slice(0, cutIndex)).trim();
}
