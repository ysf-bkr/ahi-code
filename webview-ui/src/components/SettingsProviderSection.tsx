/**
 * Ayarlar ekranındaki sağlayıcı seçimi ve model alanları.
 *
 * `SettingsView`'dan ayrıldı: bu blok kendi durumunu yönetmez, yalnızca
 * yukarıdan gelen form verisini ve geri çağrıları kullanır. Böylece ayarlar
 * ekranı okunabilir kalır.
 */
import React, { useState } from 'react';
import {
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  Globe,
  HardDrive,
  Info,
  Key,
  RefreshCw,
  Shield,
  Trash2,
  Zap
} from 'lucide-react';
import { ModelProviderType, UserSettings } from '@shared/types';
import { MASKED_KEY } from '@shared/constants';
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
    icon: <HardDrive className="ahi-icon-sm ahi-text-success" />,
    defaultModel: 'llama3.1'
  },
  {
    id: 'evren',
    name: 'EVREN LLM',
    description: 'evren.ssyz.org.tr uç noktası',
    icon: <Zap className="ahi-icon-sm ahi-text-warning" />,
    defaultModel: 'auto'
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Birden fazla model sağlayıcısı',
    icon: <Globe className="ahi-icon-sm ahi-text-brand" />,
    defaultModel: 'anthropic/claude-3.5-sonnet'
  },
  {
    id: 'openai-compatible',
    name: 'OpenAI uyumlu API',
    description: 'LM Studio, vLLM ve diğer uyumlu sunucular',
    icon: <Globe className="ahi-icon-sm ahi-text-brand" />,
    defaultModel: 'auto'
  }
];

export interface ProviderSectionProps {
  formData: UserSettings;
  updateForm: (updater: (previous: UserSettings) => UserSettings, immediate?: boolean) => void;
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
  const [showApiKey, setShowApiKey] = useState(false);

  type ApiKeyProvider = 'evren' | 'openrouter' | 'openaiCompatible';
  const apiKeyProvider: ApiKeyProvider | undefined =
    formData.selectedProvider === 'openai-compatible'
      ? 'openaiCompatible'
      : formData.selectedProvider === 'ollama'
        ? undefined
        : (formData.selectedProvider as ApiKeyProvider);

  const hasStoredKey = apiKeyProvider ? Boolean(formData.apiKeyStatus?.[apiKeyProvider]) : false;
  const rawKey = apiKeyProvider ? formData.apiKeys[apiKeyProvider] || '' : '';
  const apiKeyValue = rawKey === MASKED_KEY ? '' : rawKey;

