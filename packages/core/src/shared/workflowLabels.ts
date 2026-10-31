import { WorkflowStage } from './types';

/**
 * Aşama etiketleri ve kısa ipuçları.
 *
 * Hem uzantı çekirdeği hem de webview aynı metinleri kullanır; bu yüzden
 * sunum metinleri saf `shared` katmanında tutulur. Webview çekirdeğe
 * bağımlı olmadan etiketi buradan okur.
 */
export const STAGE_INFO: Record<WorkflowStage, { label: string; hint: string }> = {
  onboard: { label: 'Anlama', hint: 'Projeyi ve mevcut durumu anlama' },
  intake: { label: 'İstek', hint: 'Gereksinimleri netleştirme, sorular' },
  spec: { label: 'Spec', hint: 'Hedef, kapsam ve kabul kriterleri onayı' },
  plan: { label: 'Plan', hint: 'Katmanlı modül haritası ve uygulama planı onayı' },
  build: { label: 'Uygulama', hint: 'Kod yazma ve komut çalıştırma' },
  review: { label: 'İnceleme', hint: 'Değişiklikleri ve planı gözden geçirme' },
  verify: { label: 'Doğrulama', hint: 'Test, lint ve tip denetimi' },
  done: { label: 'Bitti', hint: 'Görev tamamlandı' }
};

export function stageLabel(stage: WorkflowStage): string {
  return STAGE_INFO[stage].label;
}

export function stageHint(stage: WorkflowStage): string {
  return STAGE_INFO[stage].hint;
}
