import * as esbuild from 'esbuild';

/**
 * Extension host için VS Code entegrasyon test paketini paketler.
 * `vscode` modülü çalışma zamanında host tarafından sağlanır.
 */
await esbuild.build({
  entryPoints: ['test/e2e/suite/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: 'out/e2e/suite.js',
  external: ['vscode'],
  sourcemap: 'inline',
  logLevel: 'info'
});
