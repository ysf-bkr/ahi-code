/**
 * Ayarlar ekranındaki sağlayıcı seçimi ve model alanları.
 *
 * `SettingsView`'dan ayrıldı: bu blok kendi durumunu yönetmez, yalnızca
 * yukarıdan gelen form verisini ve geri çağrıları kullanır. Böylece ayarlar
 * ekranı okunabilir kalır.
 */
import React from 'react';
import { CheckCircle2, Cpu, Globe, HardDrive, Info, Key, RefreshCw, Shield, Trash2, Zap } from 'lucide-react';
import { ModelProviderType, UserSettings } from '@shared/types';
import {
  Card,
  Disclosure,
  IconButton,
  ListButton,
  Section,
  SectionTitle,
  SelectField,
  TextField
} from './ui';

export interface ProviderMeta {
  id: ModelProviderType;
  name: string;
  description: string;
  icon: React.ReactNode;
  defaultModel: string;
}

/** Ayarlarda listelenen sağlayıcılar ve varsayılan modelleri. */
export const PROVIDERS: ProviderMeta[] = [
  {
    id: 'ollama',
    name: 'Yerel model',
    description: 'Ollama (yerel sunucu)',
    icon: <HardDrive className="h-3.5 w-3.5 text-emerald-400" />,
    defaultModel: 'llama3.1'
  },
  {
    id: 'evren',
    name: 'EVREN LLM',
    description: 'evren.ssyz.org.tr uç noktası',
    icon: <Zap className="h-3.5 w-3.5 text-amber-400" />,
    defaultModel: 'auto'
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Birden fazla model sağlayıcısı',
    icon: <Globe className="h-3.5 w-3.5 text-[var(--ahi-brand-400)]" />,
    defaultModel: 'anthropic/claude-3.5-sonnet'
  },
  {
    id: 'openai-compatible',
    name: 'OpenAI uyumlu API',
    description: 'LM Studio, vLLM ve diğer uyumlu sunucular',
    icon: <Globe className="h-3.5 w-3.5 text-violet-400" />,
    defaultModel: 'auto'
  }
];

export interface ProviderSectionProps {
  formData: UserSettings;
  updateForm: (updater: (previous: UserSettings) => UserSettings) => void;
  onProviderChange: (provider: ModelProviderType) => void;
  onApiKeyChange: (provider: 'evren' | 'openrouter' | 'openaiCompatible', key: string) => void;
  onClearApiKey: (provider: 'evren' | 'openrouter' | 'openaiCompatible') => void;
  onFetchModels: () => void;
  currentProvider: ProviderMeta;
  availableModels: string[];
  loadingModels: boolean;
  modelsError: string | null;
  modelsLoadedMsg: string | null;
}

