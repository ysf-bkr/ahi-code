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

/** Terminalin hangi çalışma alanı için açıldığını izler; kök değişince yenisi açılır. */
const terminalRoots = new WeakMap<object, string>();

/**
 * POSIX tarzı tek tırnak kaçışı. sh/bash/zsh ve PowerShell içinde `$()`,
 * backtick ve boşluk etkisiz kalır; çift tırnak POSIX kabuklarında komut
 * enjeksiyonuna açıktı (denetim bulgusu F02). cmd.exe tek tırnağı tanımaz:
 * orada `cd` başarısız olur ve komut hiç çalışmaz — yanlış dizinde çalışmaktan
 * güvenli taraftır.
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function runInIntegratedTerminal(
  command: string,
  workspaceRoot: string,
  options: TerminalRunOptions = {}
): Promise<string> {
  const signal = options.signal;
  if (signal?.aborted) {
    throw new Error('Command was cancelled by the user.');
  }
  const terminalName = options.terminalName ?? CLIENT_NAME;

  // Terminal yalnızca aynı çalışma alanı için yeniden kullanılır. Çalışma
  // dizini böylece komut metnine gömülmez (F02) ve başka klasörden kalan
  // terminalde yanlış dizinde çalışma olmaz (F08).
  const existing = vscode.window.terminals.find(
    (candidate) =>
      candidate.name === terminalName &&
      candidate.exitStatus === undefined &&
      terminalRoots.get(candidate) === workspaceRoot
  );
  const terminal = existing ?? vscode.window.createTerminal({ name: terminalName, cwd: workspaceRoot });
  terminalRoots.set(terminal, workspaceRoot);
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
    // Entegrasyon yoksa sonuç bilinmez; en azından komutun doğru dizinde
    // başladığından emin ol (F08). cd öneki tek tırnakla taşınır (F02).
    terminal.sendText(`cd ${shellQuote(workspaceRoot)} && ${command}`, true);
    return (
      `The command was started in the "${terminalName}" terminal. Its output could not be captured ` +
      'because shell integration is not active; open the terminal to read it.'
    );
  }

  // Terminal doğru kök için açıldı; `cd` öneki gerekmez.
  const execution = shellIntegration.executeCommand(command);
  const stream = execution.read();

  let output = '';
  let timedOut = false;

  // Bitiş dinleyicisi okuma yarışından ÖNCE kurulur: yürütme-sonu olayı akış
  // kapanır kapanmaz gelebilir; sonra abone olmak çıkış kodunu kaçırır ve
  // başarısız komut başarılı görünür (denetim bulgusu F08).
  let resolveExit!: (code: number | undefined) => void;
  const exitCodePromise = new Promise<number | undefined>((resolve) => {
    resolveExit = resolve;
  });
  const endSubscription = vscode.window.onDidEndTerminalShellExecution((event) => {
    if (event.execution === execution) resolveExit(event.exitCode);
  });

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

  // Çıkış kodu yürütme-sonu olayından gelir. İptal veya zaman aşımından sonra
  // komut bir kod bildirmeyebilir; bu yüzden onu beklemeye girme.
  let exitCode: number | undefined;
  if (!timedOut && !signal?.aborted) {
    exitCode = await Promise.race([
      exitCodePromise,
      new Promise<undefined>((resolve) => {
        setTimeout(() => resolve(undefined), COMMAND_TIMEOUT_MS);
      })
    ]);
  }
  endSubscription.dispose();

  const clean = stripAnsi(output).trim();

  if (signal?.aborted) {
    throw new Error('Command was cancelled by the user.');
  }
  if (timedOut) {
    // Zaman aşımı yalnızca bekleyişi bırakıyordu; komut terminale çalışmaya
    // devam ediyordu. Süreci durdur ve sonra hata ver (F08).
    try {
      terminal.sendText('\u0003', false);
    } catch {
      // Terminal zaten kapanmış.
    }
    throw new Error(
      `Command timed out after ${Math.round(COMMAND_TIMEOUT_MS / 1000)} sec in the integrated terminal.`
    );
  }

  const body = clean ? limitWithMarker(clean, MAX_TOOL_OUTPUT_CHARS) : 'Command completed with no output.';
  return exitCode === undefined || exitCode === 0
    ? body
    : `Command failed (exit code: ${exitCode}).\n${body}`;
}
