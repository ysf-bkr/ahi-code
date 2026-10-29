/**
 * Coverage kapısı.
 *
 * Node'un yerleşik coverage raporlayıcısı stdout'a bir metin tablosu yazar.
 * Bu betik özet satırını ayrıştırır ve satır kapsamı taban değerin altına
 * düşerse başarısız kılar; böylece testsiz kod ekleyen bir değişiklik,
 * kapsamın sessizce aşınması yerine CI'da yakalanır.
 *
 * Eşik bilinçli olarak mevcut değerin altındadır: amacı bir gerilemeyi
 * durdurmaktır, gerçek VS Code host'u gerektiren `terminalExecution.ts` ve
 * `LspClient.ts` gibi host'a bağımlı dosyalar için kapsam dayatmak değil.
 */
import { spawnSync } from 'node:child_process';

/** `src/**` için yüzde olarak satır kapsamı taban değeri. */
const MIN_LINE_COVERAGE = 75;

process.stdout.write(`Running coverage (floor: ${MIN_LINE_COVERAGE}% lines)...\n`);

const result = spawnSync(
  process.execPath,
  [
    '--experimental-test-coverage',
    '--import',
    'tsx',
    '--import',
    './test/support/register-vscode.mjs',
    '--test',
    'test/unit/**/*.test.ts'
  ],
  { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 }
);

const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

// Özet satırı şöyle görünür: "ℹ all files | 80.5 | 72.5 | 82.7 |"
const summary = output
  .split('\n')
  .map((line) => line.replace(/^[^a-z]*/i, '').trim())
  .find((line) => line.startsWith('all files'));

if (result.status !== 0 || !summary) {
  process.stderr.write(output.slice(-4_000));
  process.stderr.write('\nCoverage run failed or the summary line was not found.\n');
  process.exit(1);
}

const columns = summary.split('|').map((cell) => cell.trim());
const lineCoverage = Number.parseFloat(columns[1] ?? '');

if (!Number.isFinite(lineCoverage)) {
  process.stderr.write(`Could not parse line coverage from: ${summary}\n`);
  process.exit(1);
}

process.stdout.write(`Line coverage: ${lineCoverage}% (floor ${MIN_LINE_COVERAGE}%)\n`);

if (lineCoverage < MIN_LINE_COVERAGE) {
  process.stderr.write(
    `Coverage gate failed: ${lineCoverage}% is below the ${MIN_LINE_COVERAGE}% floor.\n` +
      'Add tests for the new code, or lower the floor deliberately with a reason.\n'
  );
  process.exit(1);
}
