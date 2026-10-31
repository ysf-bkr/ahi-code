import { ProviderMessage } from '../../providers/base';

/** Bütçeye sayılan araç şemasının asgari biçimi (ToolDefinition'la uyumlu). */
export interface ContextToolSchema {
  name: string;
  description?: string;
  parameters?: unknown;
}

export interface ContextWindowOptions {
  /** Model bağlam penceresi; yalnızca taşma koruması (harcama sınırı değil). */
  contextWindowTokens?: number;
  /**
   * Modele her turda gönderilen araç tanımları. Şemalar pencerenin kalıcı
   * bir bölümünü işgal eder; bütçe hesabı bunları da saymalıdır (denetim m.7).
   */
  tools?: ContextToolSchema[];
  maxToolOutputChars?: number;
  /** Konuşma bu adım sayısına ulaşınca eski araç çıktılarını sıkıştır. */
  summarizeAfterSteps?: number;
  /**
   * Sıkıştırmanın devreye girmesi için bağlam penceresinin aşması gereken oran
   * (varsayılan 0,5). Erken sıkıştırma modele "dosyayı yeniden oku" sinyali
   * verip tekrar okuma döngüleri üretiyordu; artık yalnızca gerçek token
   * baskısında sıkıştırılır. 0 verilirse eşik devre dışı kalır (testler).
   */
  compactionTokenRatio?: number;
}

/**
 * Modele gönderilen istek için taşma koruması.
 *
 * Bu bilinçli olarak kullanıcıya dönük bir token bütçesi değildir: görevler
 * bu yüzden asla duraklatılmaz. Geçmiş bu boyutu aşarsa sağlayıcı isteği
 * reddetmesin diye sıkıştırılır ve budanır. Tasarruf, işi durdurmaktan
 * değil kırpma ve sıkıştırmadan gelir.
 */
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 96_000;

/**
 * Araç başına çıktı sınırları.
 *
 * Bu projede ölçüldü: 12 bin karakterlik çıktılarla 25 adımlık bir görev
 * ~1,14M token tutuyor ve araç çıktısı en büyük tek kalem (~%55).
 * Tüm dosyayı okumak bazen gerekli; tüm komut günlüğünü dökmek nadiren.
 * Bu yüzden tek global değer yerine araç başına sınır kullanılır.
 */
const TOOL_OUTPUT_LIMITS: Record<string, number> = {
  read_file: 12_000,
  read_notebook: 8_000,
  search_files: 3_000,
  list_directory: 2_500,
  execute_command: 4_000,
  run_tests: 4_000,
  run_linter: 4_000,
  run_verification: 5_000,
  git_diff: 6_000,
  git_status: 1_500,
  get_diagnostics: 3_000,
  index_workspace: 1_500,
  find_symbol: 2_500,
  analyze_impact: 2_500,
  get_project_knowledge: 6_000,
  search_memory: 3_000,
  web_fetch: 8_000,
  web_search: 3_000,
  invoke_subagent: 6_000,
  run_parallel_tasks: 8_000,
  // Çağrı grafiği çıktıları büyük projelerde satır satır şişer; liste özeti
  // yeter, tam graf zaten call_graph araçlarıyla yeniden çıkarılabilir.
  get_callers: 2_500,
  get_callees: 2_500,
  call_graph_impact: 3_000,
  find_related_code: 3_000,
  call_graph_status: 1_000,
  default: 6_000
};

