import { ModelProvider, ProviderMessage, ModelCompletionResponse } from './base';
import type { ToolDefinition } from '../tools/base';
import { isRecord } from '../shared/errors';
import { buildRequestBody } from './openaiRequest';

interface OpenAIToolCall {
  id: string;
  type?: string;
  function: { name: string; arguments: string };
}

interface OpenAIChoiceMessage {
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
}

interface OpenAIChatResponse {
  choices?: Array<{ message?: OpenAIChoiceMessage }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    cache_read_input_tokens?: number;
  };
}

export interface OpenAICompatibleConfig {
  id: string;
  name: string;
  apiKey: string;
  baseURL: string;
  model: string;
  requiresApiKey?: boolean;
  /** `auto` yer tutucu model kimliğini reddet; yerel/kendi barındırılan sunucular somut model ister. */
  requiresConcreteModel?: boolean;
  extraHeaders?: Record<string, string>;
  /**
   * Sistem istemini önbelleklenebilir olarak işaretler. `cache_control`'ü yalnızca
   * Anthropic tarzı uç noktalar (Anthropic, OpenRouter) anlar; Ollama/
   * LM Studio/vLLM'e göndermek isteği bozabilir, bu yüzden varsayılan `none`.
   */
  promptCaching?: boolean;
  promptCachingStyle?: 'cache_control' | 'none';
  /** Akış sonunda sunucudan token kullanımı döndürmesini iste. */
  streamUsage?: boolean;
}

/** Başlıkları bekleme süresi; sonrasında vazgeçilir. */
const HEADER_TIMEOUT_MS = 120_000;
/** Akışın sessiz kalabileceği süre; sonrasında takılmış sayılır. */
const STREAM_STALL_TIMEOUT_MS = 120_000;
const MAX_ERROR_BODY_CHARS = 500;

/**
 * Sohbet ve model listesi uç noktaları yol ekini iki kez eklemesin diye
 * temel adresi sarmalar (örn. `http://host:11434/v1` + `/api/tags`).
 */
export function normalizeBaseUrl(baseURL: string, stripSuffixes: string[] = []): string {
  let value = String(baseURL || '')
    .trim()
    .replace(/\/+$/, '');
  for (const suffix of stripSuffixes) {
    if (value.toLowerCase().endsWith(suffix.toLowerCase())) {
      value = value.slice(0, -suffix.length).replace(/\/+$/, '');
    }
  }
  return value;
}

/** Üst kaynaktan gelen hata gövdesini kısaltır; tam HTML sayfası sohbeti doldurmasın. */
function summarizeErrorBody(text: string): string {
  const value = String(text || '').trim();
  if (!value) return '(empty response body)';
  if (value.length <= MAX_ERROR_BODY_CHARS) return value;
  return `${value.slice(0, MAX_ERROR_BODY_CHARS)}… [${value.length - MAX_ERROR_BODY_CHARS} chars omitted]`;
}

export class OpenAICompatibleProvider implements ModelProvider {
  public id: string;
  public name: string;
  protected apiKey: string;
  protected baseURL: string;
  protected model: string;
  protected requiresApiKey: boolean;
  protected requiresConcreteModel: boolean;
  protected extraHeaders: Record<string, string>;
  protected promptCaching: boolean;
  protected promptCachingStyle: 'cache_control' | 'none';
  protected streamUsage: boolean;

  constructor(config: OpenAICompatibleConfig) {
    this.id = config.id;
    this.name = config.name;
    this.apiKey = config.apiKey;
    this.baseURL = normalizeBaseUrl(config.baseURL, ['/chat/completions']);
    this.model = config.model;
    this.requiresApiKey = config.requiresApiKey ?? true;
    this.requiresConcreteModel = config.requiresConcreteModel ?? false;
    this.extraHeaders = config.extraHeaders || {};
    this.promptCaching = config.promptCaching ?? true;
    this.promptCachingStyle = config.promptCachingStyle ?? 'none';
    this.streamUsage = config.streamUsage ?? false;
  }

  /** Sunucuya gerçekten gönderilen model kimliği. */
  public getModel(): string {
    return this.model;
  }

