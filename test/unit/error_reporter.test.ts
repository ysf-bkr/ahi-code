import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  ErrorReporter,
  FINGERPRINT_MARKER,
  ERROR_REPORT_REPO,
  buildIssueBody,
  buildIssueTitle,
  fingerprintOf,
  normalizeErrorMessage,
  sanitizeForReport,
  type GitHubRunner
} from '@ahicode/core/feedback/errorReporter';

/** Basit bellek içi Memento karşılığı. */
function memoryStore() {
  const data = new Map<string, string[]>();
  return {
    get: (key: string) => data.get(key),
    update: async (key: string, value: string[]) => {
      data.set(key, value);
    },
    raw: data
  };
}

const context = { extensionVersion: '0.0.2', appHost: 'VS Code', platform: 'darwin' };

function makeReporter(options: {
  runner: GitHubRunner;
  enabled?: boolean;
  store?: ReturnType<typeof memoryStore>;
  onReported?: (url: string, fp: string) => void;
  now?: () => number;
}) {
  const store = options.store || memoryStore();
  const calls: string[][] = [];
  const reporter = new ErrorReporter({
    runGitHub: async (args) => {
      calls.push(args);
      return options.runner(args);
    },
    store,
    context,
    isEnabled: () => options.enabled !== false,
    onReported: options.onReported,
    now: options.now
  });
  return { reporter, calls, store };
}

describe('errorReporter: normalizasyon ve parmak izi', () => {
  it('yol, anahtar ve sayısal kimlikleri maskeler', () => {
    const normalized = normalizeErrorMessage(
      'ENOENT /Users/ybekar/Desktop/Projeler/ahi-code/src/a.ts sk-abcdefghijkl123 1699999999999'
    );
    assert.ok(normalized.includes('<yol>'), normalized);
    assert.ok(normalized.includes('<anahtar>'), normalized);
    assert.ok(normalized.includes('<sayi>'), normalized);
    assert.ok(!normalized.includes('ybekar'), 'kullanıcı adı kalmamalı');
    assert.ok(!normalized.includes('sk-abc'), 'anahtar kalmamalı');
  });

  it('aynı hatanın farklı yol/sayı içeren hâlleri aynı imzaya düşer', () => {
    const a = fingerprintOf('read ECONNRESET at /home/ali/proje/x.ts after 1000ms');
    const b = fingerprintOf('read ECONNRESET at /var/www/other/y.ts after 2500ms');
    assert.strictEqual(a, b);
  });

  it('arka plan öneki imzayı değiştirmez', () => {
    const plain = fingerprintOf('Model isteği başarısız');
    const bg = fingerprintOf('Arka plan: Model isteği başarısız');
    assert.strictEqual(plain, bg);
  });

  it('farklı hatalar farklı imza üretir', () => {
    assert.notStrictEqual(fingerprintOf('hata A'), fingerprintOf('hata B'));
  });

  it('e-posta, Bearer jetonu, AIza anahtarı ve URL sorgusunu maskeler', () => {
    const normalized = normalizeErrorMessage(
      'auth failed for ybekar@example.com with Bearer ya29.a0AfH6SMBx-key_abc AIzaSyD3nDummyKeyLongEnough12345 see https://api.example.com/v1/x?user=alice&token=s3cr3t'
    );
    assert.ok(normalized.includes('<e-posta>'), normalized);
    assert.ok(normalized.includes('<anahtar>'), normalized);
    assert.ok(normalized.includes('?<sorgu>'), normalized);
    assert.ok(
      !normalized.includes('example.com@') && !normalized.includes('ybekar@example'),
      'e-posta kalmamalı'
    );
    assert.ok(!normalized.includes('ya29'), 'Bearer jetonu kalmamalı');
    assert.ok(!normalized.includes('AIzaSy'), 'Google anahtarı kalmamalı');
    assert.ok(!normalized.includes('s3cr3t') && !normalized.includes('alice'), 'URL sorgusu kalmamalı');
  });

  it('sorgusuz URL sorgu maskesi almaz', () => {
    const normalized = normalizeErrorMessage('timeout at GET https://api.example.com/models');
    assert.ok(normalized.startsWith('timeout at get '), normalized);
    assert.ok(!normalized.includes('<sorgu>'), normalized);
  });
});

