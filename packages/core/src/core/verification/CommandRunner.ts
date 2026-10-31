import { spawn } from 'child_process';

export interface CommandResult {
  command: string;
  ok: boolean;
  exitCode: number | null;
  output: string;
  durationMs: number;
  timedOut: boolean;
  aborted: boolean;
}

export interface SandboxConfig {
  image: string;
  workspaceRoot: string;
  network?: boolean;
}

export interface CommandRunOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputChars?: number;
  env?: NodeJS.ProcessEnv;
  sandbox?: SandboxConfig;
}

export function buildSandboxInvocation(
  command: string,
  sandbox: SandboxConfig
): { file: string; args: string[] } {
  const args = [
    'run',
    '--rm',
    '--init',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    ...(process.platform !== 'win32' && process.getuid && process.getgid
      ? ['--user', `${process.getuid()}:${process.getgid()}`]
      : []),
    ...(sandbox.network === true ? [] : ['--network', 'none']),
    '-e',
    'HOME=/tmp',
    '-v',
    `${sandbox.workspaceRoot}:/workspace`,
    '-w',
    '/workspace',
    sandbox.image,
    'sh',
    '-lc',
    command
  ];
  return { file: 'docker', args };
}

const SAFE_ENV_KEYS = [
  // Platformdan bağımsız temel değişkenler
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'TEMP',
  'TMP',
  'PWD',
  'CI',
  'TERM',
  'COLORTERM',
  'TZ',
  // Windows: npm, git ve node'un dayandığı kullanıcı/profil değişkenleri.
  'SYSTEMROOT',
  'COMSPEC',
  'PATHEXT',
  'WINDIR',
  'OS',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMFILES',
  'PROGRAMDATA',
  'PROGRAMFILES(X86)',
  'HOMEDRIVE',
  'HOMEPATH',
  'SYSTEMDRIVE',
  'ALLUSERSPROFILE',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE'
];

/** Proxy ve SSH agent değişkenleri: açıkça varsa geçirilir. */
const PROXY_SOCK_KEYS = /^(http_proxy|https_proxy|no_proxy|all_proxy|ssh_auth_sock)$/i;

/**
 * Ortam sırlarının otomatik doğrulama komutlarına sızmasını önler.
 * PATH/HOME ve NODE_* / npm_* gibi zorunlu değişkenler korunur;
 * API anahtarları, tokenlar, şifreler ve benzerleri geçirilmez.
 * Proxy değişkenleri (HTTP_PROXY vb.) ve SSH_AUTH_SOCK geçirilir ki
 * kurumsal ağlar ve SSH üzerinden Git çalışmaya devam etsin.
 */
export function sanitizeEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    const isSafe =
      SAFE_ENV_KEYS.includes(key) ||
      /^(NODE_|NPM_|PNPM_|YARN_|PYTHON|PIP_|VIRTUAL_ENV|JAVA_HOME|GOPATH|GOROOT|CARGO_HOME|RUSTUP_HOME|GIT_|XDG_)/i.test(
        key
      ) ||
      PROXY_SOCK_KEYS.test(key);
    // SSH_AUTH_SOCK adında "AUTH" geçer ama bir soket yoludur, sır değil.
    // GIT_*/XDG_* değişkenleri depo üst verisidir (ad, yol, yapılandırma),
    // bu yüzden kaba alt dize filtresi onları da düşürmemeli.
    const looksSecret =
      !PROXY_SOCK_KEYS.test(key) &&
      !/^(GIT_|XDG_)/i.test(key) &&
      /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)/i.test(key);
    if (isSafe && !looksSecret) {
      safe[key] = value;
    }
  }
  // Etkileşimsiz CI çıktısını yalnızca çağıran CI'yi kendisi ayarlamadıysa
  // zorla; açıkça kapatılmış CI (CI=0) önceden eziliyor ve aynı komut
  // farklı yürütme yollarında farklı davranıyordu.
  if (safe.CI === undefined) {
    safe.CI = '1';
  }
  return safe;
}

