import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import { normalizeBaseUrl, OpenAICompatibleProvider } from '../../src/providers/openai';
import { createModelProvider } from '../../src/providers';
import { UserSettings } from '../../src/shared/types';

const originalFetch = globalThis.fetch;
let calls = 0;

function provider() {
  return new OpenAICompatibleProvider({
    id: 'test',
    name: 'Test Provider',
    apiKey: 'test-key',
    baseURL: 'https://example.test/v1',
    model: 'test-model'
  });
}

function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

function sseResponse(lines: string[]) {
  return new Response(lines.join('\n') + '\n', {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' }
  });
}

describe('OpenAICompatibleProvider', () => {
  beforeEach(() => {
    calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw new Error('Test fetch stub ayarlanmadı');
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('does not retry permanent errors such as HTTP 400', async () => {
    globalThis.fetch = (async () => {
      calls++;
      return jsonResponse({ error: 'bad request' }, 400);
    }) as typeof fetch;

    await assert.rejects(
      () => provider().sendMessage([{ role: 'user', content: 'merhaba' }], []),
      /API error \[400\]/
    );
    assert.strictEqual(calls, 1);
  });

  it('retries after 429 and returns successful response', async () => {
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) {
        return jsonResponse({ error: 'rate limited' }, 429, { 'Retry-After': '0' });
      }
      return jsonResponse({
        choices: [{ message: { content: 'tamam' } }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }
      });
    }) as typeof fetch;

    const res = await provider().sendMessage([{ role: 'user', content: 'merhaba' }], []);
    assert.strictEqual(res.text, 'tamam');
    assert.strictEqual(res.usage?.totalTokens, 3);
    assert.strictEqual(calls, 2);
  });

  it('merges SSE stream text, tool call arguments and usage info', async () => {
    globalThis.fetch = (async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"Mer"}}]}',
        'data: {"choices":[{"delta":{"content":"haba"}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_","arguments":"{\\"pa"}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"file","arguments":"th\\":\\"a.ts\\"}"}}]}}]}',
        'data: {"usage":{"prompt_tokens":4,"completion_tokens":5,"total_tokens":9}}',
        'data: [DONE]'
      ])) as typeof fetch;

    const chunks: string[] = [];
    const res = await provider().sendMessage([{ role: 'user', content: 'oku' }], [], (chunk) =>
      chunks.push(chunk)
    );

    assert.strictEqual(res.text, 'Merhaba');
    assert.deepStrictEqual(chunks, ['Mer', 'haba']);
    assert.strictEqual(res.toolCalls?.length, 1);
    assert.strictEqual(res.toolCalls?.[0]?.name, 'read_file');
    assert.deepStrictEqual(res.toolCalls?.[0]?.arguments, { path: 'a.ts' });
    assert.strictEqual(res.usage?.totalTokens, 9);
  });

  it('does not duplicate a tool name repeated in every chunk', async () => {
    globalThis.fetch = (async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_2","function":{"name":"read_file","arguments":"{}"}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"read_file","arguments":""}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"read_file","arguments":""}}]}}]}',
        'data: [DONE]'
      ])) as typeof fetch;

    const res = await provider().sendMessage([{ role: 'user', content: 'oku' }], [], () => {});
    assert.strictEqual(res.toolCalls?.[0]?.name, 'read_file');
  });

  it('reports a missing API key without sending a request', async () => {
    const p = new OpenAICompatibleProvider({
      id: 'openrouter',
      name: 'OpenRouter',
      apiKey: '',
      baseURL: 'https://example.test/v1',
      model: 'm'
    });
    await assert.rejects(() => p.sendMessage([{ role: 'user', content: 'x' }], []), /No API key/);
    assert.strictEqual(calls, 0);
  });

  it('supports an OpenAI-compatible endpoint without an API key', async () => {
    let requestUrl = '';
    let requestHeaders = new Headers();
    globalThis.fetch = (async (input, init) => {
      calls++;
      requestUrl = String(input);
      requestHeaders = new Headers(init?.headers);
      return jsonResponse({ choices: [{ message: { content: 'local response' } }] });
    }) as typeof fetch;

    const settings: UserSettings = {
      selectedProvider: 'openai-compatible',
      selectedModel: 'local-model',
      apiKeys: {},
      openAiCompatibleBaseUrl: 'http://localhost:1234/v1',
      autoApprove: { readFiles: true, writeFiles: false, executeCommands: false }
    };
    const response = await createModelProvider(settings).sendMessage(
      [{ role: 'user', content: 'hello' }],
      []
    );

    assert.strictEqual(response.text, 'local response');
    assert.strictEqual(requestUrl, 'http://localhost:1234/v1/chat/completions');
    assert.strictEqual(requestHeaders.has('authorization'), false);
  });

  it('sends the configured API key to the OpenAI-compatible endpoint', async () => {
    let requestHeaders = new Headers();
    globalThis.fetch = (async (_input, init) => {
      requestHeaders = new Headers(init?.headers);
      return jsonResponse({ choices: [{ message: { content: 'remote response' } }] });
    }) as typeof fetch;

    const settings: UserSettings = {
      selectedProvider: 'openai-compatible',
      selectedModel: 'hosted-model',
      apiKeys: { openaiCompatible: 'test-compatible-key' },
      openAiCompatibleBaseUrl: 'https://models.example.test/v1',
      autoApprove: { readFiles: true, writeFiles: false, executeCommands: false }
    };
    await createModelProvider(settings).sendMessage([{ role: 'user', content: 'hello' }], []);

    assert.strictEqual(requestHeaders.get('authorization'), 'Bearer test-compatible-key');
  });
});

