/**
 * Çağrı haritasının dil sunucusu bağımlılığı.
 *
 * Harita mantığı `vscode` modülünü tanımaz; yalnızca bu arayüzü kullanır.
 * Böylece birim testlerinde sahte bir dil servisi enjekte edilebilir.
 */
import type { LspClientPort } from '../lsp/port';
import type { RawSymbol } from './extractor';

export interface ReferenceLocation {
  /** Çalışma alanı köküne göreli yol. */
  file: string;
  /** 1 tabanlı satır. */
  line: number;
}

export interface CallGraphLanguageService {
  /** Dosyanın sembolleri; dil sunucusu yoksa `undefined`. */
  documentSymbols(relativePath: string): Promise<RawSymbol[] | undefined>;
  /** Bir konumdaki sembolün referansları; yoksa `undefined`. */
  references(relativePath: string, line: number): Promise<ReferenceLocation[] | undefined>;
}

/**
 * `LspClient` üzerine ince bir adaptör.
 *
 * Sembolün sütunu haritada tutulmaz (kimliğe girmez). Bu yüzden referans
 * isteği satırın ilk sütununda yapılır; dil sunucusu konumu genellikle
 * satırdaki tanıma genişletir. Bu bir yaklaşımdır ve sınırları `docs`
 * yerine kod yorumunda belirtilmiştir.
 */
export function createLspLanguageService(lsp: LspClientPort, workspaceRoot: string): CallGraphLanguageService {
  return {
    async documentSymbols(relativePath: string): Promise<RawSymbol[] | undefined> {
      try {
        const symbols = await lsp.getDocumentSymbols(relativePath, workspaceRoot);
        return symbols ?? undefined;
      } catch {
        return undefined; // Dil sunucusu yok ya da dosya desteklenmiyor.
      }
    },

    async references(relativePath: string, line: number): Promise<ReferenceLocation[] | undefined> {
      try {
        return await lsp.getReferenceLocations(relativePath, line, 1, workspaceRoot);
      } catch {
        return undefined;
      }
    }
  };
}
