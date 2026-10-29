import { ModelProvider } from './base';
import { normalizeBaseUrl, OpenAICompatibleProvider } from './openai';
import { EvrenModelProvider } from './evren';
import { UserSettings } from '../shared/types';
import { DEFAULT_PROVIDER_URLS, REPO_URL } from '../shared/constants';

/**
 * `auto` is only meaningful for providers that pick a model server-side
 * `auto` yalnızca modeli sunucu tarafında seçen sağlayıcılar için anlamlıdır
 */
function modelFor(settings: UserSettings, fallback: string): string {
  const model = settings.selectedModel?.trim();
  if (!model || model === 'auto') return fallback;
  return model;
}

export function createModelProvider(settings: UserSettings): ModelProvider {
  switch (settings.selectedProvider) {
    case 'evren':
      return new EvrenModelProvider(
        settings.apiKeys.evren || '',
        settings.customBaseUrl || undefined,
        settings.selectedModel || 'auto',
        settings.autoAcceptTerms === true,
        settings.promptCaching !== false
      );

    case 'openrouter':
      return new OpenAICompatibleProvider({
        id: 'openrouter',
        name: 'OpenRouter',
        apiKey: settings.apiKeys.openrouter || '',
        baseURL: DEFAULT_PROVIDER_URLS.openrouter,
        model: modelFor(settings, 'anthropic/claude-3.5-sonnet'),
        extraHeaders: {
          'HTTP-Referer': REPO_URL,
          'X-Title': 'AhiCode'
        },
        promptCaching: settings.promptCaching !== false,
        promptCachingStyle: 'cache_control',
        streamUsage: true
      });

    case 'ollama':
      return new OpenAICompatibleProvider({
        id: 'ollama',
        name: 'Yerel Model (Ollama)',
        apiKey: 'ollama',
        // Accept both `host:11434` and `host:11434/v1` from the user; the chat
        // endpoint always appends `/v1` once.
        baseURL: `${normalizeBaseUrl(settings.ollamaBaseUrl || DEFAULT_PROVIDER_URLS.ollama, ['/v1'])}/v1`,
        model: modelFor(settings, 'llama3.1'),
        requiresConcreteModel: true,
        promptCaching: false
      });

    case 'openai-compatible':
      return new OpenAICompatibleProvider({
        id: 'openai-compatible',
        name: 'OpenAI uyumlu sağlayıcı',
        apiKey: settings.apiKeys.openaiCompatible || '',
        baseURL: settings.openAiCompatibleBaseUrl || DEFAULT_PROVIDER_URLS.lmstudio,
        model: modelFor(settings, ''),
        requiresApiKey: false,
        requiresConcreteModel: true,
        promptCaching: false,
        streamUsage: true
      });

    default:
      // Unknown provider name: fall back to Ollama as the safe default.
      return createModelProvider({
        ...settings,
        selectedProvider: 'ollama',
        selectedModel: settings.selectedModel || 'llama3.1'
      });
  }
}
