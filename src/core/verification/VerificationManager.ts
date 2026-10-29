import * as path from 'path';
import { AHI_DIR, AHI_FILES } from '../../shared/constants';
import * as fs from 'fs/promises';
import { CommandResult, runCommand, sanitizeEnv, SandboxConfig } from './CommandRunner';
import { isRecord } from '../../shared/errors';

export type VerificationStepKind = 'test' | 'lint' | 'typecheck' | 'build';

export interface VerificationCommand {
  kind: VerificationStepKind;
  command: string;
}

export interface VerificationStepResult extends CommandResult {
  kind: VerificationStepKind;
}

export interface VerificationResult {
  status: 'passed' | 'failed' | 'skipped';
  steps: VerificationStepResult[];
  failedSteps: VerificationStepResult[];
  summary: string;
  /** Yeni hataları önceden var olanlardan ayıran hata imzası. */
  failureSignature: string[];
  durationMs: number;
  ranAt: number;
}

export interface VerificationOptions {
  commands?: VerificationCommand[];
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputChars?: number;
  env?: NodeJS.ProcessEnv;
  /** Komutları allow/deny kurallarına göre filtreler. */
  commandFilter?: (command: string) => boolean;
  sandbox?: SandboxConfig;
  /** Yalnızca belirli doğrulama türlerini çalıştır (adımlar arası hızlı kontrol). */
  kinds?: VerificationStepKind[];
}

const FAILURE_LINE_PATTERNS = [
  /\berror\b/i,
  /\bfailed\b/i,
  /\bfailure\b/i,
  /\bFAIL\b/,
  /not ok/i,
  /AssertionError/,
  /SyntaxError/,
  /TypeError/,
  /TS\d{4}/,
  /✕|×/,
  /expected .* received/i
];

