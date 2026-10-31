import { ToolName } from '../../shared/types';

/**
 * Araç onay politikası: switch yerine veri tablosu.
 *
 * Onay motoru her araç için üç bilgiye ihtiyaç duyar: hangi otomatik onay
 * anahtarının geçerli olduğu, proje `allow` listesinin daraltıp
 * daraltamayacağı ve aracın normal akıştan muaf olup olmadığı. Bunu tabloda
 * tutmak öncelik kurallarını denetlenebilir kılar ve yeni araç eklendiğinde
 * unutulmasını engeller.
 */

/** Onay motorunun kullandığı gruplar; her biri tek karar kuralına karşılık gelir. */
export type ToolPolicyKind =
  | 'read' // ucuz, salt-okunur: autoApprove.readFiles yönetir
  | 'write' // dosya değiştirir: autoApprove.writeFiles yönetir
  | 'git-write' // depoyu değiştirir: autoApprove.writeFiles gerekir
  | 'command' // kabuk erişimi: önce komut risk politikası karar verir
  | 'always' // tasarım gereği asla otomatik onaylanmaz (ağ, kalıcı istem kanalları)
  | 'delegate' // görev devri: otonom modda akışı durdurmaz, güvenlik alt ajanda kalır
  | 'never' // yönlendirilmiş akış ya da salt kayıt: onay yok
  | 'unknown'; // tabloda yok: güvenli tarafa düş

const POLICIES: Partial<Record<ToolName, ToolPolicyKind>> = {
  // Salt-okunur araçlar.
  read_file: 'read',
  list_directory: 'read',
  search_files: 'read',
  git_status: 'read',
  git_diff: 'read',
  get_diagnostics: 'read',
  get_definition: 'read',
  get_hover: 'read',
  read_skill: 'read',
  get_project_knowledge: 'read',
  search_memory: 'read',
  // Sembol/fark analizi. Önceden listede yoktu ve yalnızca çalışma alanını
  // incelediği hâlde her çağrıda onay istiyordu.
  get_references: 'read',
  get_workspace_symbols: 'read',
  find_symbol: 'read',
  analyze_impact: 'read',
  prepare_pr: 'read',
  read_notebook: 'read',
  // Yalnızca `.ahi/knowledge/` altındaki türev önbelleği yazar, kullanıcı kodunu değil.
  index_workspace: 'read',
  // Çağrı haritası araçları tamamen salt-okunur; plan modunda da açıktır.
  get_callers: 'read',
  get_callees: 'read',
  call_graph_impact: 'read',
  find_related_code: 'read',
  call_graph_status: 'read',

  // Dosya değişiklikleri. `write_spec` ve `update_acceptance_criteria` de
  // yazma aracıdır ama yalnızca `.ahi/specs/` üst verisine dokunur ve
  // yönlendirilmiş akışa aittir; aşağıda muaftır.
  write_file: 'write',
  edit_file: 'write',
  write_spec: 'write',
  update_acceptance_criteria: 'write',

  // Depo değişiklikleri yazma anahtarını paylaşır.
  git_create_branch: 'git-write',
  git_commit: 'git-write',
  merge_worktree: 'git-write',

  // Kabuk erişimi: önce komut politikası her komutu sınıflandırır.
  execute_command: 'command',
  run_tests: 'command',
  run_linter: 'command',
  run_verification: 'command',

  // Kalıcı istem kanalları: notlar ve küratörlü dosyalar sonraki her isteme
  // girer, bu yüzden yazma anahtarına uymaz, her zaman onay ister.
  add_knowledge_note: 'always',
  write_knowledge_file: 'always',

  // Her zaman açık onay kartı ister.
  web_fetch: 'always',
  web_search: 'always',
  // Devretme bir güvenlik kapısı değil, akış adımıdır: alt ajanın yazma/komut
  // işlemleri yine kendi onay kuralına tabidir. `manual` modda yine sorulur.
  invoke_subagent: 'delegate',
  run_parallel_tasks: 'delegate',

  // Yönlendirilmiş akış ve kayıt araçları hiç onay istemez.
  ask_followup_question: 'never',
  update_plan: 'never',
  update_module_plan: 'never',
  undo_change: 'never'
};

/**
 * Yazma anahtarı açıkken bile onaysız kalan araçlar: spec taslağı yazmak ya da
 * bir kriteri işaretlemek üst veri onayıyla engellenmemeli.
 */
const FLOW_METADATA_TOOLS: ReadonlySet<ToolName> = new Set(['write_spec', 'update_acceptance_criteria']);

/** Aracın politika türünü döndürür; eşleşme yoksa onay isteyen tarafa düşer. */
export function policyFor(toolName: ToolName): ToolPolicyKind {
  return POLICIES[toolName] ?? 'unknown';
}

/** Araç yönlendirilmiş akış gerekçesiyle onaydan muaf mı? */
export function isFlowMetadataTool(toolName: ToolName): boolean {
  return FLOW_METADATA_TOOLS.has(toolName);
}

/**
 * Argümanlarında allow listelerinin karşılaştırılacağı hedef yol taşıyan
 * araçlar ve o yolun okunacağı alan.
 */
export function targetPathFor(toolName: ToolName, args: Record<string, unknown>): string {
  if (toolName === 'read_skill') return String(args.skill_name || '');
  return String(args.path || '');
}
