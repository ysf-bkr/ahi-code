import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  ShieldCheck,
  HardDrive,
  Info,
  Zap,
  Globe,
  Gauge,
  FileCode2,
  BookOpen,
  Brain
} from 'lucide-react';
import { ModelProviderType, NavigationDestination, UserSettings } from '@shared/types';
import { ScreenHeader } from './ScreenHeader';
import { vscode } from '../utils/vscode';
import { Button, Card, ListButton, Section, SectionTitle, TextField, Toggle } from './ui';
import { PROVIDERS, ProviderSection } from './SettingsProviderSection';

interface SettingsViewProps {
  settings: UserSettings;
  onBack: () => void;
  onOpenAbout?: () => void;
  onSelectMenu?: (destination: NavigationDestination) => void;
  changedFileCount?: number;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onBack,
  onOpenAbout,
  onSelectMenu,
  changedFileCount
}) => {
  const [formData, setFormData] = useState<UserSettings>(settings);
  const [saved, setSaved] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsLoadedMsg, setModelsLoadedMsg] = useState<string | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Güncel formu referansta tutarak zamanlayıcıların doğru veriyi kaydetmesini sağlar.
  const formRef = useRef(formData);
  formRef.current = formData;

  const saveSettings = (data: UserSettings) => {
    vscode.postMessage({ type: 'SAVE_SETTINGS', payload: data });
    setSaved(true);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSaved(false), 2000);
  };

  /**
   * Formu günceller ve ayarları otomatik olarak kaydeder.
   * Seçimler ve anahtarlar anında (`immediate=true`), metin girişleri ise
   * tuş basımı bittikten sonra gecikmeli kaydedilir.
   */
  const updateForm = (next: UserSettings | ((prev: UserSettings) => UserSettings), immediate = true) => {
    setFormData((prev) => {
      const nextValue = typeof next === 'function' ? next(prev) : next;
      formRef.current = nextValue;
      if (saveDebounceRef.current) {
        clearTimeout(saveDebounceRef.current);
        saveDebounceRef.current = null;
      }
      if (immediate) {
        saveSettings(nextValue);
      } else {
        saveDebounceRef.current = setTimeout(() => {
          saveSettings(formRef.current);
          saveDebounceRef.current = null;
        }, 350);
      }
      return nextValue;
    });
  };

  // Dışarıdan yeni ayar gelirse (kullanıcı yerel olarak yazmadığı sürece) formu güncelle
  useEffect(() => {
    if (!saveDebounceRef.current) {
      setFormData(settings);
    }
  }, [settings]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      if (saveDebounceRef.current) {
        clearTimeout(saveDebounceRef.current);
        saveSettings(formRef.current);
      }
    };
  }, []);

  const triggerFetchModels = (provider: ModelProviderType, apiKey?: string, baseUrl?: string) => {
    if (provider === 'evren' && !apiKey) return;
    if (provider === 'openrouter' && !apiKey) return;

    setLoadingModels(true);
    setModelsError(null);
    setModelsLoadedMsg(null);
    vscode.postMessage({ type: 'FETCH_MODELS', payload: { provider, apiKey, baseUrl } });
  };

  useEffect(() => {
    const current = formRef.current;
    const activeKey = current.apiKeys[current.selectedProvider as keyof typeof current.apiKeys];
    if (
      current.selectedProvider === 'ollama' ||
      current.selectedProvider === 'openai-compatible' ||
      activeKey
    ) {
      triggerFetchModels(
        current.selectedProvider,
        activeKey,
        current.selectedProvider === 'ollama'
          ? current.ollamaBaseUrl
          : current.selectedProvider === 'openai-compatible'
            ? current.openAiCompatibleBaseUrl
            : current.customBaseUrl
      );
    }
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type !== 'MODELS_LOADED') return;
      setLoadingModels(false);
      if (msg.payload?.provider && msg.payload.provider !== formData.selectedProvider) return;

      if (msg.payload.models?.length > 0) {
        setAvailableModels(msg.payload.models);
        const currentIsListed = msg.payload.models.includes(formData.selectedModel);
        setModelsLoadedMsg(
          currentIsListed
            ? `${msg.payload.models.length} model yüklendi`
            : `${msg.payload.models.length} model yüklendi; özel model seçiminiz korundu`
        );
        setModelsError(null);
      }
      if (msg.payload.error) {
        setModelsError(msg.payload.error);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [formData.selectedModel, formData.selectedProvider]);

  const handleApiKeyChange = (provider: 'evren' | 'openrouter' | 'openaiCompatible', key: string) => {
    updateForm(
      (prev) => ({
        ...prev,
        apiKeys: { ...prev.apiKeys, [provider]: key }
      }),
      false
    );

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (key.trim()) {
      debounceTimerRef.current = setTimeout(() => {
        const modelProvider = provider === 'openaiCompatible' ? 'openai-compatible' : provider;
        const latest = formRef.current;
        const baseUrl =
          provider === 'openaiCompatible' ? latest.openAiCompatibleBaseUrl : latest.customBaseUrl;
        triggerFetchModels(modelProvider, key.trim(), baseUrl);
      }, 500);
    }
  };

  const handleClearApiKey = (provider: 'evren' | 'openrouter' | 'openaiCompatible') => {
    updateForm(
      (prev) => ({
        ...prev,
        apiKeys: { ...prev.apiKeys, [provider]: '' },
        apiKeyStatus: prev.apiKeyStatus ? { ...prev.apiKeyStatus, [provider]: false } : undefined
      }),
      true
    );
  };

  const handleProviderChange = (provider: ModelProviderType) => {
    const meta = PROVIDERS.find((item) => item.id === provider);
    const updated: UserSettings = {
      ...formData,
      selectedProvider: provider,
      selectedModel: meta?.defaultModel || formData.selectedModel
    };
    updateForm(updated, true);
    setAvailableModels([]);
    setModelsLoadedMsg(null);
    setModelsError(null);

    const activeKey = updated.apiKeys[provider as keyof typeof updated.apiKeys];
    triggerFetchModels(
      provider,
      activeKey,
      provider === 'ollama'
        ? updated.ollamaBaseUrl
        : provider === 'openai-compatible'
          ? updated.openAiCompatibleBaseUrl
          : updated.customBaseUrl
    );
  };

  const handleBack = () => {
    // Bekleyen gecikmeli bir kayıt varsa ayrılmadan önce hemen gönder
    if (saveDebounceRef.current) {
      clearTimeout(saveDebounceRef.current);
      saveDebounceRef.current = null;
      saveSettings(formRef.current);
    }
    onBack();
  };

  const currentProvider = PROVIDERS.find((p) => p.id === formData.selectedProvider) || PROVIDERS[0];
  const modelRouting = formData.modelRouting || { enabled: false };
  const sandboxMode = formData.sandbox?.mode;

  return (
    <div className="ahi-screen">
      <ScreenHeader
        title="Ayarlar"
        subtitle="Model, API ve güvenlik tercihleri"
        onBack={handleBack}
        onSelectMenu={onSelectMenu}
        activeDestination="settings"
        changedFileCount={changedFileCount}
        actions={
          <div className="flex items-center gap-1.5">
            {saved ? (
              <span className="flex items-center gap-1 text-2xs font-medium ahi-text-success">
                <Check className="ahi-icon-xs" /> Otomatik kaydedildi
              </span>
            ) : (
              <span className="text-2xs ahi-text-muted">Otomatik kaydedilir</span>
            )}
          </div>
        }
      />

      <div className="ahi-screen-body">
        <ProviderSection
          formData={formData}
          updateForm={updateForm}
          onProviderChange={handleProviderChange}
          onApiKeyChange={handleApiKeyChange}
          onClearApiKey={handleClearApiKey}
          onFetchModels={() =>
            triggerFetchModels(
              formData.selectedProvider,
              formData.apiKeys[formData.selectedProvider as keyof typeof formData.apiKeys],
              formData.selectedProvider === 'ollama'
                ? formData.ollamaBaseUrl
                : formData.selectedProvider === 'openai-compatible'
                  ? formData.openAiCompatibleBaseUrl
                  : formData.customBaseUrl
            )
          }
          currentProvider={currentProvider}
          availableModels={availableModels}
          loadingModels={loadingModels}
          modelsLoadedMsg={modelsLoadedMsg}
          modelsError={modelsError}
        />

        <Section>
          <SectionTitle icon={<Zap className="ahi-icon-xs" />} title="Ajan davranışı" />

          <div>
            <div className="ahi-label mb-1">Otonomi seviyesi</div>
            <div className="grid grid-cols-3 gap-1">
              {(
                [
                  ['manual', 'Elle', 'Her adım onay ister'],
                  ['guided', 'Yönlendirilmiş', 'Yazma öncesi onay'],
                  ['auto', 'Otonom', 'Soru hariç otomatik']
                ] as const
              ).map(([value, label, desc]) => (
                <ListButton
                  key={value}
                  type="button"
                  active={(formData.autonomy ?? 'manual') === value}
                  aria-pressed={(formData.autonomy ?? 'manual') === value}
                  onClick={() => updateForm((prev) => ({ ...prev, autonomy: value }), true)}
                  title={label}
                  description={desc}
                  trailing={
                    (formData.autonomy ?? 'manual') === value ? (
                      <Check className="ahi-icon-xs ahi-text-brand" />
                    ) : undefined
                  }
                />
              ))}
            </div>
            <p className="ahi-caption mt-1.5">
              Elle: aşağıdaki izin ayarları geçerlidir. Yönlendirilmiş: spec/plan kartları ve sorular
              beklemez, dosya yazma onayı ise her zaman sorulur. Otonom: akış kartları beklemez, dosya yazma
              ve güvenli komutlar otomatik onaylanır. Riskli ya da tanımadığımız komutlar, hassas dosyalar ve
              ağ erişimi her seviyede onay ister.
            </p>
          </div>

          <Toggle
            checked={formData.autoVerify === true}
            onChange={(value) => updateForm((prev) => ({ ...prev, autoVerify: value }), true)}
            title="Otomatik doğrulama"
            description="Dosya değişikliklerinden sonra test ve lint komutlarını otomatik çalıştırır."
            icon={<Check className="ahi-icon-xs ahi-text-success" />}
          />

          <Toggle
            checked={formData.promptCaching !== false}
            onChange={(value) => updateForm((prev) => ({ ...prev, promptCaching: value }), true)}
            title="İstem önbellekleme (Prompt caching)"
            description="Destekleyen sağlayıcılarda sistem promptunu önbelleğe alarak maliyeti düşürür."
            icon={<Zap className="ahi-icon-xs ahi-text-brand" />}
          />

          <Toggle
            checked={formData.captureBaseline === true}
            onChange={(value) => updateForm((prev) => ({ ...prev, captureBaseline: value }), true)}
            title="Görev başlangıcında baz çizgi al"
            description="Göreve başlamadan önce test durumunu kaydeder; regresyon tespitini kolaylaştırır."
            icon={<Gauge className="ahi-icon-xs ahi-text-info" />}
          />

          <Toggle
            checked={modelRouting.enabled === true}
            onChange={(value) =>
              updateForm(
                (prev) => ({
                  ...prev,
                  modelRouting: { ...(prev.modelRouting || { enabled: false }), enabled: value }
                }),
                true
              )
            }
            title="Model yönlendirme"
            description="Basit görevlerde hızlı, karmaşık görevlerde güçlü bir model kullanır. Alt ajan modelleri rol bazlı otomatik seçilir; EVREN'de yönetici ve mimar GLM-5.3 ile çalışır (yedek: MiMo-V2.6-Pro)."
            icon={<Zap className="ahi-icon-xs ahi-text-brand" />}
          />

          {modelRouting.enabled && (
            <div className="flex flex-col gap-1.5">
              {(
                [
                  ['fastModel', 'Hızlı model'],
                  ['deepModel', 'Derin akıl yürütme modeli'],
                  ['reviewModel', 'İnceleme modeli']
                ] as const
              ).map(([key, label]) => (
                <TextField
                  key={key}
                  type="text"
                  aria-label={label}
                  value={modelRouting[key] || ''}
                  onChange={(e) =>
                    updateForm(
                      (prev) => ({
                        ...prev,
                        modelRouting: { ...(prev.modelRouting || { enabled: true }), [key]: e.target.value }
                      }),
                      false
                    )
                  }
                  placeholder={`${label} kimliği (boş = varsayılan)`}
                  mono
                />
              ))}
            </div>
          )}

          {formData.selectedProvider === 'evren' && (
            <Toggle
              checked={formData.autoAcceptTerms === true}
              onChange={(value) => updateForm((prev) => ({ ...prev, autoAcceptTerms: value }), true)}
              title="EVREN kullanım koşullarını otomatik kabul et"
              description="Devre dışı bırakıldığında koşullar kabul edilene kadar model isteği gönderilmez."
              icon={<ShieldCheck className="ahi-icon-xs ahi-text-warning" />}
            />
          )}
        </Section>

        <Section>
          <SectionTitle icon={<ShieldCheck className="ahi-icon-xs" />} title="Onay ve izinler" />

          <Card muted className="flex items-start gap-2">
            <Info className="ahi-icon-xs mt-0.5 ahi-text-brand" />
            <p className="ahi-caption">
              Seçimler <strong>otomatik olarak kaydedilir</strong> ve anında uygulanır. Projedeki{' '}
              <code className="ahi-code-inline">.ahi/permissions.json</code> dosyası bu varsayılanları
              yalnızca daraltabilir; kapalı tuttuğunuz otomatik onayı açamaz. Hassas dosya korumaları,
              engelleme kuralları ve zincirli ya da riskli komutlar otomatik onaydan etkilenmez.
            </p>
          </Card>

          <Toggle
            checked={formData.autoApprove.readFiles}
            onChange={(value) =>
              updateForm(
                (prev) => ({ ...prev, autoApprove: { ...prev.autoApprove, readFiles: value } }),
                true
              )
            }
            title="Dosya okuma ve arama"
            description="Açıkken dosya okuma ve arama adımları otomatik onaylanır; kapalıyken onay istenir."
            icon={<FileCode2 className="ahi-icon-xs ahi-text-brand" />}
          />
          <Toggle
            checked={formData.autoApprove.writeFiles}
            onChange={(value) =>
              updateForm(
                (prev) => ({ ...prev, autoApprove: { ...prev.autoApprove, writeFiles: value } }),
                true
              )
            }
            title="Dosya yazma ve düzenleme"
            description="Açıkken dosya oluşturma ve düzenleme otomatik onaylanır; kapalıyken değişiklik öncesi onay istenir."
            icon={<Gauge className="ahi-icon-xs ahi-text-warning" />}
          />
          <Toggle
            checked={formData.autoApprove.executeCommands}
            onChange={(value) =>
              updateForm(
                (prev) => ({
                  ...prev,
                  autoApprove: { ...prev.autoApprove, executeCommands: value }
                }),
                true
              )
            }
            title="Terminal komutları, testler ve lint"
            description="Açıkken güvenli komutlar, filtreler ve inceleme zincirleri otomatik onaylanır. Silme, dosya üzerine yazma ve git geçmişi değiştirme her zaman onay ister."
            icon={<HardDrive className="ahi-icon-xs ahi-text-success" />}
          />
        </Section>

        <Section>
          <SectionTitle icon={<BookOpen className="ahi-icon-xs" />} title="Bilgi tabanı ve hafıza" />
          <Toggle
            checked={formData.knowledgeEmbeddings?.enabled === true}
            onChange={(value) =>
              updateForm(
                (prev) => ({
                  ...prev,
                  knowledgeEmbeddings: {
                    enabled: value,
                    model: prev.knowledgeEmbeddings?.model || 'nomic-embed-text'
                  }
                }),
                true
              )
            }
            title="Anlamsal arama (yerel embedding)"
            description="Bilgi tabanı aramalarını Ollama üzerindeki bir embedding modeliyle anlamsal eşleştirmeyi ekler. Varsayılan kapalı; her şey makinenizde kalır."
            icon={<Brain className="ahi-icon-xs ahi-text-brand" />}
          />
          {formData.knowledgeEmbeddings?.enabled && (
            <TextField
              type="text"
              aria-label="Embedding modeli"
              value={formData.knowledgeEmbeddings?.model || ''}
              onChange={(e) =>
                updateForm(
                  (prev) => ({
                    ...prev,
                    knowledgeEmbeddings: {
                      enabled: true,
                      model: e.target.value
                    }
                  }),
                  false
                )
              }
              placeholder="nomic-embed-text"
              mono
            />
          )}
        </Section>

        <Section>
          <SectionTitle icon={<HardDrive className="ahi-icon-xs" />} title="Yalıtılmış ortam" />
          <Toggle
            checked={sandboxMode === 'docker'}
            onChange={(value) =>
              updateForm(
                (prev) => ({
                  ...prev,
                  sandbox: {
                    mode: value ? 'docker' : 'none',
                    image: prev.sandbox?.image || 'node:20-bookworm',
                    network: prev.sandbox?.network ?? false
                  }
                }),
                true
              )
            }
            title="Docker yalıtılmış ortamı"
            description="Etkinleştirildiğinde komutlar ağ erişimi olmayan bir kapsayıcıda çalışır. Docker kurulu olmalıdır."
            icon={<HardDrive className="ahi-icon-xs ahi-text-success" />}
          />
          {sandboxMode === 'docker' && (
            <>
              <TextField
                type="text"
                aria-label="Docker imajı"
                value={formData.sandbox?.image || ''}
                onChange={(e) =>
                  updateForm(
                    (prev) => ({
                      ...prev,
                      sandbox: {
                        mode: 'docker',
                        image: e.target.value,
                        network: prev.sandbox?.network ?? false
                      }
                    }),
                    false
                  )
                }
                placeholder="Docker imajı (örn. node:20-bookworm)"
                mono
              />
              <Toggle
                checked={formData.sandbox?.network === true}
                onChange={(value) =>
                  updateForm(
                    (prev) => ({
                      ...prev,
                      sandbox: {
                        mode: prev.sandbox?.mode || 'docker',
                        image: prev.sandbox?.image || 'node:20-bookworm',
                        network: value
                      }
                    }),
                    true
                  )
                }
                title="Yalıtılmış ortamın ağ erişimi"
                description="Devre dışı bırakıldığında kapsayıcı ağa erişemez."
                icon={<Globe className="ahi-icon-xs ahi-text-brand" />}
              />
            </>
          )}
        </Section>

        <Card className="flex flex-col gap-2">
          <div className="text-xs flex items-center gap-1.5 font-semibold">
            <Info className="ahi-icon-xs ahi-text-brand" /> Hakkında
          </div>
          <p className="ahi-caption">
            AhiCode bağımsız olarak geliştirilen açık kaynaklı bir VS Code ajanıdır. Savunma Sanayii
            Başkanlığı ile bağlantısı yoktur. API anahtarları VS Code SecretStorage içinde şifrelenerek
            saklanır.
          </p>
          {onOpenAbout && (
            <Button
              variant="secondary"
              size="xs"
              block
              onClick={onOpenAbout}
              icon={<Info className="ahi-icon-xs" />}
            >
              Hakkında ekranını aç
            </Button>
          )}
        </Card>
      </div>
    </div>
  );
};