function normalizeLine(line: string): string {
  return (
    line
      // eslint-disable-next-line no-control-regex -- ANSI renk kodları (ESC [ ... m) bilinçli eşlenir.
      .replace(/\x1b\[[0-9;]*m/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240)
  );
}

function extractFailureSignature(steps: VerificationStepResult[]): string[] {
  const signatures = new Set<string>();
  for (const step of steps) {
    if (step.ok) continue;
    signatures.add(`${step.kind}:${step.command}:exit=${step.exitCode ?? 'null'}`);
    for (const line of step.output.split('\n')) {
      const normalized = normalizeLine(line);
      if (!normalized || normalized.length < 4) continue;
      if (FAILURE_LINE_PATTERNS.some((pattern) => pattern.test(normalized))) {
        signatures.add(`${step.kind}:${normalized}`);
        if (signatures.size >= 80) break;
      }
    }
  }
  return [...signatures];
}

function summarize(result: VerificationResult): string {
  if (result.status === 'skipped') {
    return 'Verification skipped: no runnable test/lint command found.';
  }
  const lines = result.steps.map((step) => {
    const state = step.ok ? 'PASSED' : step.aborted ? 'CANCELLED' : step.timedOut ? 'TIMED OUT' : 'FAILED';
    return `- ${step.kind} (${step.command}) → ${state} [${Math.round(step.durationMs / 1000)} sec]`;
  });
  const failed = result.failedSteps.length;
  return `Verification ${result.status === 'passed' ? 'passed' : `failed (${failed} steps)`}: ${Math.round(result.durationMs / 1000)} sec\n${lines.join('\n')}`;
}

/**
 * Dosya değişikliklerinden sonra testleri, lint ve tip kontrollerini çalıştırır.
 * Sonuçları başlangıç durumuyla karşılaştırır; yeni hataları önceden var
 * olanlardan ayırır ve ajanın eski hataları boşuna düzeltmesini önler.
 */
export class VerificationManager {
  private baseline?: VerificationResult;
  private baselinePath?: string;
  private commandFilter?: (command: string) => boolean;
  private sandbox?: SandboxConfig;

  public setSandbox(sandbox?: SandboxConfig): void {
    this.sandbox = sandbox;
  }

  public getBaseline(): VerificationResult | undefined {
    return this.baseline;
  }

  public setCommandFilter(filter?: (command: string) => boolean): void {
    this.commandFilter = filter;
  }

  /**
   * Başlangıç durumunu çalışma alanına bağlar ve varsa kaydı yükler.
   */
  public async attachWorkspace(workspaceRoot?: string): Promise<void> {
    this.baselinePath = workspaceRoot
      ? path.join(workspaceRoot, AHI_DIR, AHI_FILES.verificationBaseline)
      : undefined;
    if (!this.baselinePath) {
      this.baseline = undefined;
      return;
    }
    try {
      const raw = await fs.readFile(this.baselinePath, 'utf-8');
      const parsed = JSON.parse(raw) as VerificationResult;
      if (parsed && Array.isArray(parsed.failureSignature)) {
        this.baseline = parsed;
      }
    } catch {
      // Başlangıç durumu yok: ilk görevde oluşturulabilir.
    }
  }

  public setBaseline(result: VerificationResult): void {
    this.baseline = result;
    void this.persistBaseline();
  }

  private async persistBaseline(): Promise<void> {
    if (!this.baselinePath || !this.baseline) return;
    try {
      await fs.mkdir(path.dirname(this.baselinePath), { recursive: true });
      const compact = {
        status: this.baseline.status,
        failureSignature: this.baseline.failureSignature,
        summary: this.baseline.summary,
        ranAt: this.baseline.ranAt,
        durationMs: this.baseline.durationMs,
        steps: this.baseline.steps.map((step) => ({
          kind: step.kind,
          command: step.command,
          ok: step.ok,
          exitCode: step.exitCode,
          durationMs: step.durationMs,
          timedOut: step.timedOut,
          aborted: step.aborted,
          output: step.ok ? '' : step.output.slice(0, 2_000)
        }))
      };
      await fs.writeFile(this.baselinePath, JSON.stringify(compact), {
        encoding: 'utf-8',
        mode: 0o600
      });
    } catch {
      // Başlangıç durumunun kalıcılığı ana iş akışını engellememeli.
    }
  }

  public clearBaseline(): void {
    this.baseline = undefined;
    if (this.baselinePath) {
      void fs.rm(this.baselinePath, { force: true }).catch(() => {});
    }
  }

  /**
   * Doğrulama komutlarını proje türüne göre seçer.
   */
  public async detectCommands(workspaceRoot: string): Promise<VerificationCommand[]> {
    const commands: VerificationCommand[] = [];
    const exists = async (file: string): Promise<boolean> => {
      try {
        await fs.access(path.join(workspaceRoot, file));
        return true;
      } catch {
        // Dosya yok: proje o betiği tanımlamıyor.
        return false;
      }
    };

    let pkg: unknown;
    try {
      pkg = JSON.parse(await fs.readFile(path.join(workspaceRoot, 'package.json'), 'utf-8'));
    } catch {
      // package.json yok veya bozuk: tespit edilecek bir şey yok.
      pkg = undefined;
    }

    const scripts = isRecord(pkg) && isRecord(pkg.scripts) ? pkg.scripts : {};
    const testScript = scripts.test;
    const lintScript = scripts.lint;
    const typecheckScript = scripts.typecheck;
    const buildScript = scripts.build;
    const packageManager = (await exists('pnpm-lock.yaml'))
      ? 'pnpm'
      : (await exists('yarn.lock'))
        ? 'yarn'
        : 'npm';

    if (testScript && !/no test specified/i.test(String(testScript))) {
      commands.push({
        kind: 'test',
        command: packageManager === 'npm' ? 'npm test' : `${packageManager} test`
      });
    } else if (await exists('Cargo.toml')) {
      commands.push({ kind: 'test', command: 'cargo test' });
    } else if (await exists('go.mod')) {
      commands.push({ kind: 'test', command: 'go test ./...' });
    } else if (await exists('pubspec.yaml')) {
      commands.push({ kind: 'test', command: 'flutter test' });
    } else if (await exists('Package.swift')) {
      commands.push({ kind: 'test', command: 'swift test' });
    } else if (
      (await exists('gradlew')) ||
      (await exists('build.gradle')) ||
      (await exists('build.gradle.kts'))
    ) {
      const gradleCmd = (await exists('gradlew')) ? './gradlew test' : 'gradle test';
      commands.push({ kind: 'test', command: gradleCmd });
    } else if (
      (await exists('pyproject.toml')) ||
      (await exists('pytest.ini')) ||
      (await exists('tox.ini')) ||
      (await exists('setup.cfg'))
    ) {
      commands.push({ kind: 'test', command: 'pytest -q' });
    }

    if (lintScript) {
      commands.push({
        kind: 'lint',
        command: packageManager === 'npm' ? 'npm run lint' : `${packageManager} lint`
      });
    } else if (await exists('Cargo.toml')) {
      commands.push({ kind: 'lint', command: 'cargo clippy --all-targets' });
    } else if (await exists('pubspec.yaml')) {
      commands.push({ kind: 'lint', command: 'flutter analyze' });
    } else if (await exists('go.mod')) {
      commands.push({ kind: 'lint', command: 'go vet ./...' });
    } else if (
      (await exists('gradlew')) ||
      (await exists('build.gradle')) ||
      (await exists('build.gradle.kts'))
    ) {
      const gradleLint = (await exists('gradlew')) ? './gradlew lint' : 'gradle lint';
      commands.push({ kind: 'lint', command: gradleLint });
    }

    if (typecheckScript) {
      commands.push({
        kind: 'typecheck',
        command: packageManager === 'npm' ? 'npm run typecheck' : `${packageManager} typecheck`
      });
    } else if (await exists('tsconfig.json')) {
      commands.push({ kind: 'typecheck', command: 'npx tsc --noEmit' });
    }

    if (buildScript && commands.length === 0) {
      commands.push({
        kind: 'build',
        command: packageManager === 'npm' ? 'npm run build' : `${packageManager} build`
      });
    }

    // Aynı komutu iki kez çalıştırma.
    const seen = new Set<string>();
    return commands.filter((item) => {
      if (seen.has(item.command)) return false;
      seen.add(item.command);
      return true;
    });
  }

  public async verify(
    workspaceRoot: string | undefined,
    options: VerificationOptions = {}
  ): Promise<VerificationResult> {
    const ranAt = Date.now();
    if (!workspaceRoot) {
      return {
        status: 'skipped',
        steps: [],
        failedSteps: [],
        summary: 'Verification skipped: workspace not found.',
        failureSignature: [],
        durationMs: 0,
        ranAt
      };
    }

    let commands = options.commands;
    if (!commands) {
      try {
        commands = await this.detectCommands(workspaceRoot);
      } catch {
        // Tespit hatası doğrulamayı durdurmamalı; atlanmış adıma dönüşür.
        commands = [];
      }
    }

    if (options.kinds && options.kinds.length > 0) {
      const allowedKinds = new Set(options.kinds);
      commands = commands.filter((item) => allowedKinds.has(item.kind));
    }
    const filter = options.commandFilter || this.commandFilter;
    if (filter) {
      commands = commands.filter((item) => filter(item.command));
    }

    if (commands.length === 0) {
      return {
        status: 'skipped',
        steps: [],
        failedSteps: [],
        summary: summarize({
          status: 'skipped',
          steps: [],
          failedSteps: [],
          summary: '',
          failureSignature: [],
          durationMs: 0,
          ranAt
        }),
        failureSignature: [],
        durationMs: 0,
        ranAt
      };
    }

    const startedAt = Date.now();
    const steps: VerificationStepResult[] = [];
    for (const item of commands) {
      if (options.signal?.aborted) break;
      const result = await runCommand(item.command, workspaceRoot, {
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        maxOutputChars: options.maxOutputChars,
        env: options.env || sanitizeEnv(process.env),
        sandbox: options.sandbox || this.sandbox
      });
      steps.push({ ...result, kind: item.kind });
    }

    if (steps.length === 0) {
      return {
        status: 'skipped',
        steps: [],
        failedSteps: [],
        summary: 'Verification was cancelled or no steps could be run.',
        failureSignature: [],
        durationMs: Date.now() - startedAt,
        ranAt
      };
    }

    const failedSteps = steps.filter((step) => !step.ok);
    const result: VerificationResult = {
      status: failedSteps.length > 0 ? 'failed' : 'passed',
      steps,
      failedSteps,
      summary: '',
      failureSignature: extractFailureSignature(steps),
      durationMs: Date.now() - startedAt,
      ranAt
    };
    result.summary = summarize(result);
    return result;
  }

  /**
   * Değişiklik sonrası doğrulama için yalnızca başlangıç durumunda olmayan hataları döndürür.
   */
  public getNewFailures(result: VerificationResult): string[] {
    if (!this.baseline) return result.failureSignature;
    const known = new Set(this.baseline.failureSignature);
    return result.failureSignature.filter((item) => !known.has(item));
  }

  /**
   * Model için onarım talimatları. Çıktı boyutu sınırlıdır.
   */
  public formatForPrompt(result: VerificationResult): string {
    const newFailures = this.getNewFailures(result);
    const header =
      result.status === 'passed'
        ? '=== AUTOMATIC VERIFICATION: PASSED ==='
        : '=== AUTOMATIC VERIFICATION: FAILED ===';

    const details = result.failedSteps
      .slice(0, 3)
      .map((step) => `--- ${step.kind}: ${step.command} ---\n${step.output.slice(0, 3_000)}`)
      .join('\n\n')
      .slice(0, 9_000);

    const baselineNote = this.baseline
      ? `\nBaseline comparison: found ${newFailures.length} new failure signatures.` +
        (newFailures.length === 0
          ? ' These failures existed before the changes; fix only new regressions.'
          : '')
      : '';

    return (
      `${header}
${result.summary}${baselineNote}
${details ? `\n${details}\n` : ''}
Instruction: Implement only a concrete next step that addresses these verification failures. ` +
      `If failures persist, analyze the output and run tests/lint until they pass.`
    );
  }
}