export const ProviderSection: React.FC<ProviderSectionProps> = ({
  formData,
  updateForm,
  onProviderChange,
  onApiKeyChange,
  onClearApiKey,
  onFetchModels,
  currentProvider,
  availableModels,
  loadingModels,
  modelsError,
  modelsLoadedMsg
}) => {
  const apiKeyProvider =
    formData.selectedProvider === 'openai-compatible' ? 'openaiCompatible' : formData.selectedProvider;
  const apiKeyValue =
    apiKeyProvider === 'openrouter' || apiKeyProvider === 'openaiCompatible'
      ? formData.apiKeys[apiKeyProvider] || ''
      : '';
  const hasStoredKey =
    apiKeyProvider === 'openrouter' || apiKeyProvider === 'openaiCompatible'
      ? Boolean(formData.apiKeyStatus?.[apiKeyProvider])
      : false;

  return (
    <>
      <Section>
        <SectionTitle icon={<Cpu className="h-3 w-3" />} title="Model sağlayıcısı" />
        <div className="flex flex-col gap-1.5">
          {PROVIDERS.map((provider) => {
            const active = formData.selectedProvider === provider.id;
            return (
              <ListButton
                key={provider.id}
                onClick={() => onProviderChange(provider.id)}
                active={active}
                icon={<span className="ahi-toggle-row__icon h-7 w-7">{provider.icon}</span>}
                title={provider.name}
                description={provider.description}
                trailing={
                  active ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--ahi-brand-400)]" />
                  ) : undefined
                }
              />
            );
          })}
        </div>
      </Section>

      <Card className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs flex items-center gap-1.5 font-semibold">
            <Zap className="h-3 w-3 text-amber-400" /> {currentProvider.name}
          </div>
          {loadingModels && (
            <span className="text-2xs flex items-center gap-1 text-[var(--ahi-brand-400)]">
              <RefreshCw className="h-2.5 w-2.5 animate-spin" /> yükleniyor
            </span>
          )}
          {!loadingModels && !modelsError && modelsLoadedMsg && (
            <span className="text-2xs flex items-center gap-1 text-[var(--status-success-fg)]">
              <CheckCircle2 className="h-2.5 w-2.5" /> {modelsLoadedMsg}
            </span>
          )}
        </div>

        {formData.selectedProvider !== 'ollama' && (
          <TextField
            label="API anahtarı"
            labelIcon={<Key className="h-3 w-3 text-[var(--ahi-muted-fg)]" />}
            type="password"
            value={apiKeyValue}
            onChange={(event) => {
              const allowed: Array<'openrouter' | 'openaiCompatible'> = ['openrouter', 'openaiCompatible'];
              if (allowed.includes(apiKeyProvider as never)) {
                onApiKeyChange(apiKeyProvider as 'openrouter' | 'openaiCompatible', event.target.value);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onFetchModels();
            }}
            placeholder={hasStoredKey ? 'Kayıtlı anahtar korunuyor' : 'API anahtarı'}
            hint="Anahtar VS Code SecretStorage içinde saklanır; arayüzde maskelenir."
            trailing={
              <div className="flex items-center gap-1">
                {hasStoredKey && <Shield className="h-3 w-3 text-[var(--status-success-fg)]" />}
                <IconButton label="Modelleri yenile" onClick={onFetchModels} small>
                  <RefreshCw className={`h-3 w-3 ${loadingModels ? 'animate-spin' : ''}`} />
                </IconButton>
                {hasStoredKey && (
                  <IconButton
                    label="Anahtarı sil"
                    small
                    onClick={() => {
                      const allowed: Array<'openrouter' | 'openaiCompatible'> = [
                        'openrouter',
                        'openaiCompatible'
                      ];
                      if (allowed.includes(apiKeyProvider as never)) {
                        onClearApiKey(apiKeyProvider as 'openrouter' | 'openaiCompatible');
                      }
                    }}
                  >
                    <Trash2 className="h-3 w-3 text-[var(--status-danger-fg)]" />
                  </IconButton>
                )}
              </div>
            }
          />
        )}

        {formData.selectedProvider === 'ollama' && (
          <TextField
            label="Ollama adresi"
            type="text"
            value={formData.ollamaBaseUrl ?? ''}
            onChange={(event) => updateForm((prev) => ({ ...prev, ollamaBaseUrl: event.target.value }))}
            placeholder="http://localhost:11434"
            mono
          />
        )}

        {formData.selectedProvider === 'openai-compatible' && (
          <TextField
            label="Uç nokta"
            type="text"
            value={formData.openAiCompatibleBaseUrl ?? ''}
            onChange={(event) =>
              updateForm((prev) => ({ ...prev, openAiCompatibleBaseUrl: event.target.value }))
            }
            placeholder="http://localhost:1234/v1"
            mono
            hint="Sohbet tamamlama API'si ve /models uç noktası OpenAI API biçimiyle uyumlu olmalıdır. Yerel sunucularda anahtar gerekmeyebilir."
          />
        )}

        {modelsError && (
          <p
            role="status"
            className="text-2xs flex items-start gap-1 rounded border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-1.5 py-1 text-[var(--status-warning-fg)]"
          >
            <Info className="mt-0.5 h-2.5 w-2.5 shrink-0" />
            <span className="break-words">
              Model listesi alınamadı: {modelsError}
              <br />
              Model kimliğini elle yazabilirsiniz.
            </span>
          </p>
        )}

        {availableModels.length > 0 ? (
          <SelectField
            label="Model"
            value={availableModels.includes(formData.selectedModel) ? formData.selectedModel : '__custom__'}
            onChange={(event) => {
              const value = event.target.value;
              if (value === '__custom__') return;
              updateForm((prev) => ({ ...prev, selectedModel: value }));
            }}
            mono
            hint="Listede olmayan bir model kimliği kullanmak için aşağıdaki alanı kullanın."
          >
            {availableModels.map((model) => (
              <option key={model} value={model}>
                {model === 'auto' ? 'auto (en uygun)' : model}
              </option>
            ))}
            {!availableModels.includes(formData.selectedModel) && (
              <option value="__custom__">{formData.selectedModel || 'özel model'} (listede yok)</option>
            )}
          </SelectField>
        ) : (
          <TextField
            label="Model"
            type="text"
            value={formData.selectedModel}
            onChange={(event) => updateForm((prev) => ({ ...prev, selectedModel: event.target.value }))}
            placeholder={currentProvider.defaultModel}
            mono
          />
        )}

        {availableModels.length > 0 && !availableModels.includes(formData.selectedModel) && (
          <TextField
            label="Özel model kimliği"
            type="text"
            value={formData.selectedModel}
            onChange={(event) => updateForm((prev) => ({ ...prev, selectedModel: event.target.value }))}
            placeholder={currentProvider.defaultModel}
            mono
          />
        )}

        {formData.selectedProvider === 'evren' && (
          <Disclosure summary="Gelişmiş: uç nokta">
            <TextField
              containerClassName="mt-1"
              type="text"
              aria-label="EVREN uç noktası"
              value={formData.customBaseUrl ?? ''}
              placeholder="https://evren-llmapi.ssyz.org.tr/v1"
              onChange={(event) => updateForm((prev) => ({ ...prev, customBaseUrl: event.target.value }))}
              mono
            />
          </Disclosure>
        )}
      </Card>
    </>
  );
};
