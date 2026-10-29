/**
 * Coverage gate.
 *
 * Node's built-in coverage reporter writes a text table to stdout. This script
 * parses the summary line and fails when line coverage drops below the floor,
 * so a change that adds untested code is caught in CI instead of drifting down.
 *
 * The threshold is deliberately below the current value: it exists to stop a
 * regression, not to force coverage for host-dependent files such as
 * `terminalExecution.ts` and `LspClient.ts` that need a real VS Code host.
 */
import { spawnSync } from 'node:child_process';

/** Line-coverage floor as a percentage of `src/**`. */
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

// The summary line looks like: "ℹ all files | 80.5 | 72.5 | 82.7 |"
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