describe('errorReporter: içerik üretimi', () => {
  it('başlık uzun mesajı kırpar ve önek taşır', () => {
    const title = buildIssueTitle('a'.repeat(200));
    assert.ok(title.startsWith('[Otomatik Hata]'), title);
    assert.ok(title.length <= '[Otomatik Hata] '.length + 66 + 1);
  });

  it('gövde imza satırı ve maskelenmiş mesajı içerir', () => {
    const fp = fingerprintOf('api key sk-abcdefghijkl123 patladı');
    const body = buildIssueBody('api key sk-abcdefghijkl123 patladı', fp, context);
    assert.ok(body.includes(`${FINGERPRINT_MARKER}-${fp}`));
    assert.ok(body.includes('0.0.2'));
    assert.ok(!body.includes('sk-abcdefghijkl123'), 'anahtar gövdeye sızmamalı');
  });

  it('sanitizeForReport uzun metni sınırlar', () => {
    const out = sanitizeForReport('x'.repeat(5000), 100);
    assert.ok(out.length <= 101 + '…'.length);
    assert.ok(out.endsWith('…'));
  });
});

describe('errorReporter: akış ve mükerrer koruması', () => {
  it('ayar kapalıyken hiçbir gh çağrısı yapılmaz', async () => {
    const { reporter, calls } = makeReporter({ runner: async () => '', enabled: false });
    await reporter.report('bir hata');
    assert.strictEqual(calls.length, 0);
  });

  it('yeni hata arama + oluşturma yapar ve imzayı kaydeder', async () => {
    let reportedUrl = '';
    const { reporter, calls, store } = makeReporter({
      runner: async (args) => (args[1] === 'list' ? '' : 'https://github.com/x/issues/42'),
      onReported: (url) => {
        reportedUrl = url;
      }
    });
    await reporter.report('yeni tip çökme');
    assert.strictEqual(calls.length, 2, 'arama + oluşturma beklenir');
    assert.strictEqual(reportedUrl, 'https://github.com/x/issues/42');
    const createArgs = calls[1] || [];
    assert.ok(createArgs.includes(ERROR_REPORT_REPO));
    assert.ok(createArgs.includes('create'));
    assert.strictEqual((store.get('ahi_error_fingerprint') || []).length, 1);
  });

  it('GitHubda zaten varsa oluşturmaz ama imzayı hatırlar', async () => {
    const { reporter, calls, store } = makeReporter({
      runner: async (args) => (args[1] === 'list' ? '1\tOPEN\t[zaman]' : '')
    });
    await reporter.report('bilinen hata');
    const createCall = calls.find((c) => c.includes('create'));
    assert.strictEqual(createCall, undefined, 'mükerrer kayıt açılmamalı');
    assert.ok((store.get('ahi_error_fingerprint') || []).length === 1);
  });

  it('aynı imza ikinci kez yerelden geçmez (gh hiç çağrılmaz)', async () => {
    const store = memoryStore();
    const first = makeReporter({ store, runner: async (args) => (args[1] === 'list' ? '' : 'url') });
    await first.reporter.report('tekrar eden çökme');
    const callsAfterFirst = first.calls.length;

    const second = makeReporter({ store, runner: async () => '' });
    await second.reporter.report('tekrar eden çökme');
    assert.strictEqual(second.calls.length, 0, 'yerel imza kaydı gh’ı engellemeli');
    assert.ok(callsAfterFirst > 0);
  });

  it('gh yoksa (ENOENT) bir daha denemez', async () => {
    const { reporter, calls } = makeReporter({
      runner: async () => {
        throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
      }
    });
    await reporter.report('hata 1');
    await reporter.report('tamamen başka hata 2');
    assert.strictEqual(calls.length, 1, 'devre dışı bırakıldıktan sonra çağrı yok');
  });

  it('oturum bütçesi ve bekleme sınırı yeni hataları keser', async () => {
    let clock = 1_000_000;
    const { reporter, calls } = makeReporter({
      runner: async (args) => (args[1] === 'list' ? '' : 'url'),
      now: () => clock
    });
    // Bütçe 5; ilk gönderim sonra cooldown devreye girer.
    for (let i = 0; i < 10; i++) {
      await reporter.report(`farklı hata ${i} ${'benzersiz-' + i}`);
      clock += 120_000; // cooldown'u aş
    }
    const creates = calls.filter((c) => c.includes('create')).length;
    assert.ok(creates <= 5, `bütçe 5'i geçmemeli, görülen: ${creates}`);
    assert.ok(creates >= 1);
  });
});
