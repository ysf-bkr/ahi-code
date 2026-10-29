/**
 * Dil politikası denetleyicisi.
 *
 * 1. Ajan dosyaları (AGENTS.md ve .agents altındaki tüm .md dosyaları)
 *    İngilizce olmalıdır: bunları ajan kendisi okur, tek dil tutarlılığı sağlar.
 * 2. Kaynak kodundaki tam satır yorumlar Türkçe olmalıdır (AGENTS.md politikası).
 *
 * Yorum denetimi bilinçli olarak muhafazakârdır: yalnızca Türkçe yorumlarda
 * bağımsız kelime olarak hemen hiç geçmeyen İngilizce işlev sözcükleri
 * ("the", "and", "must"...) aranır ve Türkçe karakter içeren satırlar atlanır.
 * Böylece yanlış pozitif üretmez; kapsama değil, regresyonu önlemeye odaklanır.
 * Satır sonu (inline) yorumlar denetlenmez.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const TURKISH = /[çğıöşüÇĞİÖŞÜ]/;

/**
 * Türkçe bir yorumda bağımsız kelime olarak geçmesi beklenmeyen güçlü
 * İngilizce işlev sözcükleri. Tek eşleşme bile İngilizce satır belirtisidir.
 */
const STRONG_ENGLISH_WORDS =
  /\b(the|and|with|that|when|must|should|will|been|was|were|because|instead|previously|currently|also|only|here|does|doesn|into|using|but|after|before|keep|never|always|isn|aren|would|couldn|shouldn)\b/i;

/**
 * Yorumlanmış koddaki tanımlayıcılarla kolayca karışabilen zayıf sözcükler.
 * Bunlar tek başına işaret sayılmaz; ancak iki farklı zayıf sözcük ya da
 * zayıf + güçlü birleşimi İngilizce satır sayılır.
 */
const WEAK_ENGLISH_WORDS = /\b(this|for|from)\b/gi;

/** Araç yönergeleri: yorum gibi görünür ama çevrilmez. */
const DIRECTIVE_PREFIXES = /^(eslint|prettier|@ts|biome|istanbul|c8|node:|nolint|v8|sourceURL|ts-expect)/i;

/** Yorum denetimi kapsamındaki kod dizinleri. */
const CODE_DIRS = ['src', 'test', 'scripts', 'webview-ui/src', 'webview-ui/test'];

/** Tarama dışı bırakılan yollar: fixture, bir kullanıcı projesini simüle eder. */
const EXCLUDED = [/^test[\\/]e2e[\\/]fixture([\\/]|$)/];

/** İngilizce olması zorunlu ajan dosyalarını toplar. */
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

/** Yorum denetimi kapsamındaki kod dosyalarını toplar. */
function collectCodeFiles() {
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return; // Dizin yoksa denetlenecek dosya da yoktur.
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx|mjs|js)$/.test(entry)) {
        files.push(full);
      }
    }
  };
  for (const dir of CODE_DIRS) walk(resolve(root, dir));
  files.push(resolve(root, 'esbuild.js'));
  return files;
}

/** Satırın tamamı yorumsa yorum metnini, değilse null döner. */
function commentText(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('//')) return trimmed.slice(2).trim();
  if (trimmed.startsWith('/*'))
    return trimmed
      .replace(/^\/\*+/, '')
      .replace(/\*\/$/, '')
      .trim();
  if (trimmed.startsWith('*')) return trimmed.replace(/^\*+/, '').trim();
  return null;
}

/** Yorum metni İngilizce görünümlü mü? (Türkçe karaktersiz + işlev sözcükleri) */
function looksEnglish(text) {
  if (!text || TURKISH.test(text)) return false;
  if (DIRECTIVE_PREFIXES.test(text)) return false;

  if (STRONG_ENGLISH_WORDS.test(text)) return true;

  const weak = new Set();
  let match;
  WEAK_ENGLISH_WORDS.lastIndex = 0;
  while ((match = WEAK_ENGLISH_WORDS.exec(text)) !== null) {
    weak.add(match[0].toLowerCase());
  }
  return weak.size >= 2;
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

const agentDocProblems = problems.length;

for (const file of collectCodeFiles()) {
  const rel = relative(root, file);
  if (EXCLUDED.some((pattern) => pattern.test(rel))) continue;

  let content;
  try {
    content = readFileSync(file, 'utf-8');
  } catch {
    continue;
  }

  content.split('\n').forEach((line, index) => {
    const text = commentText(line);
    if (text !== null && looksEnglish(text)) {
      problems.push(`${rel}:${index + 1}: ${line.trim()}`);
    }
  });
}

if (problems.length > 0) {
  const scope =
    agentDocProblems > 0
      ? 'Ajan dosyalarında Türkçe karakter bulundu (İngilizce olmalı)'
      : 'Kaynak kod yorumlarında İngilizce bulundu (Türkçe olmalı)';
  process.stderr.write(`${scope}:\n- ${problems.join('\n- ')}\n`);
  process.exit(1);
}

process.stdout.write('Dil politikası doğrulandı: ajan dosyaları İngilizce, kaynak kod yorumları Türkçe.\n');
