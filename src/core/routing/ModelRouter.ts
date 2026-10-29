import { AgentMode, UserSettings } from '../../shared/types';

export type TaskComplexity = 'simple' | 'standard' | 'complex' | 'review';

export interface RoutingDecision {
  model: string;
  complexity: TaskComplexity;
  reason: string;
  routed: boolean;
}

const COMPLEX_PATTERNS = [
  /\barchitecture\b|mimari/i,
  /\brefactor|restructure|large-scale\b|yeniden düzenle|refaktör/i,
  /\bsecurity|audit|review\b|güvenlik|denetim|incele/i,
  /\bperformance|optimiz/i,
  /\bdatabase|migration|schema\b|veritabanı|şema|taşıma/i,
  /\bmultiple|parallel|orchestrat|worktree\b|çoklu|paralel|orkestr/i,
  /\bplan|design|analyz/i
];

const REVIEW_PATTERNS = [
  /\bcode review|review code|perform a review\b|kod incelemesi|kodu incele/i,
  /\bpr\b|pull request|merge request/i
];

const SIMPLE_PATTERNS = [
  /^(hello|hi|thanks|thank you|how are you|merhaba|selam|teşekkür)/i,
  /\b(explain|what is|what does .* mean|briefly)\b|kısaca|açıkla/i,
  /\b(one line|small|simple|minor)\b|küçük|basit|ufak/i,
  /\b(typo|add a comment)\b|yazım hatası|yorum ekle/i
];

/**
 * Görev karmaşıklığını sezgisel olarak sınıflandırır.
 * Yalnızca model seçimi kaliteyi garanti etmez, bu yüzden yönlendirme
 * ancak kullanıcı etkinleştirdiğinde çalışır.
 */
export function classifyTask(prompt: string, mode: AgentMode = 'code'): TaskComplexity {
  const text = String(prompt || '');
  if (REVIEW_PATTERNS.some((pattern) => pattern.test(text))) return 'review';
  if (mode === 'plan') return 'complex';
  if (COMPLEX_PATTERNS.some((pattern) => pattern.test(text))) return 'complex';
  if (text.length > 1_500) return 'complex';
  if (SIMPLE_PATTERNS.some((pattern) => pattern.test(text)) && text.length < 400) return 'simple';
  return 'standard';
}

export class ModelRouter {
  public route(prompt: string, mode: AgentMode, settings: UserSettings): RoutingDecision {
    const complexity = classifyTask(prompt, mode);
    const routing = settings.modelRouting;
    const selected = settings.selectedModel || 'auto';

    if (!routing?.enabled) {
      return {
        model: selected,
        complexity,
        reason: 'Model routing is disabled; using the selected model.',
        routed: false
      };
    }

    const fallback = selected !== 'auto' ? selected : undefined;
    const modelByComplexity: Record<TaskComplexity, string | undefined> = {
      simple: routing.fastModel || fallback,
      standard: routing.fastModel || routing.deepModel || fallback,
      complex: routing.deepModel || fallback,
      review: routing.reviewModel || routing.deepModel || fallback
    };

    const model = modelByComplexity[complexity];
    if (!model) {
      return {
        model: selected,
        complexity,
        reason: 'No suitable routing model is configured; using the default model.',
        routed: false
      };
    }

    const reasonByComplexity: Record<TaskComplexity, string> = {
      simple: 'Simple task → fast/low-cost model.',
      standard: 'Standard task → balanced model.',
      complex: 'Complex analysis/implementation → powerful reasoning model.',
      review: 'Code review → independent review model.'
    };

    return {
      model,
      complexity,
      reason: reasonByComplexity[complexity],
      routed: model !== selected
    };
  }
}
