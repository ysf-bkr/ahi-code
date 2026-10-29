import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { buildFallbackHtml, buildWebviewHtml } from '../../src/webview/webviewHtml';
import { VsCodeThemeConfig } from '../../src/shared/types';

const theme: VsCodeThemeConfig = {
  editorFontFamily: 'JetBrains Mono',
  editorFontSize: 14,
  editorFontWeight: '500',
  editorLineHeight: 1.5,
  terminalFontFamily: 'Menlo',
  terminalFontSize: 12
};

const CSP_SOURCE = 'vscode-webview://abc';

function build(indexHtml: string | undefined): string {
  return buildWebviewHtml({
    distDir: '/ext/webview-ui/dist',
    cspSource: CSP_SOURCE,
    toWebviewUri: (asset) => `${CSP_SOURCE}/ext/webview-ui/dist/${asset}`,
    theme,
    fileExists: (candidate) => candidate.endsWith('index.html') && indexHtml !== undefined,
    readFile: () => indexHtml ?? ''
  });
}

describe('webviewHtml: CSP and asset paths', () => {
  const indexHtml =
    '<!DOCTYPE html><html><head><title>x</title></head><body><script type="module" src="/assets/index.js"></script><link rel="stylesheet" href="./assets/index.css"></body></html>';

  it('adds CSP meta tag to head and before script', () => {
    const html = build(indexHtml);
    const cspIndex = html.indexOf('Content-Security-Policy');
    const scriptIndex = html.indexOf('<script');

    assert.ok(cspIndex > 0, 'CSP meta tag not added');
    assert.ok(cspIndex < scriptIndex, 'CSP should be before script tag');
    assert.match(html, /default-src 'none'/);
    assert.match(html, new RegExp(`script-src ${CSP_SOURCE}`));
    assert.match(html, /base-uri 'none'/);
    assert.match(html, /form-action 'none'/);
  });

  it('script-src does not allow inline script', () => {
    const html = build(indexHtml);
    const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';
    const scriptSrc = csp.split(';').find((part) => part.trim().startsWith('script-src')) ?? '';
    assert.doesNotMatch(scriptSrc, /unsafe-inline/);
    assert.doesNotMatch(scriptSrc, /unsafe-eval/);
  });

  it('converts both /assets and ./assets paths to webview URI', () => {
    const html = build(indexHtml);
    assert.match(html, new RegExp(`src="${CSP_SOURCE}/ext/webview-ui/dist/assets/index\\.js"`));
    assert.match(html, new RegExp(`href="${CSP_SOURCE}/ext/webview-ui/dist/assets/index\\.css"`));
    assert.doesNotMatch(html, /src="\/assets/);
    assert.doesNotMatch(html, /href="\.\/assets/);
  });

  it('injects user font settings as style', () => {
    const html = build(indexHtml);
    assert.match(html, /--vscode-user-editor-font-family: JetBrains Mono/);
    assert.match(html, /--vscode-user-editor-font-size: 14px/);
    assert.match(html, /--vscode-user-terminal-font-size: 12px/);
    assert.ok(html.indexOf('ahi-vscode-user-config') < html.indexOf('</head>'));
  });

  it('returns the Turkish fallback screen with CSP when index.html is missing', () => {
    const html = build(undefined);
    assert.match(html, /Arayüz yükleniyor/);
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /default-src 'none'/);
    assert.doesNotMatch(html, /<script/i);
  });

  it('does not add CSP twice if already present', () => {
    const withCsp =
      '<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'"></head><body></body></html>';
    const html = build(withCsp);
    assert.strictEqual(html.match(/Content-Security-Policy/g)?.length, 1);
  });

  it('style-src relies on a nonce instead of unsafe-inline', () => {
    const html = build(indexHtml);
    const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';
    const styleSrc = csp.split(';').find((part) => part.trim().startsWith('style-src')) ?? '';
    assert.doesNotMatch(styleSrc, /unsafe-inline/);
    assert.match(styleSrc, /'nonce-[^']+'/);

    // Enjekte edilen tema stili, CSP'deki nonce ile eşleşmeli.
    const nonce = styleSrc.match(/'nonce-([^']+)'/)?.[1];
    assert.ok(nonce, 'style-src bir nonce içermeli');
    assert.ok(
      html.includes(`<style id="ahi-vscode-user-config" nonce="${nonce}"`),
      'enjekte edilen stil CSP nonce ile eşleşmeli'
    );
  });

  it('fallback screen carries the same nonce for its inline style block', () => {
    const html = buildFallbackHtml(CSP_SOURCE, 'test-nonce');
    assert.match(html, /style-src vscode-webview:\/\/abc 'nonce-test-nonce'/);
    assert.match(html, /<style nonce="test-nonce">/);
    assert.doesNotMatch(html, /style="/, 'satır içi style özniteliği nonce ile korunamaz');
  });
});

describe('webviewHtml: fallback screen', () => {
  it('uses the CSP source and contains no scripts', () => {
    const html = buildFallbackHtml(CSP_SOURCE);
    assert.match(html, new RegExp(`style-src ${CSP_SOURCE}`));
    assert.doesNotMatch(html, /<script/i);
  });
});
