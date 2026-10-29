import * as path from 'path';
import { AuditLog } from './AuditLog';

/**
 * CLI giriş noktası: `npm run audit:verify -- [--workspace <yol>]`.
 * Zincir bozuksa 1 koduyla çıkar, böylece CI'da çalıştırılabilir.
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let workspace = process.cwd();

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if ((arg === '--workspace' || arg === '-w') && argv[index + 1]) {
      workspace = path.resolve(argv[index + 1] as string);
      index++;
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write('Usage: npm run audit:verify -- [--workspace <path>]\n');
      return;
    }
  }

  const result = await AuditLog.verify(workspace);
  if (result.ok) {
    process.stdout.write(`${result.message}\n`);
    if (result.headHash) process.stdout.write(`Head hash: ${result.headHash}\n`);
    return;
  }

  process.stderr.write(`Audit verification failed: ${result.message}\n`);
  process.stderr.write(`Verified entries before failure: ${result.entries}\n`);
  process.exitCode = 1;
}

void main().catch((error: unknown) => {
  process.stderr.write(`Audit verification error: ${String(error)}\n`);
  process.exitCode = 1;
});
