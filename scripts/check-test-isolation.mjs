import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const testDir = resolve(root, 'test/unit');
const errors = [];
const writePattern = /fs\.(writeFile|appendFile|mkdir|rm|unlink|cp|rename)\s*\(/;
const tempPattern = /os\.tmpdir\(\)/;

for (const file of readdirSync(testDir).filter((name) => name.endsWith('.test.ts'))) {
  const content = readFileSync(resolve(testDir, file), 'utf-8');
  if (writePattern.test(content) && !tempPattern.test(content)) {
    errors.push(`${file}: writes files without os.tmpdir()`);
  }
  if (/process\.cwd\(\)/.test(content) && writePattern.test(content)) {
    errors.push(`${file}: file write relative to process.cwd()`);
  }
}

if (errors.length > 0) {
  process.stderr.write(`Test isolation errors:\n- ${errors.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write('Test isolation verified: persistent writes stay under os.tmpdir().\n');
