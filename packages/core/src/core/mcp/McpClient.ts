import { spawn, ChildProcess } from 'child_process';
import { ToolDefinition } from '../../tools/base';
import { ToolName } from '../../shared/types';
import { errorMessage, isRecord } from '../../shared/errors';
import { logError, logInfo, logWarning } from '../../shared/logging';
import { extractJsonRpcFromSse, isEventStream, parseJsonRpcLines } from './jsonrpc';
import { sanitizeEnv } from '../verification/CommandRunner';
import { EXTENSION_VERSION } from '../../shared/version';
import { CLIENT_NAME } from '../../shared/constants';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout;
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
}

interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: ToolDefinition['parameters'];
}

interface McpToolsListResult {
  tools?: McpToolDescriptor[];
  nextCursor?: string;
}

interface McpToolCallResult {
  isError?: boolean;
  content?: Array<{ text?: string }>;
}

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string; // uzak MCP sunucuları için HTTP/SSE uç noktası
  type?: 'stdio' | 'sse' | 'http';
  disabled?: boolean;
}

export interface McpServerStatus {
  name: string;
  command?: string;
  transport: 'stdio' | 'sse' | 'http';
  endpoint: string;
  status: 'connected' | 'connecting' | 'error' | 'stopped';
  error?: string;
  tools: Array<{ name: string; description: string }>;
}

/**
 * `npx -y <paket>` ile başlatılan sunucular paketi ilk çalıştırmada indirir;
 * initialize el sıkışması bunu tolere etmelidir.
 */
const INITIALIZE_TIMEOUT_MS = 120_000;

/** Farklı MCP istek türleri için gidiş-dönüş zaman aşımları (milisaniye). */
const REQUEST_TIMEOUT_MS = {
  /** Varsayılan stdio gidiş-dönüşü (tools/list, bildirimler). */
  request: 15_000,
  /** HTTP/SSE el sıkışması ve araç keşfi; uzak sunucular ısınmakta yavaş olabilir. */
  httpHandshake: 30_000,
  /** Gönder-ve-unut HTTP bildirimi. */
  httpNotification: 10_000,
  /** Araç yürütme; sunucuda keyfi iş çalıştırabilir. */
  toolCall: 60_000
} as const;

/** Üstel yeniden bağlanma beklemesi için üst sınır. */
const MAX_RECONNECT_DELAY_MS = 15_000;

export class McpClient {
  private process?: ChildProcess;
  private messageId = 0;
  private pendingRequests = new Map<number, PendingRequest>();
  private tools: ToolDefinition[] = [];
  private buffer = '';
  public status: 'connected' | 'connecting' | 'error' | 'stopped' = 'stopped';
  public lastError?: string;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private sessionId?: string;
  /**
   * `stop()` tarafından ayarlanır ve bu örnek için bir daha temizlenmez.
   * `stop()` sonrası eşzamanlı tetiklenen hata yolları (reddedilen bekleyen
   * istekler, hayatta kalan süreç 'error' dinleyicisi) terminal 'stopped'
   * durumunun üzerine yazmamalı veya yeniden bağlanma planlamamalı. Bu bayrak
   * olmadan durdurulan sunucu, zamanlayıcı çalıştığında yeniden canlanabilirdi.
   */
  private disposed = false;

  constructor(
    public readonly name: string,
    private config: McpServerConfig,
    private workspaceRoot?: string,
    private onNotification?: (method: string, params: unknown) => void
  ) {}

  private killProcess(): void {
    if (!this.process?.pid) {
      this.process = undefined;
      return;
    }
    try {
      if (process.platform !== 'win32') {
        process.kill(-this.process.pid, 'SIGTERM');
      } else {
        this.process.kill();
      }
    } catch {
      try {
        this.process.kill();
      } catch {
        // Süreç zaten sonlanmış olabilir.
      }
    }
    this.process = undefined;
  }

  public async start(): Promise<ToolDefinition[]> {
    if (this.disposed) {
      // Durdurulmuş bir istemci bayat bir yeniden bağlanma zamanlayıcısıyla asla yeniden başlamamalı.
      this.status = 'stopped';
      return [];
    }
    this.sessionId = undefined;
    if (this.config.disabled) {
      this.status = 'stopped';
      return [];
    }

    if (this.config.url) {
      return this.startSseTransport();
    } else if (this.config.command) {
      return this.startStdioTransport();
    } else {
      this.status = 'error';
      this.lastError = 'Neither "command" nor "url" is defined in the MCP server configuration.';
      return [];
    }
  }

