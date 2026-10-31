import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (file) => readFileSync(resolve(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const uiPkg = JSON.parse(read('webview-ui/package.json'));
const version = pkg.version;
const errors = [];

const expected = (label, actual) => {
  if (actual !== version) errors.push(`${label}: ${actual} (expected ${version})`);
};

// Başlık dosyasındaki sürüm de manifest ile eşleşmeli.
const versionSource = read('packages/core/src/shared/version.ts');
const headerVersion = versionSource.match(/EXTENSION_VERSION\s*=\s*'([^']+)'/)?.[1];
expected('packages/core/src/shared/version.ts', headerVersion);

expected('package-lock.json version', lock.version);
expected('package-lock.json packages[""].version', lock.packages?.['']?.version);
for (const ws of ['packages/core', 'packages/cli']) {
  expected(`package-lock.json ${ws} version`, lock.packages?.[ws]?.version);
}
expected('webview-ui/package.json version', uiPkg.version);

const vsix = `out/ahi-code-${version}.vsix`;
// Vizyon belgesi bilinçli olarak build çıktı yolları içermez; bu yüzden
// yalnızca README'nin güncel paket adına atıfta bulunması gerekir.
for (const file of ['README.md']) {
  if (!read(file).includes(vsix)) errors.push(`${file}: missing reference to ${vsix}`);
}

const authorFiles = ['package.json', 'README.md', 'LICENSE'];
for (const file of authorFiles) {
  const content = read(file);
  if (!content.includes('Yusuf BEKAR')) errors.push(`${file}: missing developer name`);
  if (!content.includes('ybekar@msn.com')) errors.push(`${file}: missing e-mail`);
}

if (pkg.author?.name !== 'Yusuf BEKAR' || pkg.author?.email !== 'ybekar@msn.com') {
  errors.push('package.json author field is invalid');
}
if (uiPkg.author?.name !== 'Yusuf BEKAR' || uiPkg.author?.email !== 'ybekar@msn.com') {
  errors.push('webview-ui/package.json author field is invalid');
}

const stale = ['ahi-code-0.1.0.vsix', 'ahi-code-0.1.1.vsix', 'ahi-code-0.2.0.vsix', 'ahi-code-0.0.4.vsix'];
for (const file of ['README.md']) {
  const content = read(file);
  for (const item of stale) {
    if (content.includes(item)) errors.push(`${file}: stale version reference ${item}`);
  }
}

if (errors.length > 0) {
  process.stderr.write(`Version/consistency errors:\n- ${errors.join('\n- ')}\n`);
  process.exit(1);
}

process.stdout.write(`Version and developer info consistent: v${version} · Yusuf BEKAR <ybekar@msn.com>\n`);
