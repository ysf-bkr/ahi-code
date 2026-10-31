/**
 * read_file tekrarlarını engelleyen küçük bekçi.
 *
 * Ölçülen sorun: ana ajan aynı dosyayı "okur → düşünür → aynı dosyayı yine
 * okur" döngüsüne giriyor; her tekrar bağlamı şişiriyor ve görevi
 * yavaşlatıyor. Bu modül, son birkaç araç çıktısı içinde birebir aynı okuma
 * (aynı dosya + aynı satır aralığı) yapılmış VE dosya o arada değişmemişse
 * ikinci okumayı içeriksiz bir notla değiştirir. Pencere, ContextManager'ın
 * sıkıştırmadan muaf tuttuğu son araç sonuçlarıyla (keepRecent) aynı
 * genişliktedir: "önceki sonuç hâlâ sohbette duruyor" notu böylece doğru kalır.
 *
 * Kayıtlar daima çözümlenmiş (mutlak, normalize) yollarla tutulur; okuma ve
 * yazma aynı çözümleyiciden geçtiği için anahtarlar çakışır. Dosya
 * değişim tarihi (mtime) asıl gardiyandır: yazma sonrası ilk okuma daima
 * taze çalışır.
 */

/** Bir araç çağrısının satır aralığı anahtar parçaları. */
function rangePart(value: unknown, fallback: string): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(Math.floor(value)) : fallback;
}

/** Anahtar yolu normalize eder (Windows ayraçları dahil tek biçim). */
function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

interface ReadRecord {
  key: string;
  mtimeMs: number;
}

export class ReadDeduper {
  private records: ReadRecord[] = [];

  /**
   * @param keepRecent Pencerede tutulan farklı okuma sayısı. ContextManager'ın
   * keepRecent değeriyle (=6) aynı tutulur ki stub notu atıf yaptığı çıktıya
   * gerçekten ulaşabilsin.
   */
  constructor(private readonly keepRecent = 6) {}

  /** Aynı okuma girişimini tanıyan anahtar: yol + offset + limit. */
  public static keyOf(filePath: string, offset?: unknown, limit?: unknown): string {
    return `${normalizePath(filePath)}::${rangePart(offset, '1')}::${rangePart(limit, 'all')}`;
  }

  /** Gerçekten çalışmış bir okumayı kaydeder; en eskiyi pencereden düşürür. */
  public record(filePath: string, offset: unknown, limit: unknown, mtimeMs: number): void {
    const key = ReadDeduper.keyOf(filePath, offset, limit);
    const existing = this.records.findIndex((r) => r.key === key);
    if (existing >= 0) this.records.splice(existing, 1);
    this.records.push({ key, mtimeMs });
    while (this.records.length > Math.max(1, this.keepRecent)) this.records.shift();
  }

  /**
   * Bu okuma gereksiz mi? Yalnızca pencerede BİREBİR aynı aralık varsa VE
   * dosya o zamandan beri değişmediyse evet. Başka aralıklar (offset/limit
   * farkı) her zaman çalışır — koruma muhafazakârdır.
   */
  public isRedundant(filePath: string, offset: unknown, limit: unknown, mtimeMs: number): boolean {
    const key = ReadDeduper.keyOf(filePath, offset, limit);
    const record = this.records.find((r) => r.key === key);
    return record !== undefined && record.mtimeMs === mtimeMs;
  }

  /** Dosya yazıldı/düzenlendi: o dosyanın tüm eski okuma kayıtları düşer. */
  public invalidate(filePath: string): void {
    const prefix = `${normalizePath(filePath)}::`;
    this.records = this.records.filter((r) => !r.key.startsWith(prefix));
  }

  /** Oturum/sohbet sıfırlanınca hafızayı temizle. */
  public reset(): void {
    this.records = [];
  }

  /** Modelin göreceği, içeriği tekrar göndermeyen kısa not. */
  public static duplicateNote(filePath: string, offset?: unknown, limit?: unknown): string {
    const range =
      typeof limit === 'number'
        ? `lines starting at ${rangePart(offset, '1')} (${Math.floor(limit)} lines)`
        : rangePart(offset, '1') === '1'
          ? 'the whole file'
          : `from line ${rangePart(offset, '1')}`;
    return (
      `[Duplicate read skipped] You already read "${normalizePath(filePath)}" (${range}) a few steps ago ` +
      `and the file has not changed since. Its full result is still in this conversation — reuse it. ` +
      `Do NOT read this file again unless you have edited it or you no longer have the content you need; ` +
      `if you truly need it again after several more steps, this same call will run normally.`
    );
  }
}
