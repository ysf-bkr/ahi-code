import * as crypto from 'crypto';
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
  /** Testler için sabit nonce; verilmezse rastgele üretilir. */
  styleNonce?: string;
}

const ASSET_REFERENCE = /(href|src)="(\.?\/[^"]*)"/g;

/** Tema değişkenlerini taşıyan tek satır içi stil için CSP nonce'u. */
function createNonce(): string {
  return crypto.randomBytes(16).toString('base64');
}

/**
 * `style-src` yalnızca eklenti kaynaklarına ve verilen nonce'a izin verir.
 * `'unsafe-inline'` yoktur: satır içi stil enjeksiyonu bu nonce olmadan çalışmaz.
 */
function buildCsp(cspSource: string, styleNonce: string): string {
  return [
    "default-src 'none'",
    `img-src ${cspSource} data:`,
    `style-src ${cspSource} 'nonce-${styleNonce}'`,
    `font-src ${cspSource}`,
    `script-src ${cspSource}`,
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ');
}

function themeStyle(theme: VsCodeThemeConfig, styleNonce: string): string {
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

  return `<style id="ahi-vscode-user-config" nonce="${styleNonce}">\n:root {\n${lines.join('\n')}\n}\n</style>`;
}

/**
 * Webview paketi yokken (ilk klonda veya başarısız arayüz derlemesinde)
 * gösterilen yedek ekran. Betik içermez; stili nonce'lı tek bir bloktur.
 */
export function buildFallbackHtml(cspSource: string, styleNonce: string = createNonce()): string {
  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${buildCsp(cspSource, styleNonce)}">
  <title>AhiCode</title>
  <style nonce="${styleNonce}">
    body {
      margin: 0;
      font-family: var(--vscode-font-family, -apple-system, sans-serif);
      color: var(--vscode-foreground);
      background-color: var(--vscode-sideBar-background);
      padding: 16px;
    }
    .loading { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 80vh; text-align: center; }
    .spinner { width: 32px; height: 32px; border: 3px solid rgba(128,128,128,0.25); border-top-color: #38bdf8; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 16px; }
    .hint { font-size: 12px; opacity: 0.7; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="loading">
    <div class="spinner"></div>
    <h3>Arayüz yükleniyor…</h3>
    <p class="hint">Webview derlemesi bulunamadı. <code>npm run build:ui</code> çalıştırın.</p>
  </div>
</body>
</html>`;
}

export function buildWebviewHtml(options: WebviewHtmlOptions): string {
  const exists = options.fileExists ?? ((candidate: string) => fs.existsSync(candidate));
  const read = options.readFile ?? ((candidate: string) => fs.readFileSync(candidate, 'utf8'));
  const indexPath = path.join(options.distDir, 'index.html');
  const styleNonce = options.styleNonce ?? createNonce();

  if (!exists(indexPath)) {
    return buildFallbackHtml(options.cspSource, styleNonce);
  }

  let html = read(indexPath);

  // Yerel varlıkları webview'a uygun URI'lere çevir ("/assets/x" ve "./assets/x").
  html = html.replace(ASSET_REFERENCE, (_match, attr: string, reference: string) => {
    const relative = reference.replace(/^\.?\//, '');
    return `${attr}="${options.toWebviewUri(relative)}"`;
  });

  const csp = `<meta http-equiv="Content-Security-Policy" content="${buildCsp(options.cspSource, styleNonce)}">`;
  if (!/content-security-policy/i.test(html)) {
    // CSP meta etiketi herhangi bir betik veya stil kaynağından önce gelmelidir.
    html = /<head[^>]*>/i.test(html)
      ? html.replace(/<head[^>]*>/i, (head) => `${head}\n${csp}`)
      : `${csp}\n${html}`;
  }

  const style = themeStyle(options.theme, styleNonce);
  html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${style}\n</head>`) : `${html}\n${style}`;

  return html;
}
