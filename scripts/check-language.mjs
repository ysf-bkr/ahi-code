/**
 * Ajan yönergelerinin dilini denetler.
 *
 * `AGENTS.md` ve `.agents/**` altındaki tüm `.md` dosyaları ajan tarafından
 * okunur ve İngilizce olmak zorundadır. Diğer içerik (yorumlar, README,
 * docs) Türkçedir; bu betik yalnızca ajan dosyalarını denetler.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const TURKISH = /[çğıöşüÇĞİÖŞÜ]/;

/** İngilizce olması zorunlu dosyaları toplar. */
function collectAgentDocs() {
  const files = [resolve(root, 'AGENTS.md')];
  const agentsDir = resolve(root, '.agents');

  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return; // .agents klasörü yoksa denetlenecek dosya da yoktur.
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry.endsWith('.md')) {
        files.push(full);
      }
    }
  };

  walk(agentsDir);
  return files;
}

const problems = [];

for (const file of collectAgentDocs()) {
  let content;
  try {
    content = readFileSync(file, 'utf-8');
  } catch {
    continue; // Dosya yoksa atla; varlığı başka bir betiğin işi.
  }

  content.split('\n').forEach((line, index) => {
    if (TURKISH.test(line)) {
      problems.push(`${relative(root, file)}:${index + 1}: ${line.trim()}`);
    }
  });
}

if (problems.length > 0) {
  process.stderr.write(
    `Ajan dosyalarında Türkçe karakter bulundu (İngilizce olmalı):\n- ${problems.join('\n- ')}\n`
  );
  process.exit(1);
}

process.stdout.write('Dil politikası doğrulandı: ajan dosyaları İngilizce.\n');
