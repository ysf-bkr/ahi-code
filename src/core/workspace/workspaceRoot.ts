import * as vscode from 'vscode';

/**
 * Çok köklü çalışma alanlarında etkin editörü içeren kökü, etkin editör yoksa
 * ilk çalışma alanı kökünü döndürür.
 */
export function getActiveWorkspaceRoot(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.uri.scheme === 'file') {
    const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (folder) {
      return folder.uri.fsPath;
    }
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}
