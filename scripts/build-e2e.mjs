import * as esbuild from 'esbuild';
import { resolve } from 'node:path';

/**
 * Extension host için VS Code entegrasyon test paketini paketler.
 * `vscode` modülü çalışma zamanında host tarafından sağlanır.
 */
await esbuild.build({
  entryPoints: ['test/e2e/suite/index.ts'],
  bundle: true,
  alias: { '@ahicode/core': resolve('packages/core/src') },
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: 'out/e2e/suite.js',
  external: ['vscode'],
  sourcemap: 'inline',
  logLevel: 'info'
});
