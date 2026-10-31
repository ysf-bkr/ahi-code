/**
 * Tekrar çökmesi dedektörü (denetim m.1/2).
 *
 * Açık ağırlıklı modeller yer yer tek bir satıra ya da ifadeye kilitlenip
 * token bütçesi ölene kadar aynı birimi üretebiliyor (gerçek vaka: aynı
 * "file:open-temizle" kanal adı yüzlerce kez). Bu yardımcılar YALNIZCA metnin
 * SONUNA kadar süren tekrarları yakalar; çağıran taraf çöken kuyruğu atıp
 * sağlıklı ön eki olduğu gibi koruyabilir.
 */

/** Çökme sayılması için kuyruğun kaplaması gereken en az karakter sayısı. */
const MIN_COLLAPSE_CHARS = 300;
/** Aynı satır/ifade biriminin art arda en az kaç tekrarı çökme sayılır. */
const MIN_REPEAT_COUNT = 8;
/** İncenen en uzun kuyruk; denetim O(pencere) kalır, tüm metin taranmaz. */
const TAIL_WINDOW = 6_000;

export interface RepetitionCollapse {
  /** Çöken kuyruğun başladığı konum (sağlıklı ön ek uzunluğu). */
  cleanPrefixLength: number;
  /** Günlüklere yazılacak kısa tekrar birimi tanımı. */
  unit: string;
  /** Birimin art arda tekrar sayısı. */
  repeats: number;
}

/**
 * Metin tekrarlayan bir satır/ifade zincirinin İÇİNDE biterse çökme bilgisini,
 * aksi hâlde null döndürür. Eşikler bilinçli olarak muhafazakâr: normal düz
 * metin, markdown tabloları ve kod satır çizgileri mesajın tam sonunda 300+
 * karakterlik 8+ aynı birim dizisi oluşturmaz.
 */
export function findRepetitionCollapse(text: string): RepetitionCollapse | null {
  if (text.length < MIN_COLLAPSE_CHARS) return null;
  const base = Math.max(0, text.length - TAIL_WINDOW);
  const tail = text.slice(base);

  // 1) Tek karakter kaçışı (",,,,,,,", "____") — metnin sonuna kadar sürüyorsa.
  const charRun = tail.match(/(\S)\1{79,}$/);
  if (charRun && charRun.index !== undefined) {
    return {
      cleanPrefixLength: base + charRun.index,
      unit: `karakter: "${charRun[1]}"`,
      repeats: charRun[0].length
    };
  }

  // 2) Satır düzeyi çökme: 1–4 satırlık birim sona kadar art arda tekrarlanır.
  const lines = tail.split('\n');
  for (let unitLines = 1; unitLines <= 4; unitLines++) {
    if (lines.length < unitLines * 2) continue;
    const unit = lines.slice(-unitLines).join('\n').trim();
    if (!unit) continue;
    let repeats = 0;
    let pos = lines.length;
    while (pos - unitLines >= 0) {
      const candidate = lines
        .slice(pos - unitLines, pos)
        .join('\n')
        .trim();
      if (candidate !== unit) break;
      repeats++;
      pos -= unitLines;
    }
    if (repeats >= MIN_REPEAT_COUNT && unit.length * repeats >= MIN_COLLAPSE_CHARS) {
      const prefix = lines.slice(0, pos).join('\n');
      return {
        cleanPrefixLength: base + prefix.length + (prefix.length > 0 ? 1 : 0),
        unit: `satır: "${unit.slice(0, 60)}"`,
        repeats
      };
    }
  }

  // 3) İfade düzeyi çökme, tek satır içinde ("file:open file:open file:open…").
  const lastLineStart = tail.lastIndexOf('\n') + 1;
  const tokens = tail.slice(lastLineStart).split(/\s+/).filter(Boolean);
  for (let gram = 1; gram <= 6; gram++) {
    if (tokens.length < gram * 2) continue;
    const unit = tokens.slice(-gram).join(' ').toLowerCase();
    let repeats = 0;
    let pos = tokens.length;
    while (pos - gram >= 0) {
      const candidate = tokens
        .slice(pos - gram, pos)
        .join(' ')
        .toLowerCase();
      if (candidate !== unit) break;
      repeats++;
      pos -= gram;
    }
    if (repeats >= MIN_REPEAT_COUNT && unit.length * repeats >= MIN_COLLAPSE_CHARS) {
      const kept = tokens.slice(0, pos).join(' ');
      return {
        cleanPrefixLength: base + lastLineStart + kept.length + (kept.length > 0 ? 1 : 0),
        unit: `ifade: "${unit.slice(0, 60)}"`,
        repeats
      };
    }
  }
  return null;
}

/**
 * Akış bekçisi: her parçadan sonra BİRİKMİŞ metnin tamamıyla beslenir.
 * Denetim, biriken karakter sayısına göre kısıtlandığı için token token akan
 * sohbetlerde bile maliyeti sabit kalır.
 */
export class StreamRepetitionGuard {
  private lastCheckedLength = 0;

  check(accumulated: string): RepetitionCollapse | undefined {
    if (accumulated.length - this.lastCheckedLength < 200) return undefined;
    this.lastCheckedLength = accumulated.length;
    return findRepetitionCollapse(accumulated) ?? undefined;
  }
}

/**
 * Çöken kuyruğu atar, okunabilir ön eki korur; modele değil bekçiye kesildiği
 * kullanıcıdan gizlenmesin diye Türkçe bir not eklenir.
 */
export function collapseRepetition(text: string): string {
  const info = findRepetitionCollapse(text);
  if (!info) return text;
  const prefix = text.slice(0, info.cleanPrefixLength).trimEnd();
  return (
    prefix +
    '\n\n⚠️ Model aynı içeriği tekrarlamaya başladığı için akış burada kesildi. ' +
    'Yanıtın tekrarlayan kısmı atıldı; aynı mesajı yeniden göndererek kaldığı yerden devam ettirebilirsin.'
  );
}
