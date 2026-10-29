import type { ToolDefinition } from '../tools/base';

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
}

export interface ModelCompletionResponse {
  text: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    /** Sağlayıcı tarafındaki istem önbelleğinden gelen tokenlar (indirimli faturalanır). */
    cachedTokens?: number;
  };
}

export interface ModelProvider {
  id: string;
  name: string;
  sendMessage(
    messages: ProviderMessage[],
    tools: ToolDefinition[],
    onStreamChunk?: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<ModelCompletionResponse>;
}
