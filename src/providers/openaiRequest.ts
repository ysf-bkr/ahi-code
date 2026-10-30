/**
 * OpenAI uyumlu sağlayıcının istek gövdesini kuran saf yardımcılar.
 *
 * Ağ, zaman aşımı ve akış mantığı `openai.ts` içinde kalır; burada yalnızca
 * mesaj/araç biçimlendirmesi yapılır. Böylece gövde kurulumu tek başına test
 * edilebilir.
 */
import type { ProviderMessage } from './base';
import type { ToolDefinition } from '../tools/base';

/** Sağlayıcıya gönderilen içerik: düz metin ya da önbellek blokları. */
export interface CacheableContentBlock {
  type: 'text';
  text: string;
  cache_control: { type: 'ephemeral' };
}

export interface OpenAIRequestMessage {
  role: string;
  content: string | null | CacheableContentBlock[];
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

export interface OpenAIRequestTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: ToolDefinition['parameters'];
  };
}

/** Araç tanımlarını istek biçimine çevirir. */
function formatTools(tools: ToolDefinition[]): OpenAIRequestTool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));
}

/**
 * Sohbet geçmişini sağlayıcı mesajlarına çevirir.
 *
 * Araç çağrısı olan asistan mesajlarında `content` boşsa `null` gönderilir;
 * bazı sunucular boş dizeyi reddeder.
 */
function formatMessages(messages: ProviderMessage[]): OpenAIRequestMessage[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: message.content
      };
    }

    if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function' as const,
          function: {
            name: call.name,
            arguments: JSON.stringify(call.arguments)
          }
        }))
      };
    }

    return { role: message.role, content: message.content };
  });
}

/**
 * İlk sistem mesajını önbelleklenebilir işaretler.
 *
 * `cache_control` yalnızca Anthropic tarzı uç noktalarda anlamlıdır; çağıran
 * bunu kontrol eder.
 */
function markSystemPromptCacheable(messages: OpenAIRequestMessage[]): void {
  const first = messages[0];
  if (!first || first.role !== 'system') return;
  if (typeof first.content !== 'string') return;

  first.content = [{ type: 'text', text: first.content, cache_control: { type: 'ephemeral' } }];
}

export interface BuildBodyOptions {
  model: string;
  messages: ProviderMessage[];
  tools: ToolDefinition[];
  stream: boolean;
  /** Akışta kullanım bilgisi istensin mi? */
  streamUsage: boolean;
  /** Sistem istemi önbelleklensin mi? */
  cacheSystemPrompt: boolean;
}

/** İstek gövdesini kurar. `stream_options` yalnızca gerektiğinde eklenir. */
export function buildRequestBody(options: BuildBodyOptions): Record<string, unknown> {
  const formattedMessages = formatMessages(options.messages);
  if (options.cacheSystemPrompt) {
    markSystemPromptCacheable(formattedMessages);
  }

  const formattedTools = formatTools(options.tools);
  const body: Record<string, unknown> = {
    model: options.model,
    messages: formattedMessages,
    tools: formattedTools.length > 0 ? formattedTools : undefined,
    stream: options.stream
  };

  // Bu olmadan OpenAI tarzı sunucular akış yanıtlarında kullanım bilgisini
  // atlar ve token sayacı 0'da kalır.
  if (options.stream && options.streamUsage) {
    body.stream_options = { include_usage: true };
  }

  return body;
}