  return (
    <>
      <Section>
        <SectionTitle icon={<Cpu className="ahi-icon-xs" />} title="Model sağlayıcısı" />
        <div className="flex flex-col gap-1.5">
          {PROVIDERS.map((provider) => {
            const active = formData.selectedProvider === provider.id;
            return (
              <ListButton
                key={provider.id}
                onClick={() => onProviderChange(provider.id)}
                active={active}
                icon={provider.icon}
                title={provider.name}
                description={provider.description}
                trailing={
                  active ? <CheckCircle2 className="ahi-icon-sm shrink-0 ahi-text-brand" /> : undefined
                }
              />
            );
          })}
        </div>
      </Section>

      <Card className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs flex items-center gap-1.5 font-semibold">
            <Zap className="ahi-icon-xs ahi-text-warning" /> {currentProvider.name}
          </div>
          {loadingModels && (
            <span className="text-2xs flex items-center gap-1 ahi-text-brand">
              <RefreshCw className="ahi-icon-xs animate-spin" /> yükleniyor
            </span>
          )}
          {!loadingModels && !modelsError && modelsLoadedMsg && (
            <span className="text-2xs flex items-center gap-1 ahi-text-success">
              <CheckCircle2 className="ahi-icon-xs" /> {modelsLoadedMsg}
            </span>
          )}
        </div>

        {formData.selectedProvider !== 'ollama' && apiKeyProvider && (
          <TextField
            label="API anahtarı"
            labelIcon={<Key className="ahi-icon-xs ahi-text-muted" />}
            type={showApiKey ? 'text' : 'password'}
            value={apiKeyValue}
            onChange={(event) => {
              onApiKeyChange(apiKeyProvider, event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onFetchModels();
            }}
            placeholder={hasStoredKey ? '•••••••••••••••• (Kayıtlı anahtar korunuyor)' : 'API anahtarı girin'}
            hint="Anahtar VS Code SecretStorage (güvenli kasa) içinde saklanır; arayüzde asla açık tutulmaz."
            trailing={
              <div className="flex items-center gap-1">
                <IconButton
                  label={showApiKey ? 'Anahtarı gizle' : 'Anahtarı göster'}
                  onClick={() => setShowApiKey((prev) => !prev)}
                  small
                >
                  {showApiKey ? (
                    <EyeOff className="ahi-icon-xs ahi-text-muted" />
                  ) : (
                    <Eye className="ahi-icon-xs ahi-text-muted" />
                  )}
                </IconButton>
                {hasStoredKey && (
                  <span title="Kayıtlı anahtar SecretStorage kasasında güvende">
                    <Shield className="ahi-icon-xs ahi-text-success" />
                  </span>
                )}
                <IconButton label="Modelleri yenile" onClick={onFetchModels} small>
                  <RefreshCw className={`ahi-icon-xs ${loadingModels ? 'animate-spin' : ''}`} />
                </IconButton>
                {hasStoredKey && (
                  <IconButton
                    label="Anahtarı sil"
                    small
                    onClick={() => {
                      onClearApiKey(apiKeyProvider);
                    }}
                  >
                    <Trash2 className="ahi-icon-xs ahi-text-error" />
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
            onChange={(event) =>
              updateForm((prev) => ({ ...prev, ollamaBaseUrl: event.target.value }), false)
            }
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
              updateForm((prev) => ({ ...prev, openAiCompatibleBaseUrl: event.target.value }), false)
            }
            placeholder="http://localhost:1234/v1"
            mono
            hint="Sohbet tamamlama API'si ve /models uç noktası OpenAI API biçimiyle uyumlu olmalıdır. Yerel sunucularda anahtar gerekmeyebilir."
          />
        )}

        {modelsError && (
          <p
            role="status"
            className="text-2xs flex items-start gap-1 rounded border ahi-border-warning ahi-bg-warning px-1.5 py-1 ahi-text-warning"
          >
            <Info className="ahi-icon-xs mt-0.5 shrink-0" />
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
              updateForm((prev) => ({ ...prev, selectedModel: value }), true);
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
            onChange={(event) =>
              updateForm((prev) => ({ ...prev, selectedModel: event.target.value }), false)
            }
            placeholder={currentProvider.defaultModel}
            mono
          />
        )}

        {availableModels.length > 0 && !availableModels.includes(formData.selectedModel) && (
          <TextField
            label="Özel model kimliği"
            type="text"
            value={formData.selectedModel}
            onChange={(event) =>
              updateForm((prev) => ({ ...prev, selectedModel: event.target.value }), false)
            }
            placeholder={currentProvider.defaultModel}
            mono
          />
        )}

        <Disclosure summary="Gelişmiş: bağlantı ve zaman aşımı">
          <div className="mt-2 flex flex-col gap-2">
            <TextField
              label="İstek zaman aşımı (saniye)"
              type="number"
              min={30}
              max={900}
              step={15}
              value={formData.requestTimeoutSeconds ?? 180}
              onChange={(event) =>
                updateForm(
                  (prev) => ({
                    ...prev,
                    requestTimeoutSeconds: Math.max(30, Number(event.target.value) || 180)
                  }),
                  false
                )
              }
              placeholder="180"
              hint="Yavaş yanıt veren modeller veya yerel sunucularda (Ollama, LM Studio) bağlantının kopmasını önlemek için süreyi artırabilirsiniz (varsayılan: 180 sn)."
            />
            {formData.selectedProvider === 'evren' && (
              <TextField
                type="text"
                label="EVREN uç noktası"
                aria-label="EVREN uç noktası"
                value={formData.customBaseUrl ?? ''}
                placeholder="https://evren-llmapi.ssyz.org.tr/v1"
                onChange={(event) =>
                  updateForm((prev) => ({ ...prev, customBaseUrl: event.target.value }), false)
                }
                mono
              />
            )}
          </div>
        </Disclosure>
      </Card>
    </>
  );
};
