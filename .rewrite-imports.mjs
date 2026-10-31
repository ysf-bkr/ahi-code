// Geçici taşıma aracı: eski src/ konumuna bakan göreli importları, hedef
// packages/core/src'e taşındıysa '@ahicode/core/...' alias'ına çevirir.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

const coreRoot = resolve('packages/core/src');
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const files = [];
const walk = (d) => {
  let es; try { es = readdirSync(d); } catch { return; }
  for (const e of es) { const f = join(d, e); if (statSync(f).isDirectory()) walk(f); else if (/\.(ts|tsx)$/.test(e)) files.push(f); }
};
for (const d of ['src', 'test', 'packages/cli/src']) walk(d);

let changedFiles = 0, changedEdges = 0;
const broken = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const out = text.replace(/(from\s+')(\.[^']+)(')/g, (whole, pre, spec, post) => {
    const base = resolve(dirname(file), spec);
    if ([base+'.ts', base+'.tsx', join(base,'index.ts')].some(isFile)) return whole; // hâlâ geçerli
    const rel = relative(process.cwd(), base);
    if (rel.startsWith('src/')) {
      const sub = rel.slice(4);
      if (isFile(join(coreRoot, sub + '.ts')) || isFile(join(coreRoot, sub, 'index.ts'))) {
        changedEdges += 1;
        return `${pre}@ahicode/core/${sub}${post}`;
      }
      broken.push(`${file}: ${spec}`);
    }
    return whole;
  });
  if (out !== text) { writeFileSync(file, out); changedFiles += 1; }
}
console.log(`yeniden yazılan dosya: ${changedFiles}, çevrilen kenar: ${changedEdges}`);
if (broken.length) console.log('ÇÖZÜMLENEMEZ:\n' + broken.join('\n'));
