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
  /** One-line identity statement surfaced to the agent as its persona. */
  identity: string;
  /** The agent's primary mission objective. */
  mission: string;
  /** Chain of Thought protocol the agent must follow. */
  chainOfThought: string;
  /** Mandatory, ordered discipline rules the agent must enforce. */
  rules: string[];
  /** Optional reference knowledge file names. */
  knowledgeFiles?: string[];
}

export interface AgentDefinition {
  /** Machine identifier — used in routing and invoke_subagent targets. */
  name: string;
  displayName: string;
  role: string;
  description: string;
  /** Turkish display name used in the UI. */
  uiName?: string;
  /** Turkish description used in the UI card. */
  uiDescription?: string;
  /** Capability score 1–10. */
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