/** Genellikle hatayı açıklayan satırlar; günlük kırpılırken hep korunur. */
const SIGNAL_LINE =
  /error|fail|exception|warn|fatal|cannot|unable|denied|undefined|✖|×|✗|TS\d{4}|at\s+\S+\s+\(/i;

/**
 * Metni `maxChars` sınırına kırpar ama modelin ihtiyaç duyduğu parçaları
 * korur: baş (bağlam), son (nihai sonuç) ve aksi hâlde kaybolacak orta
 * kısımdaki hata görünümlü satırlar.
 */
export function trimSmart(text: string, maxChars: number, label = 'output'): string {
  if (text.length <= maxChars) return text;

  const headChars = Math.floor(maxChars * 0.55);
  const tailChars = Math.floor(maxChars * 0.25);
  const head = text.slice(0, headChars);
  const tail = text.slice(-tailChars);
  const middle = text.slice(headChars, text.length - tailChars);

  // Kalan bütçeyi ortadaki sinyal satırlarına ayır.
  const signalBudget = maxChars - headChars - tailChars;
  const signals: string[] = [];
  let used = 0;
  let signalCount = 0;

  for (const line of middle.split('\n')) {
    if (line.length > 200) continue;
    if (!SIGNAL_LINE.test(line)) continue;
    if (used + line.length + 1 > signalBudget) break;
    signals.push(line.trim());
    used += line.length + 1;
    signalCount++;
  }

  const omitted = text.length - headChars - tailChars;
  const signalBlock =
    signals.length > 0
      ? `\n\n[... ${signalCount} signal line(s) kept from the omitted middle ...]\n${signals.join('\n')}`
      : '';

  return (
    `${head}\n\n[... ${label} truncated: ${omitted} of ${text.length} characters omitted. ` +
    `Narrow the request (offset/limit, path filter) if you need the rest ...]${signalBlock}\n\n${tail}`
  );
}

/** Eski (harcanmış) bir mesajı ilk satırını koruyarak kısaltır. */
function compressOldMessage(msg: ProviderMessage): ProviderMessage {
  if (msg.role === 'system' && msg.content.length > 1_500) {
    return {
      ...msg,
      content: `${msg.content.slice(0, 1_200)}\n... [older system message truncated to fit the context window]`
    };
  }
  if (msg.role === 'tool' && msg.content.length > 500) {
    return {
      ...msg,
      content: `${msg.content.slice(0, 300)}... [previous step output compressed]`
    };
  }
  if (msg.role === 'assistant' && msg.content && msg.content.length > 1000) {
    return {
      ...msg,
      content: `${msg.content.slice(0, 500)}... [older response summary]`
    };
  }
  if (msg.role === 'user' && msg.content.length > 2000) {
    return {
      ...msg,
      content: `${msg.content.slice(0, 1000)}... [older user message truncated]`
    };
  }
  return msg;
}

export class ContextManager {
  private contextWindowTokens: number;
  private maxToolOutputChars: number;
  private summarizeAfterSteps: number;
  private compactionTokenRatio: number;
  private toolSchemas: ContextToolSchema[];

  constructor(options: ContextWindowOptions = {}) {
    this.contextWindowTokens = options.contextWindowTokens || DEFAULT_CONTEXT_WINDOW_TOKENS;
    this.maxToolOutputChars = options.maxToolOutputChars || 12000;
    this.summarizeAfterSteps = options.summarizeAfterSteps ?? 8;
    this.compactionTokenRatio = options.compactionTokenRatio ?? 0.5;
    this.toolSchemas = options.tools ?? [];
  }

  /** Kalıcı araç tanımı yükünün token tahmini (kaba ama güvenli taraflı). */
  public estimateToolSchemaTokens(tools: ContextToolSchema[] = this.toolSchemas): number {
    let total = 0;
    for (const tool of tools) {
      total += 8; // kayıt başına yapısal ek yük
      total += this.estimateTokens(tool.name);
      total += this.estimateTokens(tool.description);
      if (tool.parameters) {
        total += this.estimateTokens(JSON.stringify(tool.parameters));
      }
    }
    return total;
  }

  /**
   * Hızlı token tahmini (çok dilli metin ve kod için yaklaşık 3.8-4 karakter/token).
   */
  public estimateTokens(content: string | undefined): number {
    if (!content) return 0;
    return Math.ceil(content.length / 3.8);
  }

  /**
   * Bir ProviderMessage dizisinin toplam token sayısını tahmin eder.
   */
  public estimateMessagesTokens(messages: ProviderMessage[]): number {
    let total = 0;
    for (const msg of messages) {
      total += 4; // mesaj başına ek yük
      total += this.estimateTokens(msg.content);
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          total += this.estimateTokens(tc.name) + this.estimateTokens(JSON.stringify(tc.arguments));
        }
      }
    }
    return total;
  }

  /**
   * Araç çıktısını araç başına sınırla kırpar ve sinyal satırlarını korur.
   * Bilinmeyen araç global bütçe yerine temkinli varsayılana düşer; böylece
   * yeni araçlar bağlamı sessizce şişiremez.
   */
  public truncateToolOutput(output: string, toolName?: string): string {
    if (!toolName) return trimSmart(output, this.maxToolOutputChars, 'output');
    const limit = TOOL_OUTPUT_LIMITS[toolName] ?? (TOOL_OUTPUT_LIMITS.default as number);
    return trimSmart(output, limit, `${toolName} output`);
  }

  /**
   * Zaten "harcanmış" araç çıktılarını sıkıştırır: eski adımlar tam gövdeye
   * değil bir işarete ihtiyaç duyar. En ucuz büyük kazanç budur, çünkü tüm
   * geçmiş her adımda yeniden gönderilir.
   */
  public compactHistory(
    messages: ProviderMessage[],
    options: { keepRecent?: number; summarizeAfterSteps?: number } = {}
  ): ProviderMessage[] {
    const keepRecent = options.keepRecent ?? 6;
    const threshold = options.summarizeAfterSteps ?? this.summarizeAfterSteps;

    // Yalnızca konuşma anlamlı uzunluğa ulaşınca sıkıştır.
    const stepCount = messages.filter((m) => m.role === 'assistant' && (m.toolCalls?.length || 0) > 0).length;
    if (stepCount < threshold) return messages;

    // Token baskısı yoksa sıkıştırma: içerik tam kalır, model "yeniden oku"
    // sinyaline ihtiyaç duymaz. Oran 0 ise eşik devre dışıdır.
    if (this.compactionTokenRatio > 0) {
      const pressure = this.estimateMessagesTokens(messages);
      if (pressure < this.contextWindowTokens * this.compactionTokenRatio) return messages;
    }

    const toolIndexes = messages
      .map((message, index) => ({ message, index }))
      .filter(({ message }) => message.role === 'tool');

    const keptFrom = toolIndexes.length - keepRecent;
    if (keptFrom <= 0) return messages;

    const result = [...messages];
    for (let i = 0; i < keptFrom; i++) {
      const entry = toolIndexes[i];
      if (!entry) continue;
      const { message, index } = entry;
      if (message.content.length <= 400) continue;
      const firstLine = message.content.split('\n').find((line) => line.trim().length > 0) || '';
      result[index] = {
        ...message,
        content:
          `${firstLine.slice(0, 160)}\n[... earlier step output compacted: ${message.content.length} chars; ` +
          `the file has most likely NOT changed — reuse what you already know and re-read only if the content you need is gone ...]`
      };
    }
    return result;
  }

  /**
   * İstek modelin bağlam penceresini aşacaksa eski konuşma turlarını budar.
   * Öncelik:
   * 1. System Prompt (her zaman korunur)
   * 2. Son kullanıcı sorgusu ve son 4 tur (korunur)
   * 3. Bağlam şişerse ortadaki mesajlar budanır/özetlenir
   */
  public pruneMessages(messages: ProviderMessage[], tools?: ContextToolSchema[]): ProviderMessage[] {
    // Araç şemaları her istekle gider: gerçekçi bütçe, pencereden onların payını
    // düşerek bulunur (denetim m.7).
    const schemaTokens = this.estimateToolSchemaTokens(tools ?? this.toolSchemas);
    // Alt sınır pencerenin kendisini aşamaz: küçük test pencereleri varsa
    // budama hiç çalışmasın diye değil, şema yükü gerçek pencereyi yutmasın
    // diye var.
    const effectiveWindow = Math.max(
      Math.min(4_000, this.contextWindowTokens),
      this.contextWindowTokens - schemaTokens
    );
    const totalTokens = this.estimateMessagesTokens(messages);
    if (totalTokens <= effectiveWindow || messages.length <= 4) {
      return messages;
    }

    // Mesajları "birimlere" grupla: bir assistant tool_call ve onu izleyen
    // araç sonuçları asla ayrılmamalı (OpenAI uyumlu API'ler isteği reddeder);
    // system mesajı da en üste taşınmak yerine konuşmanın koyduğu yerde kalır.
    const units: ProviderMessage[][] = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg) continue;
      if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
        const unit: ProviderMessage[] = [msg];
        let j = i + 1;
        while (j < messages.length) {
          const nextMsg = messages[j];
          if (!nextMsg || nextMsg.role !== 'tool') break;
          unit.push(nextMsg);
          j++;
        }
        units.push(unit);
        i = j - 1;
      } else {
        units.push([msg]);
      }
    }
    if (units.length === 0) return messages;

    const head = units[0];
    if (!head) return messages;

    // Son kullanıcı mesajı bu turun kimliğidir: ne düşürülebilir ne kırpılabilir
    // (denetim m.7). Birimi işaretlenir ve tüm aşamalarda muaf tutulur.
    let lastUserUnitIndex = -1;
    for (let i = units.length - 1; i >= 0; i--) {
      if (units[i]?.some((message) => message.role === 'user')) {
        lastUserUnitIndex = i;
        break;
      }
    }

    // Eski birimleri sıkıştır; en yeniler olduğu gibi kalır ki model az önce
    // ne yaptığını hâlâ görebilsin.
    const recentUnitCount = 6;
    const rest = units.slice(1);
    const compacted = rest.map((unit, index) => {
      if (index + 1 === lastUserUnitIndex) return unit;
      if (index >= rest.length - recentUnitCount) return unit;
      return unit.map((msg) => compressOldMessage(msg));
    });

    let kept: ProviderMessage[][] = [head, ...compacted];
    const estimate = () => this.estimateMessagesTokens(kept.flat());

    // Baştaki system prompt'tan sonra en eski konuşma birimlerini düşür. Yalnızca
    // system mesajları kaldığında düşürülmez, aşağıda kırpılırlar: ana talimatları
    // kaybetmek, kısaltmaktan daha kötüdür.
    // Referans eşitliğiyle izlenir: düşürme sonrası indeks kayabilir.
    const protectedUnit = lastUserUnitIndex >= 0 ? units[lastUserUnitIndex] : undefined;
    while (kept.length > 2 && estimate() > effectiveWindow) {
      const dropIndex = kept.findIndex(
        (unit, index) => index > 0 && unit !== protectedUnit && unit.every((m) => m.role !== 'system')
      );
      if (dropIndex === -1) break;
      kept = [...kept.slice(0, dropIndex), ...kept.slice(dropIndex + 1)];
    }

    // Büyük çıktıları kademeli olarak kırp; baştaki system prompt ve son
    // kullanıcı mesajı muaftır.
    const limits = [3_000, 1_500, 800, 400];
    for (const limit of limits) {
      if (estimate() <= effectiveWindow) break;
      kept = kept.map((unit, unitIndex) => {
        if (unitIndex === 0 || unit === protectedUnit) return unit;
        return unit.map((message) => {
          if (message.content.length <= limit) return message;
          const label =
            message.role === 'system'
              ? '[older system message truncated to fit the context window]'
              : message.role === 'tool'
                ? '[tool output truncated to fit the context window]'
                : '[message truncated to fit the context window]';
          return {
            ...message,
            content: `${message.content.slice(0, limit)}\n... ${label}`
          };
        });
      });
    }

    return kept.flat();
  }
}
