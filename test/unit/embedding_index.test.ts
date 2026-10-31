import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { cosineSimilarity, EmbeddingIndex } from '@ahicode/core/core/knowledge/EmbeddingIndex';

describe('EmbeddingIndex: cosine similarity', () => {
  it('returns 1 with eigenvectors, 0 with orthogonal vectors', () => {
    assert.ok(Math.abs(cosineSimilarity([1, 0], [1, 0]) - 1) < 1e-9);
    assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-9);
    assert.ok(Math.abs(cosineSimilarity([1, 2, 3], [2, 4, 6]) - 1) < 1e-9);
  });

  it('returns 0 with empty or mismatched vectors', () => {
    assert.strictEqual(cosineSimilarity([], []), 0);
    assert.strictEqual(cosineSimilarity([1], [1, 2]), 0);
    assert.strictEqual(cosineSimilarity([0, 0], [1, 1]), 0);
  });
});

describe('EmbeddingIndex: local ranking and persistence', () => {
  let dir: string;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-embed-'));
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  /** Deterministik sahte embedding: ilk koordinat metni kodlar. */
  const fakeEmbed = async (texts: string[]): Promise<number[][] | undefined> =>
    texts.map((text) => {
      const vector = [0, 0, 0];
      if (text.includes('ödeme')) vector[0] = 1;
      if (text.includes('kimlik doğrulama')) vector[1] = 1;
      if (text.includes('token')) vector[2] = 1;
      return vector;
    });

  const corpus = [
    { key: 'file:payment.ts', text: 'ödeme akışı işlemleri', hash: 'h1' },
    { key: 'file:auth.ts', text: 'kimlik doğrulama katmanı', hash: 'h2' },
    { key: 'human:notes', text: 'token saklama kararı', hash: 'h3' }
  ];

  it('ranks by semantic nearest input', async () => {
    const index = new EmbeddingIndex({ baseUrl: 'http://unused.local', model: 'test', embedFn: fakeEmbed });
    const ranked = await index.rank('ödeme akışı nasıl çalışır', corpus, { dir });
    assert.ok(ranked, 'ranking should return');
    assert.strictEqual(ranked[0]?.key, 'file:payment.ts');
    assert.ok((ranked[0]?.score ?? 0) > 0.5);
    // İlgisiz eksenler benzerlik eşiği tarafından elenir.
    assert.ok(ranked.every((match) => corpus.some((entry) => entry.key === match.key)));
  });

  it('vectors cached and reloaded by content', async () => {
    let embedCalls = 0;
    const countingEmbed = async (texts: string[]): Promise<number[][] | undefined> => {
      embedCalls += texts.length;
      return fakeEmbed(texts);
    };

    const first = new EmbeddingIndex({
      baseUrl: 'http://unused.local',
      model: 'test',
      embedFn: countingEmbed
    });
    await first.rank('kimlik doğrulama', corpus, { dir });
    const embeddedCount = embedCalls;

    // Yeni örnek kalıcı vektörleri yükler: yalnızca sorgu embedding'lenir.
    const second = new EmbeddingIndex({
      baseUrl: 'http://unused.local',
      model: 'test',
      embedFn: countingEmbed
    });
    const ranked = await second.rank('kimlik doğrulama', corpus, { dir });
    assert.ok(ranked);
    assert.strictEqual(ranked[0]?.key, 'file:auth.ts');
    assert.strictEqual(embedCalls, embeddedCount + 1, 'only query should be embedded');

    // Önbellek dosyası vardır ve herkes tarafından okunabilir değildir.
    const stat = await fs.stat(path.join(dir, 'embeddings.jsonl'));
    assert.strictEqual(stat.mode & 0o077, 0);
  });

  it('re-embeds relevant input when hash changes', async () => {
    const index = new EmbeddingIndex({ baseUrl: 'http://unused.local', model: 'test', embedFn: fakeEmbed });
    await index.rank('ödeme', corpus, { dir });
    const ranked = await index.rank(
      'ödeme',
      [{ key: 'file:payment.ts', text: 'ödeme ve iade işlemleri', hash: 'h1-changed' }, ...corpus.slice(1)],
      { dir }
    );
    assert.ok(ranked);
    assert.strictEqual(ranked[0]?.key, 'file:payment.ts');
  });

  it('returns undefined when embedding service does not respond (fallback search kicks in)', async () => {
    const index = new EmbeddingIndex({
      baseUrl: 'http://unused.local',
      model: 'test',
      embedFn: async () => undefined
    });
    const ranked = await index.rank('ödeme', corpus, { dir });
    assert.strictEqual(ranked, undefined);
  });
});

describe('EmbeddingIndex: uç nokta güvenlik bekçisi', () => {
  const originalFetch = globalThis.fetch;

  after(() => {
    globalThis.fetch = originalFetch;
  });

  /** fetch'i sayar ve sahte embedding döndürür. */
  function stubFetch(): { calls: string[] } {
    const calls: string[] = [];
    globalThis.fetch = (async (input: unknown) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ data: [{ embedding: [1, 2, 3] }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as typeof fetch;
    return { calls };
  }

  const corpus = [{ key: 'a', text: 'ödeme akışı', hash: 'h1' }];

  it('gizli anahtar giden açık HTTP uç noktasına istek atmaz', async () => {
    const { calls } = stubFetch();
    const index = new EmbeddingIndex({
      baseUrl: 'http://attacker.example/v1',
      model: 'qwen3-embedding-8b',
      style: 'openai',
      apiKey: 'sk-secret'
    });
    const ranked = await index.rank('ödeme', corpus);
    assert.strictEqual(ranked, undefined, 'güvensiz uç nokta sessizce devre dışı kalmalı');
    assert.deepStrictEqual(calls, [], 'anahtar asla düz HTTP ile gönderilmemeli');
  });

  it('hassas olmayan (link-local/meta) adresleri de reddeder', async () => {
    const { calls } = stubFetch();
    const index = new EmbeddingIndex({
      baseUrl: 'https://169.254.169.254/latest',
      model: 'qwen3-embedding-8b',
      style: 'openai',
      apiKey: 'sk-secret'
    });
    const ranked = await index.rank('ödeme', corpus);
    assert.strictEqual(ranked, undefined);
    assert.deepStrictEqual(calls, []);
  });

  it('yerel loopback HTTP sunucusuna izin verir (LM Studio gibi)', async () => {
    const { calls } = stubFetch();
    const index = new EmbeddingIndex({
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'local-embed',
      style: 'openai',
      apiKey: 'local'
    });
    const ranked = await index.rank('ödeme', corpus);
    assert.ok(ranked, 'loopback uç nokta çalışmalı');
    assert.match(calls[0] ?? '', /^http:\/\/127\.0\.0\.1:1234\/v1\/embeddings$/);
  });

  it('genel HTTPS adresine DNS denetiminden sonra gider', async () => {
    const { calls } = stubFetch();
    const index = new EmbeddingIndex({
      baseUrl: 'https://8.8.8.8/v1',
      model: 'remote-embed',
      style: 'openai',
      apiKey: 'sk-secret'
    });
    const ranked = await index.rank('ödeme', corpus);
    assert.ok(ranked, 'genel IP + HTTPS engellenmemeli');
    // İki istek doğaldır: bir kayıt kümesi gömülür, sonra sorgu gömülür.
    assert.strictEqual(calls.length, 2);
  });
});
