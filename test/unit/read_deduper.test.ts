import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { ReadDeduper } from '../../src/core/agent/readDeduper';
import { suggestedModelError } from '../../src/providers/openai';

describe('ReadDeduper: aynı dosyayı tekrar okuma döngüsünü keser', () => {
  const FILE = '/repo/src/main.ts';
  const T0 = 1_000;

  it('birebir aynı okuma değişmemiş dosyada gereksizdir', () => {
    const d = new ReadDeduper();
    d.record(FILE, undefined, undefined, T0);
    assert.strictEqual(d.isRedundant(FILE, undefined, undefined, T0), true);
  });

  it('dosya değiştiyse okuma her zaman tazelenir', () => {
    const d = new ReadDeduper();
    d.record(FILE, undefined, undefined, T0);
    assert.strictEqual(d.isRedundant(FILE, undefined, undefined, T0 + 1), false);
  });

  it('farklı offset/limit korumaya takılmaz', () => {
    const d = new ReadDeduper();
    d.record(FILE, undefined, undefined, T0);
    assert.strictEqual(d.isRedundant(FILE, 50, 100, T0), false);
    d.record(FILE, 50, 100, T0);
    assert.strictEqual(d.isRedundant(FILE, 50, 100, T0), true);
    assert.strictEqual(d.isRedundant(FILE, 51, 100, T0), false);
  });

  it('pencere dolunca en eski kayıt düşer; eski okuma yeniden çalışır', () => {
    const d = new ReadDeduper(2);
    d.record('/a.ts', undefined, undefined, T0);
    d.record('/b.ts', undefined, undefined, T0);
    d.record('/c.ts', undefined, undefined, T0); // /a.ts pencereden düştü
    assert.strictEqual(d.isRedundant('/a.ts', undefined, undefined, T0), false);
    assert.strictEqual(d.isRedundant('/c.ts', undefined, undefined, T0), true);
  });

  it('yazma/geçersiz kılma o dosyanın tüm aralıklarını düşürür', () => {
    const d = new ReadDeduper();
    d.record(FILE, undefined, undefined, T0);
    d.record(FILE, 10, 20, T0);
    d.invalidate(FILE);
    assert.strictEqual(d.isRedundant(FILE, undefined, undefined, T0), false);
    assert.strictEqual(d.isRedundant(FILE, 10, 20, T0), false);
  });

  it('Windows ayraçları tek anahtarda normalize olur', () => {
    const d = new ReadDeduper();
    d.record('C:\\repo\\src\\main.ts', undefined, undefined, T0);
    assert.strictEqual(d.isRedundant('C:/repo/src/main.ts', undefined, undefined, T0), true);
  });

  it('tekrar eden okuma aynı kaydı pencerede öne taşır', () => {
    const d = new ReadDeduper(2);
    d.record('/a.ts', undefined, undefined, T0);
    d.record('/b.ts', undefined, undefined, T0);
    d.record('/a.ts', undefined, undefined, T0); // /a öne çıkar
    d.record('/c.ts', undefined, undefined, T0); // sıra: [a, c]; /b düşer
    assert.strictEqual(d.isRedundant('/a.ts', undefined, undefined, T0), true);
    assert.strictEqual(d.isRedundant('/b.ts', undefined, undefined, T0), false);
  });

  it('stub notu dosya adını ve "yeniden okuma" yönlendirmesini içerir', () => {
    const note = ReadDeduper.duplicateNote(FILE, undefined, undefined);
    assert.ok(note.includes('Duplicate read skipped'));
    assert.ok(note.includes(FILE));
    assert.ok(note.includes('Do NOT read this file again'));
    const ranged = ReadDeduper.duplicateNote(FILE, 40, 25);
    assert.ok(ranged.includes('starting at 40'));
    assert.ok(ranged.includes('25 lines'));
  });
});

describe('suggestedModelError: 404 model_not_found kendiliğinden iyileştirme', () => {
  it('EVREN öneri alanından doğru kimliği okur', () => {
    const body =
      '{"error":{"message":"model bulunamadı: MiMo-V2.6-Pro","type":"invalid_request_error","code":"model_not_found","evren":{"suggested_models":["mimo-v2.6-pro"]}}}';
    assert.strictEqual(suggestedModelError(body), 'mimo-v2.6-pro');
  });

  it('öneri dizisi boşsa undefined döner', () => {
    const body =
      '{"error":{"message":"model bulunamadı: x","code":"model_not_found","evren":{"suggested_models":[]}}}';
    assert.strictEqual(suggestedModelError(body), undefined);
  });

  it('model dışı hatalar öneri saymaz', () => {
    assert.strictEqual(
      suggestedModelError('{"error":{"message":"invalid api key","code":"auth_error"}}'),
      undefined
    );
  });

  it('JSON olmayan gövdeler çökertmez', () => {
    assert.strictEqual(suggestedModelError('<html>502 Bad Gateway</html>'), undefined);
    assert.strictEqual(suggestedModelError(''), undefined);
  });
});
