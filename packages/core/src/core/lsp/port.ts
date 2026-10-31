/**
 * LSP portu (bağımlılık ters-yüzü).
 *
 * Gerçek istemci VS Code eklenti konak katmanında yaşar (`src/core/lsp/LspClient`):
 * dil sunucusu sorguları vscode API'sidir. Motor katmanı bu biçimi (şekli)
 * kullanır; TypeScript yapısal tiplaması sayesinde LspClient sınıfı bu
 * arayüzü bildirimsiz karşılar. Böylece çekirdek paket vscode modülüne
 * asla dokunmaz ve terminal uygulaması LSP olmadan da çalışır.
 */
export interface LspClientPort {
  getDiagnostics(
    workspaceRoot?: string,
    filePath?: string,
    minSeverity?: 'error' | 'warning'
  ): Promise<string>;
  getDefinition(filePath: string, line: number, character: number, workspaceRoot?: string): Promise<string>;
  getHover(filePath: string, line: number, character: number, workspaceRoot?: string): Promise<string>;
  getDocumentSymbols(
    filePath: string,
    workspaceRoot?: string
  ): Promise<Array<{ name: string; kind: string; line: number; endLine?: number }> | undefined>;
  getReferences(filePath: string, line: number, character: number, workspaceRoot?: string): Promise<string>;
  getReferenceLocations(
    filePath: string,
    line: number,
    character: number,
    workspaceRoot?: string
  ): Promise<Array<{ file: string; line: number }> | undefined>;
  getWorkspaceSymbols(query: string, workspaceRoot?: string): Promise<string>;
}
