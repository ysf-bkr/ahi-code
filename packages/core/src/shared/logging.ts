export type LogLevel = 'info' | 'warning' | 'error';

type LogSink = (level: LogLevel, message: string, error?: unknown) => void;

let sink: LogSink | undefined;

/**
 * Eklenti ana bilgisayarı tarafından bir OutputChannel'a bağlanır. O ana kadar
 * çağrılar sessizce yok sayılır; böylece testler ve saf modüller `vscode`
 * bağımlılığı olmadan çalışabilir.
 */
export function setLogSink(next: LogSink | undefined): void {
  sink = next;
}

export function logInfo(message: string): void {
  sink?.('info', message);
}

export function logWarning(message: string, error?: unknown): void {
  sink?.('warning', message, error);
}

export function logError(message: string, error?: unknown): void {
  sink?.('error', message, error);
}