  private async startStdioTransport(): Promise<ToolDefinition[]> {
    this.status = 'connecting';
    this.lastError = undefined;

    try {
      // Artık süreç bırakmamak için yeniden bağlanmadan önce eski süreci tamamen sonlandır.
      if (this.process) {
        this.process.removeAllListeners('exit');
        this.killProcess();
      }

      const isWindows = process.platform === 'win32';
      const command =
        isWindows && !/\.(cmd|exe|bat)$/i.test(this.config.command!)
          ? `${this.config.command}.cmd`
          : this.config.command!;

      this.process = spawn(command, this.config.args || [], {
        cwd: this.workspaceRoot,
        // Miras kalan ortam sırları ayıklanır (PATH/HOME/NODE_* gibi güvenli
        // değerler korunur); bir sunucuya anahtar gerekiyorsa yapılandırmadaki
        // `env` alanıyla açıkça verilmelidir.
        env: { ...sanitizeEnv(process.env), ...this.config.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: isWindows,
        detached: !isWindows
      });

      this.process.stdout?.on('data', (data: Buffer) => {
        this.handleData(data.toString('utf-8'));
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        logWarning(`[MCP ${this.name}] stderr: ${data.toString('utf-8').trim()}`);
      });

      this.process.on('error', (err) => {
        logError(`[MCP ${this.name}] process error`, err);
        if (this.disposed) return;
        // spawn hatası (örn. komut bulunamadı) hiçbir JSON-RPC yanıtı üretmez;
        // bekleyen istekleri reddet ki `start()` tüm initialize zaman aşımını
        // beklemeden hızlı başarısız olsun.
        this.rejectPendingRequests(new Error(errorMessage(err, 'Process error')));
        this.status = 'error';
        this.lastError = errorMessage(err);
        this.scheduleReconnect();
      });

      this.process.on('exit', (code) => {
        if (this.disposed) return;
        if (code !== 0 && code !== null) {
          this.status = 'error';
          this.lastError = `Server exited unexpectedly (exit code: ${code})`;
          this.scheduleReconnect();
        } else {
          this.status = 'stopped';
        }
      });

      // initialize isteğini gönder. Sunucu başlatma normal bir gidiş-dönüş
      // değildir: `npx -y <paket>` ilk çalıştırmada paketi indirir ve varsayılan
      // istek zaman aşımını kolayca aşar.
      await this.sendRequest(
        'initialize',
        {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          clientInfo: { name: CLIENT_NAME, version: EXTENSION_VERSION }
        },
        INITIALIZE_TIMEOUT_MS
      );

      // MCP protokolü initialize sonrası bir "initialized" bildirimi bekler.
      this.sendNotification('notifications/initialized', {});

      // Araç listesini al
      await this.fetchTools();

      this.status = 'connected';
      this.reconnectAttempts = 0;
      return this.tools;
    } catch (err) {
      // stop() kaynaklı bir ret (istemci durunca bekleyen istekler reddedilir)
      // istemciyi diriltmemeli: durumu değiştirmeden veya yeniden bağlanma
      // planlamadan önce disposed bayrağını kontrol et.
      if (this.disposed) {
        this.status = 'stopped';
        return [];
      }
      this.status = 'error';
      this.lastError = errorMessage(err, 'Startup failed');
      logError(`Could not start MCP server: ${this.name}`, err);
      this.scheduleReconnect();
      return [];
    }
  }

  private async startSseTransport(): Promise<ToolDefinition[]> {
    this.status = 'connecting';
    this.lastError = undefined;

    try {
      // HTTP/SSE bağlantısını dene
      const res = await fetch(this.config.url!, {
        method: 'POST',
        headers: this.httpHeaders(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS.httpHandshake),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: ++this.messageId,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            clientInfo: { name: CLIENT_NAME, version: EXTENSION_VERSION }
          }
        })
      });

      if (!res.ok) {
        throw new Error(`SSE/HTTP server returned HTTP ${res.status}`);
      }

      // JSON yanıtı dönen sunucular için initialize hatalarını erken yakala.
      if ((res.headers.get('content-type') || '').includes('application/json')) {
        const initData: unknown = await res.json();
        if (isRecord(initData) && isRecord(initData.error)) {
          const message =
            typeof initData.error.message === 'string' ? initData.error.message : 'MCP initialize error';
          throw new Error(message);
        }
      }

      // Akışlı HTTP sunucuları oturum kimliğini yanıt başlığında döndürür.
      const sessionHeader = res.headers.get('mcp-session-id');
      if (sessionHeader) {
        this.sessionId = sessionHeader;
      }

