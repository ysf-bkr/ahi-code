import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  collapseRepetition,
  findRepetitionCollapse,
  StreamRepetitionGuard
} from '../../packages/core/src/shared/repetition';

/** Gerçek Mutabakat vakası: tek satırda aynı kanal adı yüzlerce kez. */
function tokenCollapse(prefix: string, unit: string, times: number): string {
  return `${prefix}\n${Array.from({ length: times }, () => unit).join(' ')}`;
}

describe('repetition: tekrar çökmesi dedektörü', () => {
  it('tek satırda aynı ifadenin sonsuz tekrarını yakalar ve temiz öneki verir', () => {
    const text = tokenCollapse('Dosyayı okudum, şu kanalları temizleyeceğim:', 'file:open-temizle', 60);
    const info = findRepetitionCollapse(text);
    assert.ok(info, 'çökme tespit edilmeliydi');
    assert.ok(info.cleanPrefixLength > 0 && info.cleanPrefixLength < text.length / 2);
    assert.match(info.unit, /file:open-temizle/);
  });

  it('aynı satırın tekrarını (satır düzeyi çökme) yakalar', () => {
    const line = '## Görev özeti: modülleri tek tek gözden geçir';
    const text = `İşe başlıyorum.\n${Array.from({ length: 12 }, () => line).join('\n')}`;
    const info = findRepetitionCollapse(text);
    assert.ok(info, 'satır çökmesi tespit edilmeliydi');
    assert.strictEqual(text.slice(0, info.cleanPrefixLength).startsWith('İşe başlıyorum.'), true);
  });

  it('tek karakter kaçışını (virgül seli) yakalar', () => {
    const text = `Rapor tamam: sistem çalışıyor.${','.repeat(400)}`;
    const info = findRepetitionCollapse(text);
    assert.ok(info);
    assert.strictEqual(text.slice(info.cleanPrefixLength).startsWith(','), true);
  });

  it('normal metinde yanlış pozitif vermez', () => {
    const normal = [
      '# Rapor',
      '',
      '| Sütun | Sütun |',
      '| ----- | ----- |',
      '| a | b |',
      '| a | b |',
      '| a | b |',
      '',
      'Testler geçti: 12 passed, 0 failed.',
      '```ts',
      'const a = 1;',
      'const a = 1;',
      'const a = 1;',
      'const a = 1;',
      'const a = 1;',
      'const a = 1;',
      'const a = 1;',
      'const a = 1;',
      '```'
    ].join('\n');
    assert.strictEqual(findRepetitionCollapse(normal), null, 'normal markdown çökme sayılmamalı');
    assert.strictEqual(findRepetitionCollapse('Kısa yanıt.'), null);
  });

  it('collapseRepetition kuyruğu atar, ön eki ve uyarıyı korur', () => {
    const text = tokenCollapse('Temiz açıklama satırı.', 'desperate', 80);
    const collapsed = collapseRepetition(text);
    assert.ok(collapsed.startsWith('Temiz açıklama satırı.'));
    assert.ok(collapsed.includes('tekrarlamaya başladığı için akış burada kesildi'));
    assert.ok(collapsed.length < text.length);
  });

  it('StreamRepetitionGuard birikimli metinde geç tetiklenir ama kaçırma​z', () => {
    const guard = new StreamRepetitionGuard();
    assert.strictEqual(guard.check('kısa'), undefined, '200 karakter birikmeden kontrol yok');
    const acc = tokenCollapse('Giriş metni burada.', 'kanal-x', 40);
    const info = guard.check(acc);
    assert.ok(info, 'eşik aşılınca çökme bulunmalı');
    assert.ok(info.repeats >= 8);
  });

  it('tek seferlik meşru tekrarlar (vurgu) çökme sayılmaz', () => {
    const text = `Hayır. Hayır. Hayır.` + ' '.repeat(400);
    assert.strictEqual(findRepetitionCollapse(text), null);
  });
});
