/**
 * "shell" grubunun araçları.
 *
 * Eski tek parça tools/index.ts'ten ayrıldı; davranış değişmedi.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import { ToolDefinition, TerminalRunner } from './base';
import { isDangerousCommand } from '../shared/commandPolicy';
import { buildSandboxInvocation, sanitizeEnv } from '../core/verification/CommandRunner';
import type { SandboxConfig } from '../core/verification/CommandRunner';
import { SecurityError } from '../shared/errors';
import { COMMAND_TIMEOUT_MS, MAX_TOOL_OUTPUT_CHARS } from '../shared/constants';

export const executeCommandTool: ToolDefinition = {
  name: 'execute_command',
  description: 'Runs a shell command in the terminal (e.g. npm test, build, lint).',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Terminal command to execute.'
      }
    },
    required: ['command']
  },
  execute: async (args, context) => {
    if (!context.workspaceRoot) {
      throw new Error('Workspace not found.');
    }
    const command = String(args.command || '').trim();
    if (!command) {
      throw new Error('Command to execute cannot be empty.');
    }
    return runShellCommand(command, context.workspaceRoot, context.signal, context.sandbox, context.terminal);
  }
};

export async function runShellCommand(
  command: string,
  workspaceRoot: string,
  signal?: AbortSignal,
  sandbox?: SandboxConfig,
  terminal?: TerminalRunner
): Promise<string> {
  if (isDangerousCommand(command)) {
    throw new SecurityError(
      `Security violation: Dangerous command pattern detected ('${command}'). This command is blocked for system security.`
    );
  }

  // Kullanıcı komutları görmek istedi: terminal çalıştırıcısı varsa (eklenti
  // ana bilgisayarı) ve Docker yalıtımı kapalıysa komut VS Code tümleşik
  // terminalinde çalışır. CLI'de çalıştırıcı yoktur, gizli süreç yolu kalır.
  if (!sandbox && terminal) {
    return terminal(command, workspaceRoot, signal);
  }

  return new Promise<string>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Command was cancelled by the user.'));
      return;
    }

    const sandboxed = sandbox ? buildSandboxInvocation(command, sandbox) : undefined;
    // API anahtarı ya da token içeren ortam değişkenlerinin komut çıktısına
    // sızmasını önle (örn. `env`); CommandRunner.sanitizeEnv ile aynı davranış.
    const runEnv = sanitizeEnv(process.env);
    const child = sandboxed
      ? spawn(sandboxed.file, sandboxed.args, {
          cwd: workspaceRoot,
          env: runEnv,
          detached: process.platform !== 'win32'
        })
      : spawn(command, {
          cwd: workspaceRoot,
          shell: true,
          env: runEnv,
          detached: process.platform !== 'win32'
        });

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const appendOutput = (
      current: string,
      chunk: Buffer,
      markTruncated: (value: boolean) => void
    ): string => {
      const remaining = MAX_TOOL_OUTPUT_CHARS - current.length;
      const text = chunk.toString('utf-8');
      if (text.length > remaining) {
        markTruncated(true);
        return current + text.slice(0, Math.max(0, remaining));
      }
      return current + text;
    };

    // Düz `let` yerine tutucu: alt süreç spawn sırasında eşzamanlı hata
    // verirse kapanış geçici ölü bölgeye düşmez.
    const timerRef: { id?: NodeJS.Timeout } = {};

    const cleanup = () => {
      if (timerRef.id) clearTimeout(timerRef.id);
      signal?.removeEventListener('abort', onAbort);
    };

    const finish = (error: Error | null, code: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();

      if (aborted) {
        reject(new Error('Command was cancelled by the user.'));
        return;
      }
      if (error) {
        reject(error);
        return;
      }

      const result = stdout + (stderr ? `\n[STDERR]:\n${stderr}` : '');
      const trimmed = result.trim() || 'Command completed with no output.';
      const suffix =
        stdoutTruncated || stderrTruncated || trimmed.length > MAX_TOOL_OUTPUT_CHARS
          ? '\n\n[... Output truncated at 15000 characters ...]'
          : '';
      const limited = trimmed.slice(0, MAX_TOOL_OUTPUT_CHARS - suffix.length) + suffix;
      const timeoutMessage = timedOut ? `\nCommand timed out after ${COMMAND_TIMEOUT_MS / 1000} sec.` : '';
      resolve(
        code === 0 && !timedOut
          ? `${limited}${timeoutMessage}`
          : `Command failed (exit code: ${code ?? 'unknown'}).${timeoutMessage}\n${limited}`
      );
    };

    // `npm test` gibi komutların artık süreç bırakmaması için tüm süreç
    // grubunu sonlandır (CommandRunner.killTree ile aynı yaklaşım).
    const killTree = (signal: NodeJS.Signals = 'SIGTERM') => {
      if (child.pid === undefined) return;
      try {
        if (process.platform === 'win32') {
          child.kill(signal);
        } else {
          process.kill(-child.pid, signal);
        }
      } catch {
        // Süreç grubu zaten yok olmuş olabilir; alt sürecin kendisine düş.
        child.kill(signal);
      }
    };

    const onAbort = () => {
      aborted = true;
      killTree('SIGTERM');
      setTimeout(() => killTree('SIGKILL'), 1000);
    };

    timerRef.id = setTimeout(() => {
      timedOut = true;
      killTree('SIGTERM');
      setTimeout(() => killTree('SIGKILL'), 1000);
    }, COMMAND_TIMEOUT_MS);

    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (data: Buffer) => {
      stdout = appendOutput(stdout, data, (value) => {
        stdoutTruncated ||= value;
      });
    });
    child.stderr?.on('data', (data: Buffer) => {
      stderr = appendOutput(stderr, data, (value) => {
        stderrTruncated ||= value;
      });
    });
    child.on('error', (err) => finish(err, null));
    child.on('close', (code) => finish(null, code));
  });
}

export async function detectTestCommand(workspaceRoot: string): Promise<string> {
  const exists = async (file: string) => {
    try {
      await fs.access(path.join(workspaceRoot, file));
      return true;
    } catch {
      // İşaret dosyası yok: o paket yöneticisi kullanılmıyor.
      return false;
    }
  };

  if (await exists('pnpm-lock.yaml')) return 'pnpm test';
  if (await exists('yarn.lock')) return 'yarn test';
  if (await exists('package.json')) return 'npm test';
  if (await exists('Cargo.toml')) return 'cargo test';
  if (await exists('go.mod')) return 'go test ./...';
  if (await exists('pubspec.yaml')) return 'flutter test';
  if (await exists('Package.swift')) return 'swift test';
  if (await exists('gradlew')) return './gradlew test';
  if ((await exists('build.gradle')) || (await exists('build.gradle.kts'))) return 'gradle test';
  if ((await exists('pyproject.toml')) || (await exists('pytest.ini'))) return 'pytest';
  return 'npm test';
}

export async function detectLintCommand(workspaceRoot: string): Promise<string> {
  const exists = async (file: string) => {
    try {
      await fs.access(path.join(workspaceRoot, file));
      return true;
    } catch {
      return false;
    }
  };

  try {
    const pkgRaw = await fs.readFile(path.join(workspaceRoot, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgRaw);
    if (pkg?.scripts?.lint) {
      return 'npm run lint';
    }
  } catch {
    // package.json yok veya bozuk.
  }
  // TypeScript kontrolünü yalnızca projede gerçekten tsconfig varsa öner;
  // yoksa yanlış bir şey çalıştırmak yerine açık bir komut iste.
  if (await exists('tsconfig.json')) return 'npx tsc --noEmit';
  if (await exists('Cargo.toml')) return 'cargo clippy --all-targets';
  if (await exists('go.mod')) return 'go vet ./...';
  if (await exists('pubspec.yaml')) return 'flutter analyze';
  if (await exists('gradlew')) return './gradlew lint';
  if ((await exists('build.gradle')) || (await exists('build.gradle.kts'))) return 'gradle lint';

  throw new Error(
    'No lint command detected for this project. Pass an explicit command, for example `run_linter` with "cargo clippy", "flutter analyze", or "ruff check .".'
  );
}

export const runTestsTool: ToolDefinition = {
  name: 'run_tests',
  description:
    'Runs the project tests. If no command is provided, selects one automatically based on the project type (npm/pnpm/yarn/pytest).',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Optional custom test command (e.g. npm test -- --watchAll=false).'
      }
    },
    required: []
  },
  execute: async (args, context) => {
    if (!context.workspaceRoot) {
      throw new Error('Workspace not found.');
    }
    const command = String(args.command || '').trim() || (await detectTestCommand(context.workspaceRoot));
    return runShellCommand(command, context.workspaceRoot, context.signal, context.sandbox, context.terminal);
  }
};

export const runLinterTool: ToolDefinition = {
  name: 'run_linter',
  description:
    'Runs the project linter/type check. If no command is provided, uses the package.json lint script or tsc automatically.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Optional custom lint command.'
      }
    },
    required: []
  },
  execute: async (args, context) => {
    if (!context.workspaceRoot) {
      throw new Error('Workspace not found.');
    }
    const command = String(args.command || '').trim() || (await detectLintCommand(context.workspaceRoot));
    return runShellCommand(command, context.workspaceRoot, context.signal, context.sandbox, context.terminal);
  }
};
