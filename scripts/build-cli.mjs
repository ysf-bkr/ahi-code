import { chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const outputFile = 'dist/cli.js';

await build({
  entryPoints: ['packages/cli/src/index.ts'],
  bundle: true,
  alias: { '@ahicode/core': resolve('packages/core/src') },
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
