import * as vscode from 'vscode';

/**
 * VS Code fark (diff) görünümü için bellek-içi sanal içerik sağlayıcı.
 * Orijinal (değişiklik öncesi), önerilen (proposed) veya Git HEAD içeriğini 'ahicode-diff' şemasıyla sunar.
 * Bellek-içi sanal şema salt-okunurdur ve untitled belgeler gibi "Kayıt edilsin mi?" uyarısı tetiklemez.
 */
export class AhiCodeDiffContentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  public static readonly scheme = 'ahicode-diff';
  private static instance: AhiCodeDiffContentProvider | undefined;

  private _documents = new Map<string, string>();
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this._onDidChange.event;

  public static getInstance(): AhiCodeDiffContentProvider {
    if (!AhiCodeDiffContentProvider.instance) {
      AhiCodeDiffContentProvider.instance = new AhiCodeDiffContentProvider();
    }
    return AhiCodeDiffContentProvider.instance;
  }

  public setDocumentContent(uri: vscode.Uri, content: string): void {
    this._documents.set(uri.toString(), content);
    this._onDidChange.fire(uri);
  }

  public provideTextDocumentContent(uri: vscode.Uri): string {
    return this._documents.get(uri.toString()) ?? '';
  }

  public dispose(): void {
    this._documents.clear();
    this._onDidChange.dispose();
  }
}
