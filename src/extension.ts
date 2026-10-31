import * as vscode from 'vscode';
import { SidebarProvider } from './webview/SidebarProvider';
import { setLogSink } from '@ahicode/core/shared/logging';
import { errorMessage } from '@ahicode/core/shared/errors';

export async function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('AhiCode');
  context.subscriptions.push(output);
  setLogSink((level, message, error) => {
    const suffix = error === undefined ? '' : ` — ${errorMessage(error)}`;
    output.appendLine(`[${level}] ${message}${suffix}`);
  });

  const sidebarProvider = new SidebarProvider(context.extensionUri, context);

  // Ayarlar ve API anahtarları yüklenmeden webview/ajan oluşturulmaz (yarış durumunu önler).
  await sidebarProvider.initialize();

  // Webview görünümünü kaydet
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebarProvider, {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    })
  );

  // Komutları kaydet
  context.subscriptions.push(
    sidebarProvider,
    vscode.commands.registerCommand('ahi-code.openSidebar', () => {
      vscode.commands.executeCommand('workbench.view.extension.ahi-code-sidebar-view');
    }),
    vscode.commands.registerCommand('ahi-code.newTask', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.ahi-code-sidebar-view');
      await sidebarProvider.newSession();
      vscode.window.showInformationMessage('AhiCode: Yeni görev oturumu hazır.');
    })
  );
}

export function deactivate() {
  setLogSink(undefined);
}
