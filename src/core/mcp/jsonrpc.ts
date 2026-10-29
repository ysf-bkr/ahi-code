/**
 * MCP taşımasının saf ayrıştırma yardımcıları.
 *
 * `McpClient` durum tutan bir sınıf; burada yalnızca metin/JSON ayrıştırma
 * toplanır. Böylece SSE ve satır bazlı JSON-RPC çözümlemesi `vscode` ve ağ
 * olmadan test edilebilir.
 */
import { isRecord } from '../../shared/errors';

export interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
}

/**
 * Satır tamponunu böler; son parça (henüz tamamlanmamış olabilir) geri
 * döndürülür. Her satır JSON-RPC mesajına çözülür, çözülemeyen satırlar
 * sessizce atlanır.
 */
export function parseJsonRpcLines(buffer: string): { messages: JsonRpcMessage[]; rest: string } {
  const lines = buffer.split('\n');
  const rest = lines.pop() ?? '';
  const messages: JsonRpcMessage[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isRecord(parsed)) messages.push(parsed as JsonRpcMessage);
    } catch {
      // Tamamlanmamış ya da bozuk JSON: satır atlanır.
    }
  }

  return { messages, rest };
}

/**
 * SSE gövdesinden sonuç/hatası olan ilk JSON-RPC mesajını çıkarır.
 *
 * HTTP/SSE taşımasında sunucu `data:` satırları içinde yanıt döndürür; burada
 * yalnızca gerçek bir sonuç taşıyan satır aranır.
 */
export function extractJsonRpcFromSse(text: string): JsonRpcMessage | undefined {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed.replace(/^data:\s*/, ''));
      if (isRecord(parsed) && (parsed.result !== undefined || parsed.error !== undefined)) {
        return parsed as JsonRpcMessage;
      }
    } catch {
      // Kısmi/geçersiz satır.
    }
  }
  return undefined;
}

/** Yanıt içerik türü SSE mi? */
export function isEventStream(contentType: string | null): boolean {
  return (contentType ?? '').includes('text/event-stream');
}

/** `tools/list` sayfalarını birleştirir; tekrar eden araç adları korunur. */
export function mergeToolPages<T extends { name: string }>(pages: T[][]): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const page of pages) {
    for (const tool of page) {
      if (seen.has(tool.name)) continue;
      seen.add(tool.name);
      merged.push(tool);
    }
  }
  return merged;
}
