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

/** VS Code CLI yürütülebilir dosyasını ortam ve bilinen yollardan bulur. */
function resolveCodeCliPath() {
  if (process.env.VSCODE_BIN && existsSync(process.env.VSCODE_BIN)) {
    return process.env.VSCODE_BIN;
  }
  const probe = spawnSync('code', ['--version'], { stdio: 'ignore' });
  if (!probe.error && probe.status === 0) {
    return 'code';
  }
  const candidates = [
    '/opt/homebrew/bin/code',
    '/usr/local/bin/code',
    '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
    '/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders',
    '/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
    '/Applications/VSCodium.app/Contents/Resources/app/bin/codium',
    '/usr/bin/code',
    '/snap/bin/code',
    '/usr/share/code/bin/code',
    '/usr/bin/codium'
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
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
    process.stderr.write(`VSIX paketi bulunamadı: ${vsixPath}\n`);
    process.exit(1);
  }
  const codeCli = resolveCodeCliPath();
  if (!codeCli) {
    process.stderr.write(
      `\n[UYARI] VS Code CLI ('code') sistem yolunda (PATH) bulunamadı.\n\n` +
        `VSIX paketi başarıyla üretildi:\n  -> ${vsixPath}\n\n` +
        `Eklentiyi yüklemek için iki seçenek:\n` +
        `1. VS Code Komut Paletini açın (Cmd+Shift+P / Ctrl+Shift+P) -> "Shell Command: Install 'code' command in PATH" çalıştırın ve "npm run install:ext" komutunu tekrarlayın.\n` +
        `2. Ya da VS Code Eklentiler (Extensions) menüsünden (...) "Install from VSIX..." seçeneğini tıklayıp ${vsixPath} dosyasını seçin.\n\n`
    );
    process.exit(1);
  }
  process.stdout.write(`VS Code eklentisi yükleniyor (${codeCli})...\n`);
  run(codeCli, ['--install-extension', vsixPath, '--force']);
  process.stdout.write(`AhiCode başarıyla yüklendi.\n`);
} else if (action === 'publish') {
  if (!existsSync(vsixPath)) {
    process.stderr.write(`VSIX package not found: ${vsixPath}\n`);
    process.exit(1);
  }
  run(process.execPath, [resolveVsceCliPath(), 'publish', '--packagePath', vsixPath, '--skip-duplicate']);
} else if (action === 'uninstall') {
  const codeCli = resolveCodeCliPath() || 'code';
  run(codeCli, ['--uninstall-extension', `${manifest.publisher}.${manifest.name}`]);
} else {
  process.stderr.write('Usage: node scripts/extension-lifecycle.mjs <package|install|publish|uninstall>\n');
  process.exit(1);
}
