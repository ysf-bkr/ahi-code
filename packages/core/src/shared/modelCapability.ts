/**
 * Model kimliğinden yetenek sınıfı çıkarma.
 *
 * Sağlayıcı kataloğundaki görsel, ses, OCR ve embedding modelleri normal kod
 * geliştirme hattının parçası değildir; yalnızca ilgili özellikler
 * (ekran görüntüsü, PDF, sesli komut, anlamsal arama) onları istediğinde
 * kullanılmalıdır. Kimlik tabanlı sınıflandırma, API metadata alanı
 * dönmeyen sağlayıcılar için de çalışır; sağlayıcı görev etiketi (task)
 * döndürüyorsa `capabilityFromTask` onu kimlik tahminine tercih eder.
 */

export type ModelCapability =
  | 'chat'
  | 'embedding'
  | 'rerank'
  | 'ocr'
  | 'asr'
  | 'tts'
  | 'vision'
  | 'image'
  | 'safety';

const CAPABILITY_PATTERNS: ReadonlyArray<{ capability: ModelCapability; pattern: RegExp }> = [
  { capability: 'embedding', pattern: /embed/i },
  { capability: 'rerank', pattern: /rerank/i },
  { capability: 'ocr', pattern: /(^|[-_./])ocr([-_./]|$)|paddleocr|doccing/i },
  { capability: 'asr', pattern: /(^|[-_./])asr([-_./]|$)|whisper|speech.?rec|transcri/i },
  { capability: 'tts', pattern: /(^|[-_./])tts([-_./]|$)|voxcpm|cosyvoice|speech.?synth|voice.?model/i },
  { capability: 'safety', pattern: /(^|[-_./])guard([-_./]|$)|moderat/i },
  { capability: 'vision', pattern: /(^|[-_./])vl([-_./]|$)|vision|multimodal/i },
  {
    capability: 'image',
    pattern: /dall|stable.?diffusion|(^|[-_./])flux([-_./]|$)|midjourney|imagen|seedream/i
  }
];

/**
 * Sağlayıcının görev etiketinden (EVREN `task` alanı: Sohbet, Karar, Gömme…)
 * yetenek sınıfı çıkarır. Türkçe/İngilizce etiketler ve Türkçe karakter
 * varyasyonları tanınır; bilinmeyen etikette undefined döner ve çağıran kimlik
 * tabanlı sınıflandırmaya düşer. Karar modelleri (clef, laya) sohbet
 * uç noktasından konuşulabildiği için chat sayılır.
 */
const TASK_PATTERNS: ReadonlyArray<{ capability: ModelCapability; pattern: RegExp }> = [
  { capability: 'embedding', pattern: /g[öo]mme|embed/i },
  { capability: 'rerank', pattern: /s[ıi]ralama|rerank/i },
  { capability: 'ocr', pattern: /ocr/i },
  { capability: 'asr', pattern: /ses yaz[ıi]ya|asr|transkri|transcri/i },
  { capability: 'tts', pattern: /metinden sese|tts|sentetik/i },
  { capability: 'image', pattern: /g[öo]rsel [üu]retim|image gen/i },
  { capability: 'vision', pattern: /g[öo]rsel|vision/i },
  { capability: 'safety', pattern: /g[üu]venlik|guard|safety|moderat/i },
  { capability: 'chat', pattern: /sohbet|chat|karar|decision|reason/i }
];

/** Görev etiketinden yetenek sınıfı; bilinmiyorsa undefined. */
export function capabilityFromTask(task: unknown): ModelCapability | undefined {
  const label = String(task ?? '').trim();
  if (!label) return undefined;
  for (const { capability, pattern } of TASK_PATTERNS) {
    if (pattern.test(label)) return capability;
  }
  return undefined;
}

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
