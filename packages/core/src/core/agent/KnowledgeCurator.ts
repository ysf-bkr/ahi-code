import * as fs from 'fs/promises';
import * as path from 'path';
import { ModelProvider } from '../../providers/base';
import { KnowledgeStore } from '../knowledge/KnowledgeStore';
import type { LspClientPort } from '../lsp/port';
import { resolveWorkspacePath } from '../../tools/pathSafety';
import { logWarning } from '../../shared/logging';

/**
 * Bilgi tabanını olabildiğince az model çağrısıyla kullanışlı tutar.
 *
 * Bilinçli olarak AgentCore dışında: orkestratör zaten iş akışı kapılarını
 * ve araç zincirini taşıyor; küratörlük ayrı bütçeleri olan bağımsız bir
 * konudur.
 *
 * Sorumluluklar:
 * - Tembel dosya özetleri: ajan bir dosyayı derinlemesine okuduktan sonra
 * kısa bir model özeti bir kez saklanır ve dosya değişene kadar
 * (hash önbellekli) yeniden kullanılır. Tur başına sınırlıdır.
 * - LSP zenginleştirme: indekslenen TS/JS/Python dosyalarının regex ile
 * tahmin edilen sembol aralıklarını oturumda bir kez dil sunucusunun
 * kesin aralıklarıyla değiştirir.
 * - İstem dürtmeleri: project.md yoksa başlangıç taslağı talimatı ve görev
 */
export class KnowledgeCurator {
  /** Tur başına model özeti sayısı; maliyeti öngörülebilir tutar. */
  private summariesThisTurn = 0;
  private lspEnriched = false;

  constructor(
    private readonly knowledgeStore: KnowledgeStore,
    private readonly provider: ModelProvider,
    private readonly lspClient: LspClientPort
  ) {}

  public resetTurnBudget(): void {
    this.summariesThisTurn = 0;
  }

  /** İndeks var ama project.md hiç yazılmamışken doğrudur. */
  public needsOnboardingDraft(): boolean {
    return this.knowledgeStore.needsOnboardingDraft();
  }

  /** Belgelenmemiş bir projenin ilk görevinde sistem istemine eklenir. */
  public onboardingNudge(): string {
    return `

=== ONBOARDING NOTE ===
The knowledge base has no project.md yet. While you work on the user's task, gather enough
understanding to also propose a concise project.md draft (purpose, stack, architecture, key
commands — max ~40 lines) with the write_knowledge_file tool; the user will approve it before
it is saved. Do not block or delay the user's task for this.`;
  }

  /** Kod değiştiren görev bitince sistem mesajı olarak enjekte edilir. */
  public taskEndInstruction(): string {
    return [
      'Task completed. Before finishing, record durable knowledge for future sessions:',
      '(1) If this task produced lasting decisions or conventions, propose them with the',
      '    write_knowledge_file tool (file: "decisions" or "conventions").',
      '(2) Add short gotchas or constraints with add_knowledge_note.',
      'Keep entries factual and short (max ~10 lines each). The user approves every write.',
      'Then close THIS knowledge-recording step with a one-line confirmation only —',
      'do not re-summarize the task; your user-facing report was already delivered.'
    ].join('\n');
  }

  /**
   * Ajanın yeni okuduğu dosya için arka planda tembel özet. Küçük dosyaları
   * (depo haritası satırı onlara yeter), zaten özetlenmiş dosyaları ve
   * indeks dışındaki dosyaları atlar. Özet sonraki turun istemine girer,
   * böylece dosyayı "anlamak" için yeniden okumak gerekmez.
   */
  public maybeSummarizeFile(displayPath: string, workspaceRoot: string | undefined): void {
    if (!workspaceRoot || this.summariesThisTurn >= 3) return;
    try {
      const fullPath = resolveWorkspacePath(displayPath, workspaceRoot);
      const relative = path.relative(workspaceRoot, fullPath).replace(/\\/g, '/');
      const record = this.knowledgeStore.getFile(relative);
      if (!record || record.summary || record.bytes < 1_500) return;

      this.summariesThisTurn++;
      void (async () => {
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          const head = content.split('\n').slice(0, 160).join('\n');
          const response = await this.provider.sendMessage(
            [
              {
                role: 'system',
                content:
                  'You write concise summaries for a code knowledge base. Reply with 2-3 factual ' +
                  'sentences describing what the file contains and its role in the project. ' +
                  'No preamble, no markdown, max 60 words, English.'
              },
              {
                role: 'user',
                content: `File: ${relative}\nExports: ${record.exports.slice(0, 20).join(', ') || '(none)'}\n\n${head}`
              }
            ],
            [],
            undefined
          );
          const summary = response.text.trim().slice(0, 500);
          if (summary) {
            await this.knowledgeStore.setSummary(workspaceRoot, relative, summary);
          }
        } catch (err) {
          logWarning(`Could not summarize ${relative}`, err);
        }
      })();
    } catch {
      // Geçersiz yol: read_file zaten eyleme dönük hatayı bildirdi.
    }
  }

  /**
   * İndekslenen TS/JS/Python dosyalarında regex ile tahmin edilen sembol
   * aralıklarını kesin LSP aralıklarıyla değiştirir. Oturumda en çok bir kez,
   * arka planda çalışır; kısmi hatalar o ana kadar birleşmiş veriyi korur.
   */
  public enrichWithLsp(workspaceRoot: string): void {
    if (this.lspEnriched) return;
    this.lspEnriched = true;
    void (async () => {
      try {
        const files = this.knowledgeStore.indexedFiles(
          new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py']),
          150
        );
        let merged = 0;
        for (const file of files) {
          const symbols = await this.lspClient.getDocumentSymbols(file, workspaceRoot);
          if (symbols && symbols.length > 0) {
            this.knowledgeStore.mergeSymbols(file, symbols);
            merged++;
          }
        }
        if (merged > 0) {
          await this.knowledgeStore.flush();
        }
      } catch (err) {
        logWarning('LSP enrichment of the knowledge base failed', err);
      }
    })();
  }
}
