import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const testDir = resolve(root, 'test/unit');
const errors = [];

// Kalıcı yazma yapan API'ler: promise, callback ve sync varyantları.
const WRITE_METHODS = [
  'writeFile',
  'writeFileSync',
  'appendFile',
  'appendFileSync',
  'mkdir',
  'mkdirSync',
  'rm',
  'rmSync',
  'unlink',
  'unlinkSync',
  'cp',
  'cpSync',
  'rename',
  'renameSync',
  'createWriteStream'
].join('|');

// `fs.writeFile(...)`, `fsp.rm(...)` gibi takma adlı import'ları da yakala.
const writePattern = new RegExp(`\\.\\s*(?:${WRITE_METHODS})\\s*\\(`);
// `import { writeFileSync } from 'node:fs'` gibi doğrudan adlandırılmış import'lar.
const bareWritePattern = new RegExp(
  `\\b(?:writeFileSync|appendFileSync|mkdirSync|rmSync|unlinkSync|cpSync|renameSync|createWriteStream|writeFile|appendFile|mkdir|rm|unlink|cp|rename)\\s*\\(`
);
// `open`/`openSync` yalnızca yazma bayrağıyla kalıcı yazma sayılır.
const openWritePattern = /\.\s*open(?:Sync)?\s*\([^)]*['"](?:w|a|wx|ax|w\+|a\+|r\+)['"]/;
const tempPattern = /tmpdir\(\)/;

/** Alt klasörlerdeki testleri de tara: yeni bir klasör sessizce atlanmasın. */
function collectTestFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...collectTestFiles(full));
    } else if (entry.endsWith('.test.ts')) {
      found.push(full);
    }
  }
  return found;
}

for (const file of collectTestFiles(testDir)) {
  const relative = file.slice(testDir.length + 1);
  const content = readFileSync(file, 'utf-8');
  const writes =
    writePattern.test(content) || bareWritePattern.test(content) || openWritePattern.test(content);
  if (writes && !tempPattern.test(content)) {
    errors.push(`${relative}: writes files without os.tmpdir()`);
  }
  if (writes && /process\.cwd\(\)/.test(content)) {
    errors.push(`${relative}: file write relative to process.cwd()`);
  }
}

if (errors.length > 0) {
  process.stderr.write(`Test isolation errors:\n- ${errors.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write('Test isolation verified: persistent writes stay under os.tmpdir().\n');