/**
 * Alt süreçleri de kapsayan güvenli komut çalıştırıcısı.
 * İptal veya zaman aşımında POSIX'te tüm süreç grubu sonlandırılır;
 * böylece `npm test` gibi komutlar artık süreç bırakmaz.
 */
export function runCommand(
  command: string,
  cwd: string,
  options: CommandRunOptions = {}
): Promise<CommandResult> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const maxOutputChars = options.maxOutputChars ?? 20_000;

  return new Promise<CommandResult>((resolve) => {
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let aborted = false;

    if (options.signal?.aborted) {
      resolve({
        command,
        ok: false,
        exitCode: null,
        output: 'Command stopped by the user.',
        durationMs: 0,
        timedOut: false,
        aborted: true
      });
      return;
    }

    const sandboxed = options.sandbox ? buildSandboxInvocation(command, options.sandbox) : undefined;
    // Çağıranın açık CI değerini koru (kullanıcının CI=0 ayarı burada
    // sessizce eziliyor ve tümleşik terminal yolundan ayrışıyordu).
    const baseEnv = options.env || process.env;
    const runEnv = baseEnv.CI === undefined ? { ...baseEnv, CI: '1' } : { ...baseEnv };
    const child = sandboxed
      ? spawn(sandboxed.file, sandboxed.args, {
          cwd,
          env: runEnv,
          detached: process.platform !== 'win32'
        })
      : spawn(command, {
          cwd,
          shell: true,
          env: runEnv,
          detached: process.platform !== 'win32'
        });

    const killTree = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        if (process.platform !== 'win32') {
          process.kill(-child.pid, signal);
        } else {
          child.kill(signal);
        }
      } catch {
        try {
          child.kill(signal);
        } catch {
          // Süreç zaten sonlanmış olabilir.
        }
      }
    };

    const onAbort = () => {
      aborted = true;
      killTree('SIGTERM');
      setTimeout(() => killTree('SIGKILL'), 1_000).unref?.();
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree('SIGTERM');
      setTimeout(() => killTree('SIGKILL'), 1_000).unref?.();
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    };

    let spawnError: string | undefined;

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();

      let output = stdout;
      if (stderr) output += `${output ? '\n' : ''}[STDERR]:\n${stderr}`;
      // spawn hatası (örn. docker bulunamadı) hiçbir çıktı üretmez; mesajı
      // yutmak kullanıcıya "(no output)" gösterir ve neden gizli kalır.
      if (spawnError) output += `${output ? '\n' : ''}[SPAWN ERROR]: ${spawnError}`;
      output = output.trim();

      if (output.length > maxOutputChars) {
        output = `${output.slice(0, maxOutputChars)}\n\n[... ${output.length - maxOutputChars} characters of output truncated ...]`;
      }
      if (!output) output = '(no output)';
      if (timedOut) output = `[TIMED OUT: ${timeoutMs} ms]\n${output}`;
      if (aborted) output = `[CANCELLED]\n${output}`;

      resolve({
        command,
        ok: !timedOut && !aborted && exitCode === 0,
        exitCode,
        output,
        durationMs: Date.now() - startedAt,
        timedOut,
        aborted
      });
    };

    child.stdout?.on('data', (data: Buffer) => {
      // Aşırı bellek kullanımını önle: sınırın hemen üstünde bir miktar tut.
      if (stdout.length < maxOutputChars * 2) stdout += data.toString('utf-8');
    });
    child.stderr?.on('data', (data: Buffer) => {
      if (stderr.length < maxOutputChars * 2) stderr += data.toString('utf-8');
    });

    child.on('error', (err) => {
      spawnError = err.message;
      finish(null);
    });
    child.on('close', (code) => finish(code));

    options.signal?.addEventListener('abort', onAbort, { once: true });
  });
}
