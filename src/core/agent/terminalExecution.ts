import * as vscode from 'vscode';
import { CLIENT_NAME, COMMAND_TIMEOUT_MS, MAX_TOOL_OUTPUT_CHARS } from '../../shared/constants';
import { limitWithMarker, stripAnsi } from '../../shared/text';

export interface TerminalRunOptions {
  signal?: AbortSignal;
  /** Komutlar arasında yeniden kullanılır; kullanıcı tek bir terminal görür. */
  terminalName?: string;
}

/**
 * Bir komutu VS Code tümleşik terminalinde çalıştırır ve çıktısını döndürür.
 *
 * Kullanıcı ajan komutlarını normalde çalıştığı yerde görmek ister. Kabuk
 * entegrasyonu çıktı akışını ve çıkış kodunu sağlar; etkin değilse komut
 * yine terminalde çalışır ve çağırana çıktının yakalanamadığı söylenir (bu
 * durumda sessizce gizli süreç yoluna düşülmez).
 *
 * `AgentCore`'dan ayrıldı; ajan döngüsü yalnızca orkestrasyon yapar.
 */
export async function runInIntegratedTerminal(
  command: string,
  workspaceRoot: string,
  options: TerminalRunOptions = {}
): Promise<string> {
  const signal = options.signal;
  const terminalName = options.terminalName ?? CLIENT_NAME;
  const existing = vscode.window.terminals.find(
    (candidate) => candidate.name === terminalName && candidate.exitStatus === undefined
  );
  const terminal = existing ?? vscode.window.createTerminal({ name: terminalName, cwd: workspaceRoot });
  terminal.show(true);

  // Shell integration yeni terminal açıldığında asenkron bağlanır; kısa süre bekle
  let shellIntegration = terminal.shellIntegration;
  if (!shellIntegration && typeof vscode.window.onDidChangeTerminalShellIntegration === 'function') {
    shellIntegration = await new Promise<vscode.TerminalShellIntegration | undefined>((resolve) => {
      const timer = setTimeout(() => {
        sub.dispose();
        resolve(terminal.shellIntegration);
      }, 1500);
      const sub = vscode.window.onDidChangeTerminalShellIntegration((e) => {
        if (e.terminal === terminal) {
          clearTimeout(timer);
          sub.dispose();
          resolve(e.shellIntegration);
        }
      });
    });
  }

  if (!shellIntegration) {
    terminal.sendText(command, true);
    return (
      `The command was started in the "${terminalName}" terminal. Its output could not be captured ` +
      'because shell integration is not active; open the terminal to read it.'
    );
  }

  // Terminal başka bir klasörden yeniden kullanılmış olabilir; komutun
  // görevin çalışma alanında çalıştığından emin ol.
  const commandLine = `cd ${JSON.stringify(workspaceRoot)} && ${command}`;
  const execution = shellIntegration.executeCommand(commandLine);
  const stream = execution.read();

  let output = '';
  let timedOut = false;
  const reader = (async () => {
    for await (const chunk of stream) {
      output += chunk;
      if (output.length >= MAX_TOOL_OUTPUT_CHARS) break;
    }
  })();

  const timeout = new Promise<void>((resolve) => {
    setTimeout(() => {
      timedOut = true;
      resolve();
    }, COMMAND_TIMEOUT_MS);
  });
  const abort = new Promise<void>((resolve) => {
    signal?.addEventListener('abort', () => resolve(), { once: true });
  });

  // Yalnızca promise yarışını iptal etmek komutu terminalde çalışır
  // bırakıyordu. Kullanıcının "dur"u işi gerçekten durdursun diye Ctrl+C
  // gönder ve dinleyiciyi kaldır ki her komutta birikmesin.
  const onAbort = () => {
    try {
      terminal.sendText('\u0003', false);
    } catch {
      // Terminal zaten kapanmış.
    }
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    await Promise.race([reader, timeout, abort]);
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }

  // Çıkış kodu execution nesnesinden değil, yürütme-sonu olayından gelir.
  // İptal veya zaman aşımından sonra komut hiç bildirmeyebilir; bekleme.
  // report one, so do not wait for it.
  let exitCode: number | undefined;
  if (!timedOut && !signal?.aborted) {
    try {
      exitCode = await new Promise<number | undefined>((resolve) => {
        const subscription = vscode.window.onDidEndTerminalShellExecution((event) => {
          if (event.execution !== execution) return;
          subscription.dispose();
          resolve(event.exitCode);
        });
        setTimeout(() => {
          subscription.dispose();
          resolve(undefined);
        }, COMMAND_TIMEOUT_MS);
      });
    } catch {
      // Terminal kapatıldı ya da kabuk entegrasyonu yürütmeyi kaybetti.
    }
  }

  const clean = stripAnsi(output).trim();

  if (signal?.aborted) {
    throw new Error('Command was cancelled by the user.');
  }
  if (timedOut) {
    throw new Error(
      `Command timed out after ${Math.round(COMMAND_TIMEOUT_MS / 1000)} sec in the integrated terminal.`
    );
  }

  const body = clean ? limitWithMarker(clean, MAX_TOOL_OUTPUT_CHARS) : 'Command completed with no output.';
  return exitCode === undefined || exitCode === 0
    ? body
    : `Command failed (exit code: ${exitCode}).\n${body}`;
}
