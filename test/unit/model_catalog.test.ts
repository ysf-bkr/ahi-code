import { describe, it, afterEach, beforeEach } from 'node:test';
import * as assert from 'node:assert';
import { fetchModelIds } from '../../src/webview/modelCatalog';

/** Yalıtılmış fetch stub'u: katalog mantığı ağ soketi olmadan hermetik sınanır. */
describe('modelCatalog: provider model listing', () => {
  const originalFetch = globalThis.fetch;
  const baseUrl = 'http://127.0.0.1:8080';
  const requests: Array<{ url: string; auth?: string }> = [];
  const routes: Record<string, unknown> = {
    '/api/tags': { models: [{ name: 'llama3.1' }, { name: 'qwen2.5' }] },
    '/v1/models': { data: [{ id: 'local-model' }] },
    '/models': { data: [{ id: 'compat-model' }] }
  };

  beforeEach(() => {
    requests.length = 0;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : (input as { toString(): string }).toString();
      const urlObj = new URL(urlStr);
      const headers = (init?.headers || {}) as Record<string, string>;
      const auth = headers.Authorization || headers.authorization;
      requests.push({ url: urlObj.pathname, auth });

      const payload = routes[urlObj.pathname];
      if (!payload) {
        return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('lists Ollama models from the server root even when /v1 is pasted', async () => {
    const models = await fetchModelIds({
      provider: 'ollama',
      baseUrl: `${baseUrl}/v1`,
      storedKeys: {}
    });
    assert.deepStrictEqual(models, ['llama3.1', 'qwen2.5']);
    assert.ok(requests.some((request) => request.url === '/api/tags'));
  });

  it('lists OpenAI-compatible models and sends the key', async () => {
    const models = await fetchModelIds({
      provider: 'openai-compatible',
      baseUrl,
      apiKey: 'sk-test',
      storedKeys: {}
    });
    assert.deepStrictEqual(models, ['compat-model']);
    assert.ok(requests.some((request) => request.auth === 'Bearer sk-test'));
  });

  it('treats a masked key as unchanged and falls back to the stored key', async () => {
    await fetchModelIds({
      provider: 'openai-compatible',
      baseUrl,
      apiKey: '••••••••',
      storedKeys: { openaiCompatible: 'stored-key' }
    });
    assert.ok(requests.some((request) => request.auth === 'Bearer stored-key'));
  });

  it('reports a provider failure instead of inventing model ids', async () => {
    await assert.rejects(() =>
      fetchModelIds({ provider: 'openai-compatible', baseUrl: `${baseUrl}/missing`, storedKeys: {} })
    );
  });

  it('returns no models for an unknown provider', async () => {
    assert.deepStrictEqual(await fetchModelIds({ provider: 'nope', storedKeys: {} }), []);
  });
});
