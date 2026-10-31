import type { ToolName } from '../types';

export type AgentTier = 'supreme' | 'core' | 'recon';

export type AgentTag =
  | 'core'
  | 'orchestration'
  | 'governance'
  | 'security'
  | 'design'
  | 'logic'
  | 'ui'
  | 'mobile'
  | 'native'
  | 'audit'
  | 'discipline'
  | 'data'
  | 'infra'
  | 'recon'
  | 'logistics'
  | 'strategy';

export interface AgentInstructions {
  /** Ajana kişiliği olarak sunulan tek satırlık kimlik ifadesi. */
  identity: string;
  /** Ajanın birincil görev hedefi. */
  mission: string;
  /** Ajanın uymak zorunda olduğu Chain of Thought protokolü. */
  chainOfThought: string;
  /** Ajanın uygulaması gereken zorunlu, sıralı disiplin kuralları. */
  rules: string[];
  /** İsteğe bağlı başvuru bilgi dosyası adları. */
  knowledgeFiles?: string[];
}

export interface AgentDefinition {
  /** Makine tanımlayıcısı — yönlendirme ve invoke_subagent hedeflerinde kullanılır. */
  name: string;
  displayName: string;
  role: string;
  description: string;
  /** UI'da kullanılan Türkçe görünen ad. */
  uiName?: string;
  /** UI kartında kullanılan Türkçe açıklama. */
  uiDescription?: string;
  /** Yetenek puanı 1–10. */
  capability: 10 | 9 | 8;
  tier: AgentTier;
  tags: AgentTag[];
  /**
   * Ajanın kullanabileceği araçlar. Tek doğruluk kaynağı burasıdır:
   * `SubagentManager` bu listeyi doğrudan kayıt defterine eşler.
   */
  tools: ToolName[];
  instructions: AgentInstructions;
  specialties?: Record<string, number>;
}

export interface SubagentRoleInfo {
  role: string;
  name: string;
  description: string;
  tier?: AgentTier;
  capability?: 10 | 9 | 8;
  tags?: readonly AgentTag[];
}
