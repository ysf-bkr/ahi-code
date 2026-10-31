/**
 * Model kimliğinden yetenek sınıfı çıkarma.
 *
 * Sağlayıcı kataloğundaki görsel, ses, OCR ve embedding modelleri normal kod
 * geliştirme hattının parçası değildir; yalnızca ilgili özellikler
 * (ekran görüntüsü, PDF, sesli komut, anlamsal arama) onları istediğinde
 * kullanılmalıdır. Kimlik tabanlı sınıflandırma, API metadata alanı
 * dönmeyen sağlayıcılar için de çalışır.
 */

export type ModelCapability = 'chat' | 'embedding' | 'rerank' | 'ocr' | 'asr' | 'tts' | 'vision' | 'image';

const CAPABILITY_PATTERNS: ReadonlyArray<{ capability: ModelCapability; pattern: RegExp }> = [
  { capability: 'embedding', pattern: /embed/i },
  { capability: 'rerank', pattern: /rerank/i },
  { capability: 'ocr', pattern: /(^|[-_./])ocr([-_./]|$)|paddleocr|doccing/i },
  { capability: 'asr', pattern: /(^|[-_./])asr([-_./]|$)|whisper|speech.?rec|transcri/i },
  { capability: 'tts', pattern: /(^|[-_./])tts([-_./]|$)|voxcpm|cosyvoice|speech.?synth|voice.?model/i },
  { capability: 'vision', pattern: /(^|[-_./])vl([-_./]|$)|vision|multimodal/i },
  {
    capability: 'image',
    pattern: /dall|stable.?diffusion|(^|[-_./])flux([-_./]|$)|midjourney|imagen|seedream/i
  }
];

/** Model kimliğinden yetenek sınıfı döndürür; eşleşme yoksa sohbet modeli. */
export function classifyModelCapability(modelId: string): ModelCapability {
  const id = String(modelId || '').trim();
  if (!id) return 'chat';
  for (const { capability, pattern } of CAPABILITY_PATTERNS) {
    if (pattern.test(id)) return capability;
  }
  return 'chat';
}

/** Sohbet/araç çağrısı yapabilen model mi? Embedding, OCR, ses vb. değildir. */
export function isConversationModel(modelId: string): boolean {
  return classifyModelCapability(modelId) === 'chat';
}
