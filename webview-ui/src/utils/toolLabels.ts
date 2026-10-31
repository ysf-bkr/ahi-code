/**
 * Araç adımlarının kullanıcıya Türkçe anlatımı.
 *
 * Araç tanımları ve kimlikleri İngilizce kalır (ilogcalama ve loglar için);
 * arayüzde ise her araç "ne oluyor" sorusunu yanıtlayan şimdiki zaman başlık
 * ve mümkün olan en anlamlı ayrıntıyla görünür. Eskiden yalnızca ~14 aracın
 * özel dalı vardı; diğer ~30 araç ham İngilizce kimliğiyle (`update_plan`,
 * `get_callers`) ve boş açıklamayla çiziliyordu.
 */
import { ToolCall, ToolName } from '@shared/types';
import { getAgentDefinition, BUILT_IN_SUBAGENT_ROLES } from '@shared/agents';

/** Her aracın şimdiki zaman Türkçe başlığı; ToolName birleşiminin tamamı kapsanır. */
export const TOOL_TITLES: Record<ToolName, string> = {
  read_file: 'Dosya okunuyor',
  write_file: 'Dosya oluşturuluyor',
  edit_file: 'Dosya düzenleniyor',
  search_files: 'Kod aranıyor',
  list_directory: 'Klasör taranıyor',
  execute_command: 'Terminal komutu',
  run_tests: 'Testler çalıştırılıyor',
  run_linter: 'Kod denetleyicisi çalıştırılıyor',
  git_diff: 'Git farkı alınıyor',
  git_status: 'Git durumu okunuyor',
  invoke_subagent: 'Alt ajan görevlendiriliyor',
  ask_followup_question: 'Kullanıcıya soru soruluyor',
  read_skill: 'Beceri okunuyor',
  get_diagnostics: 'Tanılar inceleniyor',
  get_definition: 'Tanıma gidiliyor',
  get_hover: 'İmza bilgisi okunuyor',
  undo_change: 'Değişiklik geri alınıyor',
  update_plan: 'Plan güncelleniyor',
  update_module_plan: 'Modül haritası güncelleniyor',
  run_verification: 'Doğrulama çalıştırılıyor',
  get_references: 'Kullanımlar aranıyor',
  get_workspace_symbols: 'Çalışma alanı sembolleri listeleniyor',
  index_workspace: 'Çalışma alanı indeksleniyor',
  find_symbol: 'Sembol aranıyor',
  analyze_impact: 'Etki analizi yapılıyor',
  git_create_branch: 'Git dalı oluşturuluyor',
  git_commit: 'Git değişikliği kaydediliyor',
  prepare_pr: 'PR hazırlanıyor',
  web_fetch: 'Web sayfası getiriliyor',
  web_search: "Web'de aranıyor",
  search_memory: 'Bellekte aranıyor',
  read_notebook: 'Defter okunuyor',
  run_parallel_tasks: 'Paralel görevler çalıştırılıyor',
  merge_worktree: 'Worktree birleştiriliyor',
  write_spec: 'Şartname yazılıyor',
  update_acceptance_criteria: 'Kabul kriterleri güncelleniyor',
  write_knowledge_file: 'Bilgi dosyası yazılıyor',
  get_project_knowledge: 'Proje bilgisi sorgulanıyor',
  add_knowledge_note: 'Bilgi notu ekleniyor',
  get_callers: 'Çağıran fonksiyonlar bulunuyor',
  get_callees: 'Çağrılan fonksiyonlar bulunuyor',
  call_graph_impact: 'Çağrı grafiği etkisi çıkarılıyor',
  find_related_code: 'İlgili kod bulunuyor',
  call_graph_status: 'Çağrı grafiği durumu okunuyor'
};

/** Alt ajan rolünün Türkçe Görünen Adı; tanımadığı rolde ham kimlik döner. */
export function subagentRoleName(role: unknown): string {
  const raw = typeof role === 'string' ? role.trim() : '';
  if (!raw) return 'uzman';
  const normalized = raw.replace(/^@/, '');
  const definition = getAgentDefinition(normalized);
  if (definition?.displayName) return definition.displayName;
  const info = BUILT_IN_SUBAGENT_ROLES.find((entry) => entry.role.toLowerCase() === normalized.toLowerCase());
  return info?.name ?? normalized;
}

const SHORT_KEYS = [
  'path',
  'file',
  'url',
  'query',
  'symbol',
  'note',
  'goal',
  'task',
  'question',
  'skill_name',
  'name',
  'title',
  'message'
] as const;

/** Ayrıntı satırı: tek satıra indirgenmiş, uzunluğu kesilmiş tek bakışlık bilgi. */
function shorten(value: string): string {
  const single = value.replace(/\s+/g, ' ').trim();
  return single.length > 160 ? `${single.slice(0, 157)}…` : single;
}

/** Adım kartının ikinci satırı: araç bazlı özel alan, yoksa genel anahtar sırası. */
export function toolStepDetail(toolCall: ToolCall): string {
  const args = toolCall.args ?? {};
  const str = (key: string): string => (typeof args[key] === 'string' ? (args[key] as string) : '');

  switch (toolCall.name) {
    case 'execute_command':
    case 'run_tests':
    case 'run_linter':
      return shorten(str('command') || 'Komut otomatik seçildi');
    case 'list_directory':
      return shorten(str('path') || '.');
    case 'get_diagnostics':
      return shorten(str('path') || 'Tüm proje');
    case 'invoke_subagent':
      return shorten(str('task'));
    case 'call_graph_impact': {
      const symbols = args.symbols;
      if (Array.isArray(symbols))
        return shorten(symbols.filter((s): s is string => typeof s === 'string').join(', '));
      break;
    }
    default:
      break;
  }

  for (const key of SHORT_KEYS) {
    const value = str(key);
    if (value) return shorten(value);
  }
  return '';
}
