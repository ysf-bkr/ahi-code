import { AgentMode, ToolName } from '../../shared/types';

/** Çağrı haritası araçları: tamamen salt-okunur, her aşamada güvenli. */
const CALLGRAPH_TOOL_NAMES = [
  'get_callers',
  'get_callees',
  'call_graph_impact',
  'find_related_code',
  'call_graph_status'
] as const satisfies readonly ToolName[];

/**
 * Planlama modunda yalnızca salt-okunur/analiz araçları açıktır.
 * Kod yazma, dosya değiştirme ve komut çalıştırma teknik olarak kilitlidir.
 */
export const PLAN_MODE_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>([
  'read_file',
  'list_directory',
  'search_files',
  'git_status',
  'git_diff',
  'get_diagnostics',
  'get_definition',
  'get_hover',
  'read_skill',
  'ask_followup_question',
  'update_plan',
  'update_module_plan',
  'get_references',
  'get_workspace_symbols',
  'index_workspace',
  'find_symbol',
  'analyze_impact',
  'prepare_pr',
  'web_fetch',
  'web_search',
  'search_memory',
  'read_notebook',
  // Spec yazımı ve bilgi tabanı sorguları proje kaynak dosyalarına dokunmaz.
  'write_spec',
  'get_project_knowledge',
  'add_knowledge_note',
  'write_knowledge_file',
  // Çağrı haritası araçları salt-okunur ve anlama/planlama aşamalarında en
  // çok burada gerekir; kod yazma kilidini etkilemezler.
  ...CALLGRAPH_TOOL_NAMES,
  // Tek uzmana devretme yazmaz: alt ajan okuma aşamasında salt-okunur araç
  // setiyle çalışır. Paralel görevler izole worktree açar; okuma için gereksiz.
  'invoke_subagent'
]);

/**
 * Salt-okunur araçlar ve spec yazımı. Plan onaylanmadan önce kullanılır.
 */
export const INTAKE_MODE_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>([...PLAN_MODE_TOOLS]);

/** Komut çalıştıran araçlar; dosya yazımından daha erken kilitlenir. */
const COMMAND_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>([
  'execute_command',
  'run_tests',
  'run_linter',
  'run_verification'
]);

/**
 * Okuma aşamasında serbest olan devretme aracı. Devretme yazmaz; alt ajan
 * salt-okunur araç setiyle çalıştırılır, böylece aşama kilidi atlanmaz.
 * Paralel görevler izole worktree açtığı için okuma aşamasında açılmaz.
 */
const DELEGATION_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>(['invoke_subagent']);

export function isDelegationTool(toolName: ToolName | string): boolean {
  return DELEGATION_TOOLS.has(toolName as ToolName);
}

export function isToolAllowedInMode(toolName: ToolName | string, mode: AgentMode): boolean {
  if (mode === 'plan') {
    return PLAN_MODE_TOOLS.has(toolName as ToolName);
  }
  return true;
}

/**
 * Plan modu kilidini ve iş akışı aşama kilidini birlikte uygular.
 * Plan onaylanmadan önce yalnızca salt-okunur ve spec araçları sunulur.
 */
export function isToolAllowed(
  toolName: ToolName | string,
  mode: AgentMode,
  options: { workflowReadOnly?: boolean; allowCommands?: boolean } = {}
): boolean {
  if (!isToolAllowedInMode(toolName, mode)) return false;
  if (options.workflowReadOnly && !INTAKE_MODE_TOOLS.has(toolName as ToolName)) {
    // Okuma aşamalarında devretme serbesttir; alt ajan yalnızca salt-okunur araç
    // setiyle çalıştırılır, böylece aşama kilidi atlanmış olmaz.
    return isDelegationTool(toolName);
  }
  if (options.allowCommands === false && COMMAND_TOOLS.has(toolName as ToolName)) return false;
  return true;
}

/**
 * Modele sunulacak araçları mevcut mod ve iş akışı aşamasına göre filtreler.
 */
export function filterToolsForMode<T extends { name: ToolName | string }>(
  tools: T[],
  mode: AgentMode,
  options: { workflowReadOnly?: boolean; allowCommands?: boolean } = {}
): T[] {
  return tools.filter((tool) => isToolAllowed(tool.name, mode, options));
}