  async sendMessage(
    messages: ProviderMessage[],
    tools: ToolDefinition[],
    onStreamChunk?: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<ModelCompletionResponse> {
    if (!this.apiKey && this.requiresApiKey) {
      throw new Error(`No API key provided for ${this.name}. Add your API key in the Settings panel.`);
    }
    if (this.requiresConcreteModel && (!this.model || this.model === 'auto')) {
      throw new Error(
        `${this.name} requires a concrete model id. Open Settings, load the model list and pick a model ` +
          '("auto" is only supported by OpenRouter).'
      );
    }

    const useStream = Boolean(onStreamChunk);
    const body = buildRequestBody({
      model: this.model,
      messages,
      tools,
      stream: useStream,
      streamUsage: this.streamUsage,
      // `cache_control` yalnızca Anthropic tarzı uç noktalarda anlaşılır.
      cacheSystemPrompt: this.promptCaching && this.promptCachingStyle === 'cache_control'
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.extraHeaders
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    /**
     * İsteğin tamamı için tek denetleyici.
     *
     * Önceki sürüm, başlıklar gelir gelmez kullanıcının iptal dinleyicisini
     * kaldırıyordu; bu yüzden akış sırasında iptal ve zaman aşımı çalışmıyor,
     * sessiz bir bağlantı görevi sonsuza kadar asabiliyordu. Artık denetleyici
     * kullanıcı sinyaline bağlı kalır ve her parçada takılma zamanlayıcısı yenilenir.
     */
    const controller = new AbortController();
    const onUserAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) throw new Error('Request cancelled by the user.');
      signal.addEventListener('abort', onUserAbort, { once: true });
    }

    let stallTimer: NodeJS.Timeout | undefined;
    let timedOut = false;
    const armStallTimer = (ms: number) => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, ms);
    };

