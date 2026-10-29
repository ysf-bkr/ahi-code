import * as vscode from 'vscode';
import { AHI_DIR, AHI_FILES } from '../../shared/constants';
import * as path from 'path';
import * as fs from 'fs/promises';
import { McpClient, McpServerConfig, McpServerStatus } from './McpClient';
import { fingerprintOf, requestFingerprintApproval } from '../permission/fingerprintApproval';
import { ToolDefinition } from '../../tools/base';
import { errorMessage } from '../../shared/errors';
import { logError, logWarning } from '../../shared/logging';

export interface McpConfigFile {
  mcpServers: Record<string, McpServerConfig>;
}

export class McpHub {
  private clients: Map<string, McpClient> = new Map();
  private tools: ToolDefinition[] = [];
  private initializedRoot?: string;

  /**
   * @param approvals Hangi proje MCP yapılandırmasının onaylandığını hatırlayan
   * kalıcı depolama (çalışma alanı durumu). Proje tarafından tanımlanan
   * sunucular keyfi komut çalıştırır, bu yüzden otomatik başlamadan önce
   * (VS Code görevlerinde olduğu gibi) ilk kullanım onayı gerekir.
   */
  constructor(private approvals?: vscode.Memento) {}

  /**
   * MCP sunucularını yalnızca gerektiğinde başlatır. Her ajan turunda
   * yeniden başlatmak yavaştır ve durum kaybına yol açabilir.
   */
  public async ensureInitialized(workspaceRoot?: string): Promise<ToolDefinition[]> {
    if (!workspaceRoot) return [];
    if (this.initializedRoot === workspaceRoot) {
      return this.tools;
    }
    return this.initialize(workspaceRoot);
  }

  public async initialize(
    workspaceRoot?: string,
    options: { userInitiated?: boolean } = {}
  ): Promise<ToolDefinition[]> {
    this.stopAll();
    if (!workspaceRoot) return [];

    // Güvenilmeyen çalışma alanında depo tanımlı komutları çalıştırma.
    // Bu durumda initializedRoot ayarlanmaz; böylece çalışma alanı sonradan
    // güvenilir olursa ensureInitialized yeniden deneyip sunucuları başlatabilir.
    if (!vscode.workspace.isTrusted) {
      logWarning('MCP servers were not started because the workspace is not trusted.');
      return [];
    }
    this.initializedRoot = workspaceRoot;
    const config = await this.loadConfig(workspaceRoot);
    if (!config || !config.mcpServers) return [];

    const enabled = Object.fromEntries(
      Object.entries(config.mcpServers).filter(([, serverConfig]) => !serverConfig.disabled)
    );
    if (Object.keys(enabled).length > 0 && !options.userInitiated) {
      const allowed = await this.confirmProjectServers(workspaceRoot, enabled);
      if (!allowed) {
        logWarning('MCP servers were not started: the project configuration was not approved.');
        return [];
      }
    }

    // Sunucuları paralel başlat; biri yavaş ya da engelli olsa diğerleri beklemesin.
    const results = await Promise.allSettled(
      Object.entries(enabled).map(async ([serverName, serverConfig]) => {
        const client = new McpClient(serverName, serverConfig, workspaceRoot);
        this.clients.set(serverName, client);
        try {
          return await client.start();
        } catch (err) {
          logError(`Could not start MCP server: ${serverName}`, err);
          return [] as ToolDefinition[];
        }
      })
    );

    const allTools: ToolDefinition[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allTools.push(...result.value);
      }
    }

    this.tools = allTools;
    return this.tools;
  }

  /**
   * Depo tanımlı MCP sunucuları için ilk kullanım onayı; VS Code'un proje
   * görevlerini çalıştırmadan önce sormasına benzer. Onaylanan yapılandırmanın
   * parmak izi tutulur; yapılandırma değişirse yeniden sorulur. MCP
   * görünümünden açık yeniden başlatma kullanıcı onayı sayılır ve soruyu atlar.
   */
  private async confirmProjectServers(
    workspaceRoot: string,
    servers: Record<string, McpServerConfig>
  ): Promise<boolean> {
    const names = Object.keys(servers).join(', ');
    return requestFingerprintApproval({
      scope: 'mcp',
      workspaceRoot,
      fingerprint: fingerprintOf(servers),
      store: this.approvals,
      ask: async () => {
        const choice = await vscode.window.showWarningMessage(
          `Bu proje, yapılandırmasında tanımlı MCP sunucularını başlatmak istiyor: ${names}`,
          {
            modal: true,
            detail:
              'MCP sunucuları projenin .ahi/mcp_config.json dosyasından okunur ve bilgisayarınızda komut çalıştırabilir. Yalnızca güvendiğiniz projelerde onaylayın.'
          },
          'Başlat',
          'Atla'
        );
        return choice === 'Başlat';
      }
    });
  }

  public getServerStatuses(): McpServerStatus[] {
    return Array.from(this.clients.values()).map((c) => c.getStatus());
  }

  public getTools(): ToolDefinition[] {
    return this.tools;
  }

  public stopAll() {
    for (const client of this.clients.values()) {
      client.stop();
    }
    this.clients.clear();
    this.tools = [];
  }

  public async openConfigFile(workspaceRoot?: string): Promise<void> {
    if (!workspaceRoot) {
      vscode.window.showWarningMessage('Açık çalışma alanı klasörü bulunamadı.');
      return;
    }

    const configDir = path.join(workspaceRoot, AHI_DIR);
    const configPath = path.join(configDir, 'mcp_config.json');

    try {
      await fs.mkdir(configDir, { recursive: true });
      try {
        await fs.access(configPath);
      } catch {
        // Boş varsayılan yapılandırma oluştur. Örnek bir `npx -y <paket>` girdisi
        // kullanıcı istemeden sabitlenmemiş kod indirip çalıştırırdı; şablon boş başlar.
        // them asking for it, so the template starts empty.
        const initialConfig: McpConfigFile = { mcpServers: {} };
        await fs.writeFile(configPath, JSON.stringify(initialConfig, null, 2), 'utf-8');
      }

      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(configPath));
      await vscode.window.showTextDocument(doc);
    } catch (err) {
      vscode.window.showErrorMessage(`MCP yapılandırma dosyası açılamadı: ${errorMessage(err)}`);
    }
  }

  private async loadConfig(workspaceRoot?: string): Promise<McpConfigFile | null> {
    if (!workspaceRoot) return null;

    const possiblePaths = [
      path.join(workspaceRoot, AHI_DIR, AHI_FILES.mcpConfig),
      path.join(workspaceRoot, 'mcp_config.json'),
      path.join(workspaceRoot, '.mcp.json')
    ];

    for (const p of possiblePaths) {
      try {
        const raw = await fs.readFile(p, 'utf-8');
        const parsed = JSON.parse(raw);
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          !parsed.mcpServers ||
          typeof parsed.mcpServers !== 'object'
        ) {
          continue;
        }
        return parsed as McpConfigFile;
      } catch {
        // Dosya yok ya da geçersiz JSON içeriyor.
      }
    }
    return null;
  }
}