describe('OpenAICompatibleProvider: prompt caching', () => {
  function captureBody(): { get: () => Record<string, unknown> } {
    let captured: Record<string, unknown> = {};
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      captured = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }) as typeof fetch;
    return { get: () => captured };
  }

  it('marks the system message with cache_control on Anthropic-style endpoints', async () => {
    const capture = captureBody();
    const provider = new OpenAICompatibleProvider({
      id: 'test',
      name: 'Test',
      apiKey: 'k',
      baseURL: 'http://localhost:1/v1',
      model: 'm',
      promptCachingStyle: 'cache_control'
    });

    await provider.sendMessage(
      [
        { role: 'system', content: 'uzun sistem prompt' },
        { role: 'user', content: 'merhaba' }
      ],
      []
    );

    const messages = capture.get().messages as Array<Record<string, unknown>>;
    const first = messages[0];
    const content = first?.content as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(content), 'sistem mesajı blok dizisi olmalı');
    assert.deepStrictEqual(content[0]?.cache_control, { type: 'ephemeral' });
    assert.strictEqual(content[0]?.text, 'uzun sistem prompt');
  });

  it('sends plain text by default on local endpoints', async () => {
    // Ollama/LM Studio/vLLM content-block biçimini reddeder; `cache_control`
    // varsayılan değil, sağlayıcı başına açıkça tercih edilmeli.
    const capture = captureBody();
    const provider = new OpenAICompatibleProvider({
      id: 'ollama',
      name: 'Yerel',
      apiKey: 'k',
      baseURL: 'http://localhost:11434/v1',
      model: 'llama3.1'
    });

    await provider.sendMessage(
      [
        { role: 'system', content: 'sistem' },
        { role: 'user', content: 'x' }
      ],
      []
    );
    const messages = capture.get().messages as Array<Record<string, unknown>>;
    assert.strictEqual(messages[0]?.content, 'sistem');
  });

  it('sends plain text when promptCaching is disabled', async () => {
    const capture = captureBody();
    const provider = new OpenAICompatibleProvider({
      id: 'test',
      name: 'Test',
      apiKey: 'k',
      baseURL: 'http://localhost:1/v1',
      model: 'm',
      promptCaching: false,
      promptCachingStyle: 'cache_control'
    });

    await provider.sendMessage(
      [
        { role: 'system', content: 'sistem' },
        { role: 'user', content: 'x' }
      ],
      []
    );
    const messages = capture.get().messages as Array<Record<string, unknown>>;
    assert.strictEqual(messages[0]?.content, 'sistem');
  });

  it('reads cache token count from usage', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'ok' } }],
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 10,
            total_tokens: 1010,
            prompt_tokens_details: { cached_tokens: 800 }
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )) as typeof fetch;

    const provider = new OpenAICompatibleProvider({
      id: 'test',
      name: 'Test',
      apiKey: 'k',
      baseURL: 'http://localhost:1/v1',
      model: 'm'
    });
    const response = await provider.sendMessage([{ role: 'user', content: 'x' }], []);
    assert.strictEqual(response.usage?.cachedTokens, 800);
  });
});

describe('OpenAICompatibleProvider: provider contracts', () => {
  it('does not repeat /v1 suffix on Ollama address', () => {
    assert.strictEqual(normalizeBaseUrl('http://localhost:11434', ['/v1']), 'http://localhost:11434');
    assert.strictEqual(normalizeBaseUrl('http://localhost:11434/', ['/v1']), 'http://localhost:11434');
    assert.strictEqual(normalizeBaseUrl('http://localhost:11434/v1', ['/v1']), 'http://localhost:11434');
    assert.strictEqual(normalizeBaseUrl('http://localhost:11434/v1/', ['/v1']), 'http://localhost:11434');
  });

  it('provider requiring concrete model gives descriptive error with auto', async () => {
    const provider = new OpenAICompatibleProvider({
      id: 'ollama',
      name: 'Yerel',
      apiKey: 'k',
      baseURL: 'http://localhost:11434/v1',
      model: 'auto',
      requiresConcreteModel: true
    });

    await assert.rejects(provider.sendMessage([{ role: 'user', content: 'x' }], []), /concrete model id/i);
  });

  it('removes field and retries if stream_options rejected', async () => {
    let attempts = 0;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      attempts++;
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      if (body.stream_options) {
        return new Response('unsupported stream_options', { status: 400 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }) as typeof fetch;

    const provider = new OpenAICompatibleProvider({
      id: 'test',
      name: 'Test',
      apiKey: 'k',
      baseURL: 'http://localhost:1/v1',
      model: 'm',
      streamUsage: true
    });

    const response = await provider.sendMessage([{ role: 'user', content: 'x' }], [], () => {});
    assert.strictEqual(attempts, 2, 'once with stream_options, once without');
    assert.strictEqual(response.text, 'ok');
  });
});
