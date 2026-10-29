import * as esbuild from 'esbuild';

/**
 * Bundles the VS Code integration suite for the extension host.
 * The `vscode` module is provided by the host at runtime.
 */
await esbuild.build({
  entryPoints: ['test/e2e/suite/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: 'out/e2e/suite.js',
  external: ['vscode'],
  sourcemap: 'inline',
  logLevel: 'info'
});
