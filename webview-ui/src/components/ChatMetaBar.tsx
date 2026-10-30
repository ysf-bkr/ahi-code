import React, { useMemo } from 'react';
import { Gauge, RefreshCw, Zap } from 'lucide-react';
import { EvrenQuota, ModelProviderType, UserSettings } from '@shared/types';
import { IconButton, Select } from './ui';

export interface ChatMetaBarProps {
  settings: UserSettings;
  models: string[];
  quota?: EvrenQuota;
  quotaError?: string;
  loadingQuota?: boolean;
  onRefreshQuota: () => void;
  onModelChange: (model: string) => void;
}

const PROVIDER_LABEL: Record<ModelProviderType, string> = {
  evren: 'EVREN',
  ollama: 'Ollama',
  openrouter: 'OpenRouter',
  'openai-compatible': 'OpenAI uyumlu'
};

/** Token sayısını kısa, okunabilir biçimde yazar (15.000.000 → 15M). */
export function formatTokens(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}B`;
  return String(value);
}

/** Günlük kotanın yüzdesi; sınır yoksa null. */
export function dailyUsagePercent(quota?: EvrenQuota): number | null {
  if (!quota || quota.dailyUsedTokens === null || !quota.dailyLimitTokens) return null;
  return Math.min(100, Math.max(0, Math.round((quota.dailyUsedTokens / quota.dailyLimitTokens) * 100)));
}

const percentTone = (percent: number): string => {
  if (percent >= 90) return 'ahi-text-error';
  if (percent >= 75) return 'ahi-text-warning';
  return 'ahi-text-success';
};

/**
 * Sohbet alanının altındaki ince bilgi çubuğu.
 *
 * Model seçimi buraya taşındı; üstbilgi yalnızca görev durumunu gösterir.
 * EVREN seçiliyken günlük token kotası ve kalan hak aynı satırda görünür.
 */
export const ChatMetaBar: React.FC<ChatMetaBarProps> = ({
  settings,
  models,
  quota,
  quotaError,
  loadingQuota = false,
  onRefreshQuota,
  onModelChange
}) => {
  const percent = dailyUsagePercent(quota);
  const options = useMemo(() => {
    const current = settings.selectedModel;
    const list = models.length > 0 ? models : current ? [current] : [];
    return list.includes(current) || !current ? list : [current, ...list];
  }, [models, settings.selectedModel]);

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 pb-1 text-2xs ahi-text-muted">
      <span className="flex items-center gap-1">
        <Zap className="ahi-icon-xs" aria-hidden="true" />
        {PROVIDER_LABEL[settings.selectedProvider]}
      </span>

      <Select
        aria-label="Model seçimi"
        value={settings.selectedModel}
        onChange={(event) => onModelChange(event.target.value)}
        className="!min-h-0 !w-auto max-w-[190px] !py-0.5 text-2xs"
      >
        {options.length === 0 && <option value="">model yok</option>}
        {options.map((model) => (
          <option key={model} value={model}>
            {model}
          </option>
        ))}
      </Select>

      {settings.selectedProvider === 'evren' && (
        <>
          <span className="ahi-divider ahi-divider--vertical" aria-hidden="true" />
          <span className="flex items-center gap-1" title={quotaError || 'EVREN günlük token kotası'}>
            <Gauge className="ahi-icon-xs" aria-hidden="true" />
            {percent === null ? (
              <span>{quotaError ? 'kota okunamadı' : 'kota yok'}</span>
            ) : (
              <span className={percentTone(percent)}>
                Günlük %{percent} · {formatTokens(quota?.dailyUsedTokens)}/
                {formatTokens(quota?.dailyLimitTokens)}
                {' · kalan '}
                {formatTokens(quota?.dailyRemainingTokens)}
              </span>
            )}
          </span>
          {percent !== null && (
            <span className="h-1 w-16 overflow-hidden rounded-full ahi-bg-track" aria-hidden="true">
              <span
                className={`block h-full ${percent >= 90 ? 'ahi-bg-error-solid' : percent >= 75 ? 'ahi-bg-warning' : 'ahi-bg-success-solid'}`}
                style={{ width: `${percent}%` }}
              />
            </span>
          )}
          <IconButton
            label="Kotayı yenile"
            small
            onClick={onRefreshQuota}
            disabled={loadingQuota}
            className={loadingQuota ? 'opacity-60' : ''}
          >
            <RefreshCw className={`ahi-icon-xs ${loadingQuota ? 'animate-spin' : ''}`} />
          </IconButton>
        </>
      )}
    </div>
  );
};
