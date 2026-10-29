import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifestPath = resolve(root, 'package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const vsixPath = resolve(root, 'out', `${manifest.name}-${manifest.version}.vsix`);
const action = process.argv[2];

function resolveVsceCliPath() {
  const vsceManifestPath = resolve(root, 'node_modules/@vscode/vsce/package.json');
  if (!existsSync(vsceManifestPath)) {
    process.stderr.write('@vscode/vsce not found. Install dependencies with npm install.\n');
    process.exit(1);
  }

  const vsceManifest = JSON.parse(readFileSync(vsceManifestPath, 'utf8'));
  return resolve(dirname(vsceManifestPath), vsceManifest.bin.vsce);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) {
    process.stderr.write(`Failed to run ${command}: ${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (action === 'package') {
  mkdirSync(dirname(vsixPath), { recursive: true });
  run(process.execPath, [resolveVsceCliPath(), 'package', '--no-dependencies', '--out', vsixPath]);
} else if (action === 'install') {
  if (!existsSync(vsixPath)) {
    process.stderr.write(`VSIX package not found: ${vsixPath}\n`);
    process.exit(1);
  }
  run('code', ['--install-extension', vsixPath, '--force']);
} else if (action === 'publish') {
  if (!existsSync(vsixPath)) {
    process.stderr.write(`VSIX package not found: ${vsixPath}\n`);
    process.exit(1);
  }
  run(process.execPath, [resolveVsceCliPath(), 'publish', '--packagePath', vsixPath, '--skip-duplicate']);
} else if (action === 'uninstall') {
  run('code', ['--uninstall-extension', `${manifest.publisher}.${manifest.name}`]);
} else {
  process.stderr.write('Usage: node scripts/extension-lifecycle.mjs <package|install|publish|uninstall>\n');
  process.exit(1);
}
