import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';

// packages/cli/package.json "bin": ahi → ./dist/cli.js. Çıktı doğrudan paketin
// dist dizinine yazılır; kopya adımlı akışta bayat dosya yarışı yaratıyordu.
const outputFile = resolve('packages/cli/dist/cli.js');

mkdirSync(dirname(outputFile), { recursive: true });

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
