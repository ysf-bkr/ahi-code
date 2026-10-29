import { chmodSync } from 'node:fs';
import { build } from 'esbuild';

const outputFile = 'dist/cli.js';

await build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  minify: true,
  banner: { js: '#!/usr/bin/env node' },
  outfile: outputFile,
  external: ['vscode', 'readline/promises']
});

if (process.platform !== 'win32') {
  chmodSync(outputFile, 0o755);
}