      try {
        await fetch(this.config.url!, {
          method: 'POST',
          headers: this.httpHeaders(),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS.httpNotification),
          body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })
        });
      } catch {
        // Bildirim isteğe bağlıdır.
      }

      // Araçları HTTP POST ile al (tüm sayfalar).
      const discovered: McpToolDescriptor[] = [];
      let cursor: string | undefined;
      do {
        const toolsRes = await fetch(this.config.url!, {
          method: 'POST',
          headers: this.httpHeaders(),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS.httpHandshake),
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: ++this.messageId,
            method: 'tools/list',
            params: cursor ? { cursor } : {}
          })
        });

        if (!toolsRes.ok) break;
        const data = await this.readJsonRpcResponse(toolsRes);
        const result = isRecord(data.result) ? data.result : {};
        const list = result.tools;
        if (Array.isArray(list)) {
          discovered.push(
            ...list.filter(
              (item): item is McpToolDescriptor => isRecord(item) && typeof item.name === 'string'
            )
          );
        }
        cursor = typeof result.nextCursor === 'string' ? result.nextCursor : undefined;
      } while (cursor);

      this.tools = discovered.map((tool) => ({
        name: `mcp_${this.name}_${tool.name}` as ToolName,
        description: `[MCP: ${this.name}] ${tool.description || ''}`,
        parameters: tool.inputSchema || { type: 'object', properties: {}, required: [] },
        execute: async (args: Record<string, unknown>) => {
          const callRes = await this.callHttpTool(tool.name, args);
          return JSON.stringify(callRes, null, 2);
        }
      }));

      this.status = 'connected';
      this.reconnectAttempts = 0;
      return this.tools;
    } catch (err) {
      if (this.disposed) {
        this.status = 'stopped';
        return [];
      }
      this.status = 'error';
      this.lastError = `SSE/HTTP connection error: ${errorMessage(err)}`;
      this.scheduleReconnect();
      return [];
    }
  }

  private httpHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream'
    };
    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId;
    }
    return headers;
  }

  private async readJsonRpcResponse(res: Response): Promise<JsonRpcResponse> {
    if (!isEventStream(res.headers.get('content-type'))) {
      const data: unknown = await res.json();
      return isRecord(data) ? (data as JsonRpcResponse) : {};
    }
    // SSE gövdesindeki ilk gerçek yanıtı çıkar (ayrıştırma jsonrpc.ts'te).
    return extractJsonRpcFromSse(await res.text()) ?? {};
  }

  private async callHttpTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(this.config.url!, {
      method: 'POST',
      headers: this.httpHeaders(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS.toolCall),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++this.messageId,
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: args
        }
      })
    });
    if (!res.ok) {
      throw new Error(`MCP tool call failed with HTTP ${res.status}.`);
    }
    const data = await this.readJsonRpcResponse(res);
    if (data.error) {
      throw new Error(data.error.message || 'MCP tool call error');
    }
    const result = isRecord(data.result) ? (data.result as McpToolCallResult) : undefined;
    if (result?.isError) {
      const detail = result.content
        ?.map((item) => item.text)
        .filter((text): text is string => Boolean(text))
        .join('\n');
      throw new Error(detail || 'MCP tool returned an error.');
    }
    return data.result;
  }

  private async fetchTools(): Promise<void> {
    const discovered: McpToolDescriptor[] = [];
    let cursor: string | undefined;

    // tools/list sayfalanabilir (nextCursor); tüm sayfaları topla.
    do {
      const raw = await this.sendRequest('tools/list', cursor ? { cursor } : {});
      const toolsRes = isRecord(raw) ? (raw as McpToolsListResult) : {};
      if (Array.isArray(toolsRes.tools)) {
        discovered.push(...toolsRes.tools);
      }
      cursor = typeof toolsRes.nextCursor === 'string' ? toolsRes.nextCursor : undefined;
    } while (cursor);

    this.tools = discovered.map((tool) => ({
      name: `mcp_${this.name}_${tool.name}` as ToolName,
      description: `[MCP: ${this.name}] ${tool.description || ''}`,
      parameters: tool.inputSchema || { type: 'object', properties: {}, required: [] },
      execute: async (args: Record<string, unknown>) => {
        const callRes = await this.callTool(tool.name, args);
        return JSON.stringify(callRes, null, 2);
      }
    }));
  }

  private scheduleReconnect() {
    if (this.disposed || this.status === 'stopped') return;
    if (this.reconnectTimer) return;
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), MAX_RECONNECT_DELAY_MS);
      logWarning(`[MCP ${this.name}] Retrying connection in ${delay}ms (attempt ${this.reconnectAttempts}).`);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = undefined;
        // Yeniden kontrol: zamanlayıcı beklerken istemci durdurulmuş olabilir.
        if (this.disposed || this.status === 'stopped') return;
        this.start().catch(() => {});
      }, delay);
    }
  }

  public async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    if (this.config.url) {
      return this.callHttpTool(toolName, args);
    }
    const raw = await this.sendRequest(
      'tools/call',
      {
        name: toolName,
        arguments: args
      },
      REQUEST_TIMEOUT_MS.toolCall
    );
    const res = isRecord(raw) ? (raw as McpToolCallResult) : undefined;
    if (res?.isError) {
      const detail = res.content
        ?.map((item) => item.text)
        .filter((text): text is string => Boolean(text))
        .join('\n');
      throw new Error(detail || 'MCP tool returned an error.');
    }
    return raw;
  }

  public getStatus(): McpServerStatus {
    const transport = this.config.type || (this.config.url ? 'http' : 'stdio');
    const endpoint = this.config.url || `${this.config.command} ${(this.config.args || []).join(' ')}`.trim();

    return {
      name: this.name,
      command: endpoint,
      transport,
      endpoint,
      status: this.status,
      error: this.lastError,
      tools: this.tools.map((t) => ({
        name: t.name,
        description: t.description
      }))
    };
  }

  public getTools(): ToolDefinition[] {
    return this.tools;
  }

  /** Uçuştaki her isteği başarısız yapar; stop() ve süreç hataları kullanır. */
  private rejectPendingRequests(error: Error): void {
    for (const [, pending] of this.pendingRequests) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  public stop() {
    // Bu örnek için terminal durum: bir daha yeniden bağlanma planlanamaz ve
    // eşzamanlı hata yolları duruma dokunmamalıdır.
    this.disposed = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.reconnectAttempts = 0;
    this.sessionId = undefined;

    // Bekleyen istekleri zaman aşımını beklemeden reddet.
    this.rejectPendingRequests(new Error(`MCP server '${this.name}' was stopped.`));
    this.buffer = '';

    if (this.process) {
      // Her dinleyiciyi (dahil 'error') kaldır; hayatta kalan bir 'error'
      // dinleyicisi stop() sonrası durumu geri çevirebilirdi.
      this.process.removeAllListeners();
      this.killProcess();
    }
    this.status = 'stopped';
  }

  private sendResponse(
    id: number | string,
    result?: unknown,
    error?: { code: number; message: string }
  ): void {
    if (!this.process || !this.process.stdin) return;
    try {
      this.process.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          ...(error ? { error } : { result: result ?? {} })
        }) + '\n'
      );
    } catch {
      // Yanıt gönderilemedi.
    }
  }

  private handleServerRequest(id: number | string, method: string): void {
    if (method === 'ping') {
      this.sendResponse(id, {});
      return;
    }
    if (method === 'roots/list') {
      this.sendResponse(id, { roots: [] });
      return;
    }
    this.sendResponse(id, undefined, {
      code: -32601,
      message: `Unsupported MCP server request: ${method}`
    });
  }

  private sendNotification(method: string, params: Record<string, unknown>) {
    if (!this.process || !this.process.stdin) return;
    try {
      this.process.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
    } catch {
      // Bildirim gönderilemedi; bu kritik değil.
    }
  }

  private sendRequest(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number = REQUEST_TIMEOUT_MS.request
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.process.stdin) {
        return reject(new Error(`MCP server '${this.name}' is not running.`));
      }

      const id = ++this.messageId;
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          const hint =
            method === 'initialize'
              ? ' The server may still be starting (npx downloads the package on the first run); try again or run the command once in a terminal to warm the cache.'
              : '';
          reject(new Error(`MCP request timed out (${method}).${hint}`));
        }
      }, timeoutMs);
      timer.unref?.();
      this.pendingRequests.set(id, { resolve, reject, timer });

      const request =
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          method,
          params
        }) + '\n';

      this.process.stdin.write(request);
    });
  }

  private handleData(chunk: string) {
    const { messages, rest } = parseJsonRpcLines(this.buffer + chunk);
    this.buffer = rest;

    for (const json of messages) {
      if (json.id !== undefined && this.pendingRequests.has(Number(json.id))) {
        const pending = this.pendingRequests.get(Number(json.id))!;
        const { resolve, reject } = pending;
        if (pending.timer) clearTimeout(pending.timer);
        this.pendingRequests.delete(Number(json.id));

        if (json.error) {
          reject(new Error(json.error.message || 'Unknown MCP error'));
        } else {
          resolve(json.result);
        }
        continue;
      }

      if (json.id !== undefined && json.method) {
        this.handleServerRequest(json.id, json.method);
        continue;
      }

      if (json.method) {
        try {
          this.onNotification?.(json.method, json.params);
        } catch {
          // Bir bildirim tüketicisi hata fırlatsa bile okumaya devam et.
        }
        logInfo(`[MCP ${this.name}] notification: ${json.method}`);
      }
    }
  }
}
