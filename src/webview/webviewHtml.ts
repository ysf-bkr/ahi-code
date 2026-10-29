import * as fs from 'fs';
import * as path from 'path';
import { VsCodeThemeConfig } from '../shared/types';

/**
 * Kenar çubuğu webview'ının HTML'ini üretir.
 *
 * `vscode` modülünden bağımsız tutulur ki test edilebilsin: çağıran
 * `toWebviewUri` fonksiyonunu ve canlı webview'ın CSP kaynağını geçirir.
 */

export interface WebviewHtmlOptions {
  /** Derlenmiş webview klasörünün mutlak yolu (webview-ui/dist). */
  distDir: string;
  /** `distDir`'e göreli bir yolu webview'a uygun URI'ye çevirir. */
  toWebviewUri: (relativeAssetPath: string) => string;
  /** `webview.cspSource`. */
  cspSource: string;
  theme: VsCodeThemeConfig;
  /** Testler için enjekte edilebilir. */
  fileExists?: (candidate: string) => boolean;
  readFile?: (candidate: string) => string;
}

const ASSET_REFERENCE = /(href|src)="(\.?\/[^"]*)"/g;

function buildCsp(cspSource: string, allowInlineStyles: boolean): string {
  const styleSources = allowInlineStyles ? `${cspSource} 'unsafe-inline'` : cspSource;
  return [
    "default-src 'none'",
    `img-src ${cspSource} data:`,
    `style-src ${styleSources}`,
    `font-src ${cspSource}`,
    `script-src ${cspSource}`,
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ');
}

function themeStyle(theme: VsCodeThemeConfig): string {
  const lines = [
    theme.editorFontFamily
      ? `--vscode-user-editor-font-family: ${theme.editorFontFamily}, var(--vscode-editor-font-family, monospace);`
      : '',
    `--vscode-user-editor-font-size: ${theme.editorFontSize}px;`,
    `--vscode-user-editor-font-weight: ${theme.editorFontWeight};`,
    theme.terminalFontFamily
      ? `--vscode-user-terminal-font-family: ${theme.terminalFontFamily}, var(--vscode-user-editor-font-family);`
      : '',
    `--vscode-user-terminal-font-size: ${theme.terminalFontSize}px;`
  ].filter(Boolean);

  return `<style id="ahi-vscode-user-config">\n:root {\n${lines.join('\n')}\n}\n</style>`;
}

/**
 * Webview paketi yokken (ilk klonda veya başarısız arayüz derlemesinde)
 * gösterilen yedek ekran. Betik içermez ve kendi CSP'sini taşır.
 */
export function buildFallbackHtml(cspSource: string): string {
  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${buildCsp(cspSource, true)}">
  <title>AhiCode</title>
  <style>
    body {
      margin: 0;
      font-family: var(--vscode-font-family, -apple-system, sans-serif);
      color: var(--vscode-foreground);
      background-color: var(--vscode-sideBar-background);
      padding: 16px;
    }
    .loading { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 80vh; text-align: center; }
    .spinner { width: 32px; height: 32px; border: 3px solid rgba(128,128,128,0.25); border-top-color: #38bdf8; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 16px; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="loading">
    <div class="spinner"></div>
    <h3>Arayüz yükleniyor…</h3>
    <p style="font-size: 12px; opacity: 0.7;">Webview derlemesi bulunamadı. <code>npm run build:ui</code> çalıştırın.</p>
  </div>
</body>
</html>`;
}

export function buildWebviewHtml(options: WebviewHtmlOptions): string {
  const exists = options.fileExists ?? ((candidate: string) => fs.existsSync(candidate));
  const read = options.readFile ?? ((candidate: string) => fs.readFileSync(candidate, 'utf8'));
  const indexPath = path.join(options.distDir, 'index.html');

  if (!exists(indexPath)) {
    return buildFallbackHtml(options.cspSource);
  }

  let html = read(indexPath);

  // Yerel varlıkları webview'a uygun URI'lere çevir ("/assets/x" ve "./assets/x").
  html = html.replace(ASSET_REFERENCE, (_match, attr: string, reference: string) => {
    const relative = reference.replace(/^\.?\//, '');
    return `${attr}="${options.toWebviewUri(relative)}"`;
  });

  const csp = `<meta http-equiv="Content-Security-Policy" content="${buildCsp(options.cspSource, true)}">`;
  if (!/content-security-policy/i.test(html)) {
    // CSP meta etiketi herhangi bir betik veya stil kaynağından önce gelmelidir.
    html = /<head[^>]*>/i.test(html)
      ? html.replace(/<head[^>]*>/i, (head) => `${head}\n${csp}`)
      : `${csp}\n${html}`;
  }

  const style = themeStyle(options.theme);
  html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${style}\n</head>`) : `${html}\n${style}`;

  return html;
}