    const wait = (ms: number) =>
      new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer);
          reject(new Error('Request cancelled by the user.'));
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
      });

    try {
      armStallTimer(HEADER_TIMEOUT_MS);
      let response: Response | undefined;
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        attempts++;
        if (signal?.aborted) {
          throw new Error('Request cancelled by the user.');
        }

        try {
          response = await fetch(`${this.baseURL}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: controller.signal
          });
        } catch (err) {
          if (signal?.aborted) {
            throw new Error('Request cancelled by the user.', { cause: err });
          }
          if (timedOut) {
            throw new Error(`Model request timed out (${Math.round(HEADER_TIMEOUT_MS / 1000)} sec).`, {
              cause: err
            });
          }
          if (attempts >= maxAttempts) throw err;
          await wait(1200 * attempts);
          continue;
        }

        if (response.ok) break;

        // Bazı OpenAI uyumlu sunucular bilinmeyen alanları reddeder. Sorun isteğe
        // bağlı `stream_options.include_usage` ise onu atıp bir kez yeniden dene,
        // tüm turu bozma.
        if (response.status === 400 && body.stream_options && attempts === 1) {
          delete body.stream_options;
          await response.body?.cancel().catch(() => {});
          attempts--;
          continue;
        }

        // 429 (hız sınırı) veya 500-504 (geçici sunucu hatası) durumunda yeniden dene
        const isTransient = response.status === 429 || (response.status >= 500 && response.status <= 504);
        if (isTransient && attempts < maxAttempts) {
          const retryAfterRaw = response.headers.get('retry-after');
          const retryAfterSec = retryAfterRaw !== null ? parseInt(retryAfterRaw, 10) : NaN;
          const backoffMs =
            Number.isFinite(retryAfterSec) && retryAfterSec >= 0
              ? Math.min(retryAfterSec * 1000, 30000)
              : Math.min(1000 * Math.pow(2, attempts) + Math.random() * 500, 8000);

          // Yeniden denemeden önce bağlantıyı bırak; gövdeyi açık tutma.
          await response.body?.cancel().catch(() => {});
          await wait(backoffMs);
          continue;
        }

        // 400/401/403/404 gibi kalıcı hatalar yeniden denenmeden bildirilir.
        const errText = summarizeErrorBody(await response.text());
        throw new Error(`API error [${response.status}]: ${errText}`);
      }

      if (!response || !response.ok) {
        throw new Error('Could not reach the model server.');
      }

      const contentType = response.headers.get('content-type') || '';
      const isSseResponse = contentType.includes('text/event-stream');

      if (!useStream || !response.body || !isSseResponse) {
        armStallTimer(HEADER_TIMEOUT_MS);
        // Akışsız yedek yol
        const rawData: unknown = await response.json();
        const data = isRecord(rawData) ? (rawData as OpenAIChatResponse) : {};
        const choice = Array.isArray(data.choices) ? data.choices[0] : undefined;
        const assistantMsg: OpenAIChoiceMessage = choice?.message || {};
        if (!choice) throw new Error('No valid response received from the model.');

        const text = typeof assistantMsg.content === 'string' ? assistantMsg.content : '';
        if (onStreamChunk && text) onStreamChunk(text);

        const toolCalls = assistantMsg.tool_calls?.map((tc) => {
          let parsedArgs: Record<string, unknown>;
          try {
            const parsed: unknown = JSON.parse(tc.function.arguments || '{}');
            parsedArgs = isRecord(parsed) ? parsed : { raw: tc.function.arguments };
          } catch {
            parsedArgs = { raw: tc.function.arguments };
          }
          return { id: tc.id, name: tc.function.name, arguments: parsedArgs };
        });

        return {
          text,
          toolCalls,
          usage: data.usage
            ? {
                promptTokens: data.usage.prompt_tokens || 0,
                completionTokens: data.usage.completion_tokens || 0,
                totalTokens: data.usage.total_tokens || 0,
                cachedTokens:
                  data.usage.prompt_tokens_details?.cached_tokens ??
                  data.usage.cache_read_input_tokens ??
                  undefined
              }
            : undefined
        };
      }

      // SSE akış okuyucusu
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let fullText = '';
      let streamUsage: ModelCompletionResponse['usage'];
      let streamDone = false;
      const toolCallsMap: Map<number, { id: string; name: string; argumentsStr: string }> = new Map();

      const handleEvent = (rawLine: string) => {
        const trimmed = rawLine.trim();
        if (!trimmed || !trimmed.startsWith('data:')) return;
        const dataStr = trimmed.replace(/^data:\s*/, '');
        if (dataStr === '[DONE]') {
          streamDone = true;
          return;
        }

        try {
          const parsed = JSON.parse(dataStr) as {
            usage?: OpenAIChatResponse['usage'];
            choices?: Array<{
              delta?: {
                content?: string;
                tool_calls?: Array<{
                  index?: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
            }>;
          };

          if (parsed.usage) {
            streamUsage = {
              promptTokens: parsed.usage.prompt_tokens ?? 0,
              completionTokens: parsed.usage.completion_tokens ?? 0,
              totalTokens:
                parsed.usage.total_tokens ??
                (parsed.usage.prompt_tokens ?? 0) + (parsed.usage.completion_tokens ?? 0),
              cachedTokens:
                parsed.usage.prompt_tokens_details?.cached_tokens ??
                parsed.usage.cache_read_input_tokens ??
                undefined
            };
          }

          const delta = parsed.choices?.[0]?.delta;
          if (!delta) return;

          if (delta.content) {
            fullText += delta.content;
            if (onStreamChunk) {
              onStreamChunk(delta.content);
            }
          }

          if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const index = tc.index ?? 0;
              const existing = toolCallsMap.get(index) || {
                id: tc.id || `call_${Date.now()}_${index}`,
                name: '',
                argumentsStr: ''
              };

              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) {
                const incoming = tc.function.name;
                if (!existing.name) {
                  existing.name = incoming;
                } else if (incoming.startsWith(existing.name)) {
                  // Bazı sağlayıcılar tam adı her parçada yeniden gönderir.
                  existing.name = incoming;
                } else if (!existing.name.endsWith(incoming)) {
                  // OpenAI'ın artımlı ad akışı.
                  existing.name += incoming;
                }
              }
              if (tc.function?.arguments) existing.argumentsStr += tc.function.arguments;

              toolCallsMap.set(index, existing);
            }
          }
        } catch {
          // tamamlanmamış SSE json parçasını yok say
        }
      };

      while (!streamDone) {
        if (signal?.aborted) {
          await reader.cancel().catch(() => {});
          throw new Error('Request cancelled by the user.');
        }
        armStallTimer(STREAM_STALL_TIMEOUT_MS);

        let chunk: Awaited<ReturnType<typeof reader.read>>;
        try {
          chunk = await reader.read();
        } catch (err) {
          if (signal?.aborted) {
            throw new Error('Request cancelled by the user.', { cause: err });
          }
          if (timedOut) {
            throw new Error(
              `Model stream stalled for ${Math.round(STREAM_STALL_TIMEOUT_MS / 1000)} sec; the request was stopped.`,
              { cause: err }
            );
          }
          throw err;
        }

        if (chunk.done) break;

        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) handleEvent(line);
      }

      // Çözücüyü boşalt ve satır sonuyla bitmemiş son olayı işle; aksi hâlde
      // metnin veya araç argümanlarının son parçası kaybolur.
      buffer += decoder.decode();
      if (buffer.trim()) handleEvent(buffer);
      buffer = '';

      const finalToolCalls = Array.from(toolCallsMap.values())
        .filter((tc) => tc.name.trim().length > 0)
        .map((tc) => {
          let args: Record<string, unknown>;
          try {
            args = JSON.parse(tc.argumentsStr || '{}') as Record<string, unknown>;
          } catch {
            args = { raw: tc.argumentsStr };
          }
          return {
            id: tc.id,
            name: tc.name,
            arguments: args
          };
        });

      return {
        text: fullText,
        toolCalls: finalToolCalls.length > 0 ? finalToolCalls : undefined,
        usage: streamUsage
      };
    } finally {
      if (stallTimer) clearTimeout(stallTimer);
      signal?.removeEventListener('abort', onUserAbort);
    }
  }
}
