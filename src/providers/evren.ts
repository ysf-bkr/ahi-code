import { OpenAICompatibleProvider } from './openai';
import { ModelCompletionResponse, ProviderMessage } from './base';
import type { ToolDefinition } from '../tools/base';
import { errorMessage, isRecord } from '../shared/errors';
import { logWarning } from '../shared/logging';

export const EVREN_DEFAULT_BASE_URL = 'https://evren-llmapi.ssyz.org.tr/v1';

export interface EvrenModelItem {
  id: string;
  object: string;
  created: number;
  owned_by: string;
  task?: string;
  modalities?: string[];
  pricing?: {
    prompt_token_price: number;
    completion_token_price: number;
    currency: string;
    free_until?: string;
  };
}

export class EvrenModelProvider extends OpenAICompatibleProvider {
  private evrenApiKey: string;
  private evrenBaseUrl: string;
  private autoAcceptTerms: boolean;
  private termsChecked = false;

  constructor(
    apiKey: string,
    baseURL: string = EVREN_DEFAULT_BASE_URL,
    model: string = 'auto',
    autoAcceptTerms = false,
    promptCaching = true
  ) {
    super({
      id: 'evren',
      name: 'EVREN LLM (evren.ssyz.org.tr)',
      apiKey,
      baseURL,
      model,
      promptCaching,
      promptCachingStyle: 'cache_control',
      streamUsage: true,
      extraHeaders: {
        'X-API-Key': apiKey,
        'X-Client-Name': 'AhiCode-VSCode'
      }
    });
    this.evrenApiKey = apiKey;
    this.evrenBaseUrl = baseURL.replace(/\/+$/, '');
    this.autoAcceptTerms = autoAcceptTerms;
  }

  /**
   * Bir EVREN API çağrısından önce kullanım koşullarını denetler ve gerekiyorsa kabul eder.
   */
  public async ensureTermsAccepted(): Promise<void> {
    if (this.termsChecked) return;

    // Kullanım koşullarının durumu doğrulanamadan istek göndermek (fail-open)
    // uyumluluk riski taşır. Kısa bir yeniden denemeden sonra kapalı kal (fail closed).
    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.queryAndAcceptTerms();
        this.termsChecked = true;
        return;
      } catch (err) {
        const message = errorMessage(err);
        if (/terms of use|could not be accepted/i.test(message)) {
          this.termsChecked = false;
          throw err;
        }
        if (attempt < maxAttempts) {
          logWarning(`EVREN terms of use check failed (attempt ${attempt}/${maxAttempts})`, err);
        } else {
          this.termsChecked = false;
          throw new Error(
            'Could not verify EVREN terms of use due to a network error. The request was stopped for security reasons; ' +
              'check your connection and try again.',
            { cause: err }
          );
        }
      }
    }
  }

  private async queryAndAcceptTerms(): Promise<void> {
    const statusRes = await fetch(`${this.evrenBaseUrl}/terms/status`, {
      headers: { 'X-API-Key': this.evrenApiKey },
      signal: AbortSignal.timeout(10000)
    });

    if (!statusRes.ok) {
      // Fail closed: koşulların durumu doğrulanamıyorsa istek gönderilmemelidir.
      // Daha önce 401/403/500 kontrolü sessizce atlıyordu.
      throw new Error(
        `Could not verify EVREN terms of use (HTTP ${statusRes.status}). The request was stopped for compliance reasons.`
      );
    }

    {
      const data: unknown = await statusRes.json();
      if (!isRecord(data)) {
        throw new Error('Unexpected EVREN terms status response; the request was stopped.');
      }
      if (data.accepted === false && data.current_version !== undefined) {
        if (!this.autoAcceptTerms) {
          throw new Error(
            'The EVREN LLM terms of use have not been accepted yet. ' +
              'To accept them, enable ahiCode.autoAcceptTerms in VS Code settings or accept them in the provider panel.'
          );
        }
        // Kabul işlemini yalnızca kullanıcı açıkça izin verdiyse gönder.
        const acceptRes = await fetch(`${this.evrenBaseUrl}/terms/accept`, {
          method: 'POST',
          headers: {
            'X-API-Key': this.evrenApiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ version: data.current_version }),
          signal: AbortSignal.timeout(10000)
        });
        if (!acceptRes.ok) {
          throw new Error(`Could not accept EVREN terms of use (HTTP ${acceptRes.status}).`);
        }
      }
    }
  }

  override async sendMessage(
    messages: ProviderMessage[],
    tools: ToolDefinition[],
    onStreamChunk?: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<ModelCompletionResponse> {
    // İlk istekten önce koşulları doğrula.
    await this.ensureTermsAccepted();
    return super.sendMessage(messages, tools, onStreamChunk, signal);
  }

  /**
   * EVREN API üzerinden hesaba açık modelleri listeler.
   */
  public static async fetchAvailableModels(
    apiKey: string,
    baseURL: string = EVREN_DEFAULT_BASE_URL
  ): Promise<EvrenModelItem[]> {
    if (!apiKey) {
      throw new Error('EVREN API key cannot be empty.');
    }

    const cleanBaseUrl = baseURL.replace(/\/+$/, '');
    const url = `${cleanBaseUrl}/models`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-API-Key': apiKey,
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(15_000)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Could not fetch EVREN models [${response.status}]: ${errText}`);
    }

    const json: unknown = await response.json();
    if (isRecord(json) && Array.isArray(json.data)) {
      return json.data.filter(
        (item): item is EvrenModelItem => isRecord(item) && typeof item.id === 'string'
      );
    }
    return [];
  }
}
