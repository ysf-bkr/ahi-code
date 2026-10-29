import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  ShieldCheck,
  HardDrive,
  Info,
  Zap,
  Globe,
  CheckCircle2,
  Gauge,
  FileCode2,
  BookOpen,
  Brain
} from 'lucide-react';
import { ModelProviderType, UserSettings } from '@shared/types';
import { ScreenHeader } from './ScreenHeader';
import { vscode } from '../utils/vscode';
import { Button, Card, ListButton, Section, SectionTitle, TextField, Toggle } from './ui';
import { PROVIDERS, ProviderSection } from './SettingsProviderSection';

interface SettingsViewProps {
  settings: UserSettings;
  onBack: () => void;
  onOpenAbout?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ settings, onBack, onOpenAbout }) => {
  const [formData, setFormData] = useState<UserSettings>(settings);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  // Kaydedilmemiş değişikliklerle çıkış için iki adımlı satır içi onay. VS Code
  // webview'leri `allow-modals` olmadan korumalı alanda çalışır; bu yüzden
  // `window.confirm()` hiçbir iletişim kutusu göstermez ve her zaman false
  // döner — "Geri" çalışmıyor gibi görünüyordu.
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsLoadedMsg, setModelsLoadedMsg] = useState<string | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Zamanlayıcılar ve ilk getirme, geri çağrı oluşturulduğunda yakalanan
  // anlık görüntüyü değil *güncel* formu okumalı.
  const formRef = useRef(formData);
  formRef.current = formData;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  /** Formu yazar ve kaydedilmemiş olarak işaretler. */
  const updateForm = (next: UserSettings | ((prev: UserSettings) => UserSettings)) => {
    setFormData(next);
    setDirty(true);
  };

  // Bir ayar güncellemesi kullanıcının yazdığını silmemeli. Yalnızca
  // dokunulmamış form dış değişiklikleri takip eder.
  useEffect(() => {
    if (!dirtyRef.current) setFormData(settings);
  }, [settings]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
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
    // Yalnızca mount'ta bir kez çalışır; sonraki sağlayıcı değişimleri
    // triggerFetchModels'i doğrudan çağırır.
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type !== 'MODELS_LOADED') return;
      // Yanıt, kullanıcının çoktan geçtiği bir sağlayıcıya ait olsa bile
      // dönen simgeyi temizle; yoksa sonsuza kadar açık kalıyordu.
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
        // Kullanıcının özel model kimliğini otomatik üzerine yazma.
      }
      if (msg.payload.error) {
        setModelsError(msg.payload.error);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [formData.selectedModel, formData.selectedProvider]);

  const handleApiKeyChange = (provider: 'evren' | 'openrouter' | 'openaiCompatible', key: string) => {
    updateForm((prev) => ({
      ...prev,
      apiKeys: { ...prev.apiKeys, [provider]: key }
    }));

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
    updateForm((prev) => ({
      ...prev,
      apiKeys: { ...prev.apiKeys, [provider]: '' },
      apiKeyStatus: prev.apiKeyStatus ? { ...prev.apiKeyStatus, [provider]: false } : undefined
    }));
  };

  const handleProviderChange = (provider: ModelProviderType) => {
    const meta = PROVIDERS.find((item) => item.id === provider);
    const updated: UserSettings = {
      ...formData,
      selectedProvider: provider,
      selectedModel: meta?.defaultModel || formData.selectedModel
    };
    updateForm(updated);
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

  const handleSave = () => {
    vscode.postMessage({ type: 'SAVE_SETTINGS', payload: formData });
    setDirty(false);
    setConfirmLeave(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  };

  const handleBack = () => {
    // Kaydedilmemiş değişikliklerle çıkmak açık bir onay ister.
    if (dirty && !confirmLeave) {
      setConfirmLeave(true);
      setTimeout(() => setConfirmLeave(false), 4000);
      return;
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
        subtitle={dirty ? 'Kaydedilmemiş değişiklikler var' : 'Model, API ve güvenlik tercihleri'}
        onBack={handleBack}
        actions={
          <Button
            variant="primary"
            size="xs"
            onClick={handleSave}
            icon={saved ? <Check className="h-3 w-3" /> : undefined}
          >
            {saved ? 'Kaydedildi' : 'Kaydet'}
          </Button>
        }
      />

      <div className="ahi-screen-body">
        {dirty && confirmLeave && (
          <Card className="flex flex-col gap-2 border-[var(--status-warning-border)]">
            <p className="ahi-caption">Kaydedilmemiş değişiklikler var. Kaydetmeden çıkılsın mı?</p>
            <div className="flex items-center gap-1.5">
              <Button variant="danger" size="xs" onClick={() => onBack()}>
                Kaydetmeden çık
              </Button>
              <Button
                variant="secondary"
                size="xs"
                onClick={() => {
                  setConfirmLeave(false);
                  handleSave();
                }}
              >
                Kaydet ve çık
              </Button>
              <Button variant="ghost" size="xs" onClick={() => setConfirmLeave(false)}>
                Vazgeç
              </Button>
            </div>
          </Card>
        )}
        <ProviderSection
          formData={formData}
          updateForm={updateForm}
          onProviderChange={handleProviderChange}
          onApiKeyChange={handleApiKeyChange}
          onClearApiKey={handleClearApiKey}
          onFetchModels={() =>
            triggerFetchModels(
              formData.selectedProvider,
              formData.selectedProvider === 'openai-compatible'
                ? formData.apiKeys.openaiCompatible
                : formData.selectedProvider === 'openrouter'
                  ? formData.apiKeys.openrouter
                  : formData.apiKeys.evren,
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
          modelsError={modelsError}
          modelsLoadedMsg={modelsLoadedMsg}
        />

        <Section>
          <SectionTitle icon={<Gauge className="h-3 w-3" />} title="Otonomi" />

          <Card muted className="flex items-start gap-2">
            <Info className="text-xs mt-0.5 h-3 w-3 shrink-0 text-[var(--ahi-brand-400)]" />
            <p className="ahi-caption">
              Otonomi yalnızca <strong>akış</strong> duraklamalarını kaldırır. Dosya yazma, komut çalıştırma,
              riskli komut engeli ve hassas dosya korumaları her seviyede aynı kalır.
            </p>
          </Card>

          <div className="flex flex-col gap-1.5">
            {(
              [
                ['manual', 'Elle', 'Her spec ve plan için onay istenir.'],
                [
                  'guided',
                  'Yönlendirilmiş',
                  'Spec ve plan otomatik onaylanır; yazma/komut izinleri sorulur.'
                ],
                [
                  'auto',
                  'Otonom',
                  'Görev bitene kadar turlar kendiliğinden sürer; güvenlik onayları yine sorulur.'
                ]
              ] as const
            ).map(([value, label, description]) => (
              <ListButton
                key={value}
                type="button"
                onClick={() => updateForm((prev) => ({ ...prev, autonomy: value }))}
                active={(formData.autonomy ?? 'manual') === value}
                aria-pressed={(formData.autonomy ?? 'manual') === value}
                title={label}
                description={description}
                trailing={
                  (formData.autonomy ?? 'manual') === value ? (
                    <Check className="h-3 w-3 text-[var(--ahi-brand-400)]" />
                  ) : undefined
                }
              />
            ))}
          </div>
        </Section>

        <Section>
          <SectionTitle icon={<ShieldCheck className="h-3 w-3" />} title="Doğrulama ve yönlendirme" />

          <Toggle
            checked={formData.autoVerify !== false}
            onChange={(value) => updateForm((prev) => ({ ...prev, autoVerify: value }))}
            title="Otomatik doğrulama"
            description="Dosya değişikliklerinden sonra izin verilen test ve lint komutlarını çalıştır."
            icon={<ShieldCheck className="h-3 w-3 text-emerald-400" />}
          />
          <Toggle
            checked={formData.promptCaching !== false}
            onChange={(value) => updateForm((prev) => ({ ...prev, promptCaching: value }))}
            title="Prompt önbelleği"
            description="Sistem prompt'u ve araç şemalarını sağlayıcı tarafında önbelleğe alır; tekrarlanan ön ek daha az token faturalanır."
            icon={<Zap className="h-3 w-3 text-[var(--ahi-brand-400)]" />}
          />
          <Toggle
            checked={formData.captureBaseline === true}
            onChange={(value) => updateForm((prev) => ({ ...prev, captureBaseline: value }))}
            title="Başlangıç test durumunu kaydet"
            description="Görev öncesindeki hataları kaydet; yalnızca yeni regresyonları düzelt."
            icon={<CheckCircle2 className="h-3 w-3 text-[var(--ahi-brand-400)]" />}
          />

          <div className="grid grid-cols-2 gap-1.5">
            <TextField
              label="Onarım denemesi"
              type="number"
              min={0}
              max={10}
              value={formData.maxRepairAttempts ?? 2}
              onChange={(e) =>
                updateForm((prev) => ({ ...prev, maxRepairAttempts: Number(e.target.value) || 0 }))
              }
            />
            <TextField
              label="Adım sınırı"
              type="number"
              min={1}
              max={200}
              value={formData.maxStepsPerTask ?? 25}
              onChange={(e) =>
                updateForm((prev) => ({ ...prev, maxStepsPerTask: Number(e.target.value) || 1 }))
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <TextField
              label="Token bütçesi"
              type="number"
              min={0}
              value={formData.maxTokensPerTask ?? 0}
              onChange={(e) =>
                updateForm((prev) => ({
                  ...prev,
                  maxTokensPerTask: Math.max(0, Number(e.target.value) || 0)
                }))
              }
              hint="Görev başına toplam token sınırı (0 = sınırsız). Sınıra ulaşılınca görev duraklatılır."
            />
            <TextField
              label="Otomatik devam sınırı"
              type="number"
              min={1}
              max={100}
              value={formData.maxContinuations ?? 12}
              onChange={(e) =>
                updateForm((prev) => ({
                  ...prev,
                  maxContinuations: Math.max(1, Number(e.target.value) || 1)
                }))
              }
              hint="Otonom modda art arda izin verilen otomatik devam turu sayısı."
            />
          </div>

          <Toggle
            checked={modelRouting.enabled === true}
            onChange={(value) =>
              updateForm((prev) => ({
                ...prev,
                modelRouting: { ...(prev.modelRouting || { enabled: false }), enabled: value }
              }))
            }
            title="Model yönlendirme"
            description="Basit görevlerde hızlı, karmaşık görevlerde güçlü bir model kullanır."
            icon={<Zap className="h-3 w-3 text-violet-400" />}
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
                    updateForm((prev) => ({
                      ...prev,
                      modelRouting: { ...(prev.modelRouting || { enabled: true }), [key]: e.target.value }
                    }))
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
              onChange={(value) => updateForm((prev) => ({ ...prev, autoAcceptTerms: value }))}
              title="EVREN kullanım koşullarını otomatik kabul et"
              description="Devre dışı bırakıldığında koşullar kabul edilene kadar model isteği gönderilmez."
              icon={<ShieldCheck className="h-3 w-3 text-amber-400" />}
            />
          )}
        </Section>

        <Section>
          <SectionTitle icon={<ShieldCheck className="h-3 w-3" />} title="Onay ve izinler" />

          <Card muted className="flex items-start gap-2">
            <Info className="text-xs mt-0.5 h-3 w-3 shrink-0 text-[var(--ahi-brand-400)]" />
            <p className="ahi-caption">
              Seçimler <strong>Kaydet</strong> ile uygulanır. Projedeki{' '}
              <code className="ahi-code-inline">.ahi/permissions.json</code> dosyası bu varsayılanları
              yalnızca daraltabilir; kapalı tuttuğunuz otomatik onayı açamaz. Hassas dosya korumaları,
              engelleme kuralları ve zincirli ya da riskli komutlar otomatik onaydan etkilenmez.
            </p>
          </Card>

          <Toggle
            checked={formData.autoApprove.readFiles}
            onChange={(value) =>
              updateForm((prev) => ({ ...prev, autoApprove: { ...prev.autoApprove, readFiles: value } }))
            }
            title="Dosya okuma ve arama"
            description="Açıkken dosya okuma ve arama adımları otomatik onaylanır; kapalıyken onay istenir."
            icon={<FileCode2 className="h-3 w-3 text-[var(--ahi-brand-400)]" />}
          />
          <Toggle
            checked={formData.autoApprove.writeFiles}
            onChange={(value) =>
              updateForm((prev) => ({ ...prev, autoApprove: { ...prev.autoApprove, writeFiles: value } }))
            }
            title="Dosya yazma ve düzenleme"
            description="Açıkken dosya oluşturma ve düzenleme otomatik onaylanır; kapalıyken değişiklik öncesi onay istenir."
            icon={<Gauge className="h-3 w-3 text-amber-400" />}
          />
          <Toggle
            checked={formData.autoApprove.executeCommands}
            onChange={(value) =>
              updateForm((prev) => ({
                ...prev,
                autoApprove: { ...prev.autoApprove, executeCommands: value }
              }))
            }
            title="Terminal komutları, testler ve lint"
            description="Açıkken yalnızca güvenli tekil komutlar otomatik onaylanır. Silme, git geçmişi değiştirme ve zincirli komutlar her zaman onay ister."
            icon={<HardDrive className="h-3 w-3 text-emerald-400" />}
          />
        </Section>

        <Section>
          <SectionTitle icon={<BookOpen className="h-3 w-3" />} title="Bilgi tabanı ve hafıza" />
          <Toggle
            checked={formData.knowledgeEmbeddings?.enabled === true}
            onChange={(value) =>
              updateForm((prev) => ({
                ...prev,
                knowledgeEmbeddings: {
                  enabled: value,
                  model: prev.knowledgeEmbeddings?.model || 'nomic-embed-text'
                }
              }))
            }
            title="Anlamsal arama (yerel embedding)"
            description="Bilgi tabanı aramalarını Ollama üzerindeki bir embedding modeliyle anlamsal eşleştirmeyi ekler. Varsayılan kapalı; her şey makinenizde kalır."
            icon={<Brain className="h-3 w-3 text-violet-400" />}
          />
          {formData.knowledgeEmbeddings?.enabled && (
            <TextField
              type="text"
              aria-label="Embedding modeli"
              value={formData.knowledgeEmbeddings?.model || ''}
              onChange={(e) =>
                updateForm((prev) => ({
                  ...prev,
                  knowledgeEmbeddings: {
                    enabled: true,
                    model: e.target.value
                  }
                }))
              }
              placeholder="nomic-embed-text"
              mono
            />
          )}
        </Section>

        <Section>
          <SectionTitle icon={<HardDrive className="h-3 w-3" />} title="Yalıtılmış ortam" />
          <Toggle
            checked={sandboxMode === 'docker'}
            onChange={(value) =>
              updateForm((prev) => ({
                ...prev,
                sandbox: {
                  mode: value ? 'docker' : 'none',
                  image: prev.sandbox?.image || 'node:20-bookworm',
                  network: prev.sandbox?.network ?? false
                }
              }))
            }
            title="Docker yalıtılmış ortamı"
            description="Etkinleştirildiğinde komutlar ağ erişimi olmayan bir kapsayıcıda çalışır. Docker kurulu olmalıdır."
            icon={<HardDrive className="h-3 w-3 text-emerald-400" />}
          />
          {sandboxMode === 'docker' && (
            <>
              <TextField
                type="text"
                aria-label="Docker imajı"
                value={formData.sandbox?.image || ''}
                onChange={(e) =>
                  updateForm((prev) => ({
                    ...prev,
                    sandbox: {
                      mode: 'docker',
                      image: e.target.value,
                      network: prev.sandbox?.network ?? false
                    }
                  }))
                }
                placeholder="Docker imajı (örn. node:20-bookworm)"
                mono
              />
              <Toggle
                checked={formData.sandbox?.network === true}
                onChange={(value) =>
                  updateForm((prev) => ({
                    ...prev,
                    sandbox: {
                      mode: prev.sandbox?.mode || 'docker',
                      image: prev.sandbox?.image || 'node:20-bookworm',
                      network: value
                    }
                  }))
                }
                title="Yalıtılmış ortamın ağ erişimi"
                description="Devre dışı bırakıldığında kapsayıcı ağa erişemez."
                icon={<Globe className="h-3 w-3 text-[var(--ahi-brand-400)]" />}
              />
            </>
          )}
        </Section>

        <Card className="flex flex-col gap-2">
          <div className="text-xs flex items-center gap-1.5 font-semibold">
            <Info className="h-3 w-3 text-[var(--ahi-brand-400)]" /> Hakkında
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
              icon={<Info className="h-2.5 w-2.5" />}
            >
              Hakkında ekranını aç
            </Button>
          )}
        </Card>
      </div>
    </div>
  );
};
