/**
 * Test edilen extension host kodunun kullandığı `vscode` API yüzeyinin
 * minimal, bellek içi uygulaması.
 *
 * Yalnızca agent döngüsünün dokunduğu kısımlar uygulanır: çalışma alanı/güven
 * durumu, yapılandırma, bellek içi Memento deposu, sahte terminal ve LSP
 * tanılama/komut giriş noktaları. Testler bu modülü
 * `test/support/register-vscode.mjs` içindeki resolver hook'u ile içe alır.
 */

export interface MementoStore {
  get<T>(key: string, defaultValue?: T): T | undefined;
  update(key: string, value: unknown): Promise<void>;
  keys(): readonly string[];
}

/** Sıfırlama kancası: her test dosyası temiz bir durumla başlasın. */
export const testState = {
  trusted: true,
  workspaceRoot: undefined as string | undefined,
  warningAnswers: [] as string[],
  /** showWarningMessage için sırayla tüketilen yanıtlar; boşsa ilk düğme seçilir. */
  warningChoices: [] as string[],
  infoMessages: [] as string[],
  errorMessages: [] as string[],
  commands: [] as Array<{ command: string; args: unknown[] }>,
  diagnostics: new Map<string, unknown[]>(),
  globalStateData: new Map<string, unknown>(),
  workspaceStateData: new Map<string, unknown>(),
  secretData: new Map<string, unknown>(),
  activeTextEditor: undefined as unknown,
  terminals: [] as unknown[]
};

export function resetTestState(): void {
  testState.trusted = true;
  testState.workspaceRoot = undefined;
  testState.warningAnswers = [];
  testState.warningChoices = [];
  testState.infoMessages = [];
  testState.errorMessages = [];
  testState.commands = [];
  testState.diagnostics.clear();
  testState.globalStateData.clear();
  testState.workspaceStateData.clear();
  testState.secretData.clear();
  testState.activeTextEditor = undefined;
  testState.terminals = [];
}

function createMemento(data: Map<string, unknown>): MementoStore {
  return {
    get<T>(key: string, defaultValue?: T): T | undefined {
      return data.has(key) ? (data.get(key) as T) : defaultValue;
    },
    async update(key: string, value: unknown): Promise<void> {
      if (value === undefined) {
        data.delete(key);
      } else {
        data.set(key, value);
      }
    },
    keys(): readonly string[] {
      return [...data.keys()];
    }
  };
}

export class Uri {
  public readonly scheme: string;
  public readonly fsPath: string;

  private constructor(scheme: string, fsPath: string) {
    this.scheme = scheme;
    this.fsPath = fsPath;
  }

  static file(fsPath: string): Uri {
    return new Uri('file', fsPath);
  }

  static parse(value: string): Uri {
    return new Uri(value.startsWith('file:') ? 'file' : 'unknown', value.replace(/^file:\/\//, ''));
  }

  static joinPath(base: Uri, ...segments: string[]): Uri {
    return new Uri(base.scheme, [base.fsPath.replace(/\/+$/, ''), ...segments].join('/'));
  }

  toString(): string {
    return `${this.scheme}://${this.fsPath}`;
  }

  with(): Uri {
    return this;
  }
}

export class Position {
  constructor(
    public readonly line: number,
    public readonly character: number
  ) {}
}

export class Range {
  public readonly start: Position;
  public readonly end: Position;

  constructor(start: Position | number, startChar?: number, end?: Position, endChar?: number) {
    if (start instanceof Position && end instanceof Position) {
      this.start = start;
      this.end = end;
      return;
    }
    this.start = new Position(Number(start), Number(startChar));
    this.end = new Position(Number(start), Number(endChar));
  }
}

export const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 } as const;

export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 } as const;

export const ViewColumn = { Active: -1, Beside: -2, One: 1 } as const;

export const EndOfLine = { LF: 1, CRLF: 2 } as const;

export const StatusBarAlignment = { Left: 1, Right: 2 } as const;

const configurationValues = new Map<string, unknown>();

/** Test helper: seed a value returned by `getConfiguration(section).get(key)`. */
export function setConfigurationValue(section: string, key: string, value: unknown): void {
  configurationValues.set(`${section}.${key}`, value);
}

const configuration = {
  get<T>(key: string): T | undefined {
    return configurationValues.get(`ahiCode.${key}`) as T | undefined;
  },
  inspect<T>(key: string): { globalValue?: T } | undefined {
    const value = configurationValues.get(`ahiCode.${key}`);
    return value === undefined ? undefined : { globalValue: value as T };
  },
  async update(): Promise<void> {
    // Bu testler ayar kalıcılığını sınmaz.
  }
};

const workspace = {
  get isTrusted(): boolean {
    return testState.trusted;
  },
  get workspaceFolders(): Array<{ uri: Uri; name: string; index: number }> | undefined {
    return testState.workspaceRoot
      ? [{ uri: Uri.file(testState.workspaceRoot), name: 'fixture', index: 0 }]
      : undefined;
  },
  getWorkspaceFolder(uri: Uri): { uri: Uri } | undefined {
    if (!testState.workspaceRoot) return undefined;
    return uri.fsPath.startsWith(testState.workspaceRoot)
      ? { uri: Uri.file(testState.workspaceRoot) }
      : undefined;
  },
  getConfiguration(section: string) {
    return section === 'ahiCode' ? configuration : createSectionConfig(section);
  },
  get textDocuments(): unknown[] {
    return [];
  },
  onDidChangeConfiguration() {
    return { dispose() {} };
  }
};

function createSectionConfig(section: string) {
  return {
    get<T>(key: string): T | undefined {
      return configurationValues.get(`${section}.${key}`) as T | undefined;
    },
    inspect<T>(key: string): { globalValue?: T } | undefined {
      const value = configurationValues.get(`${section}.${key}`);
      return value === undefined ? undefined : { globalValue: value as T };
    },
    async update(): Promise<void> {
      // no-op
    }
  };
}

class FakeTerminal {
  public readonly name: string;
  public readonly exitStatus = undefined;
  public readonly shellIntegration = undefined;
  public sent: string[] = [];

  constructor(options?: { name?: string } | string) {
    if (typeof options === 'string') {
      this.name = options;
    } else {
      this.name = options?.name ?? 'AhiCode';
    }
  }

  show(): void {}

  sendText(text: string): void {
    this.sent.push(text);
  }

  dispose(): void {}
}

const window = {
  get activeTextEditor(): unknown {
    return testState.activeTextEditor;
  },
  get terminals(): unknown[] {
    return testState.terminals;
  },
  createTerminal(options?: { name?: string } | string): FakeTerminal {
    const terminal = new FakeTerminal(options);
    testState.terminals.push(terminal);
    return terminal;
  },
  createOutputChannel() {
    return {
      appendLine() {},
      append() {},
      clear() {},
      show() {},
      dispose() {}
    };
  },
  showWarningMessage: async (message: string, ...rest: unknown[]) => {
    testState.warningAnswers.push(message);
    // Yalnızca başlık/mesaj/düğme etiketleri metindir; seçenek nesnesi atlanır.
    const buttons = rest.filter((item): item is string => typeof item === 'string');
    // Testler bir yanıt kuyruğu verebilir; aksi halde gerçek VS Code gibi
    // ilk düğme (birincil eylem) seçilir. Sabit bir etiket dönmek, farklı
    // etiket bekleyen akışları (ör. MCP 'Başlat') yanlışlıkla reddettirirdi.
    const queued = testState.warningChoices.shift();
    if (queued !== undefined) return queued;
    return buttons[0];
  },
  showInformationMessage: async (message: string) => {
    testState.infoMessages.push(message);
    return undefined;
  },
  showErrorMessage: async (message: string) => {
    testState.errorMessages.push(message);
    return undefined;
  },
  showTextDocument: async () => ({}),
  onDidChangeTerminalShellIntegration() {
    return { dispose() {} };
  },
  onDidEndTerminalShellExecution() {
    return { dispose() {} };
  },
  withProgress: async (_options: unknown, task: (value: unknown) => Promise<unknown>) => task({ report() {} })
};

const commands = {
  async executeCommand(command: string, ...args: unknown[]): Promise<unknown> {
    testState.commands.push({ command, args });
    return undefined;
  },
  registerCommand() {
    return { dispose() {} };
  }
};

const languages = {
  getDiagnostics(uri?: Uri): unknown {
    if (!uri) return [...testState.diagnostics.entries()].map(([key, value]) => [Uri.file(key), value]);
    return testState.diagnostics.get(uri.fsPath) ?? [];
  }
};

/**
 * Object spread getter'leri modül yüklenirken bir kez değerlendirir ve bir
 * test kök ayarlamadan önce `workspaceFolders`'ı `undefined`'a sabitler.
 * Açık özellik yönlendirmesi onları canlı tutar.
 */
const workspaceNs = {
  get isTrusted(): boolean {
    return workspace.isTrusted;
  },
  get workspaceFolders(): ReturnType<() => typeof workspace.workspaceFolders> {
    return workspace.workspaceFolders;
  },
  getWorkspaceFolder(uri: Uri) {
    return workspace.getWorkspaceFolder(uri);
  },
  getConfiguration(section: string) {
    return workspace.getConfiguration(section);
  },
  get textDocuments(): unknown[] {
    return workspace.textDocuments;
  },
  onDidChangeConfiguration() {
    return { dispose() {} };
  },
  onDidSaveTextDocument() {
    return { dispose() {} };
  },
  findFiles: async () => [],
  openTextDocument: async () => ({ getText: () => '', uri: Uri.file('') })
};

export { commands, languages, window, workspaceNs as workspace };

export const env = { appName: 'test', language: 'tr' };
export const version = '1.106.0';
export const extensions = { getExtension: () => undefined };

/** Yukarıdaki bellek içi haritalara dayanan ExtensionContext yerineği. */
export function createExtensionContext(extensionPath = '/tmp/ahi-test-ext') {
  return {
    subscriptions: [] as Array<{ dispose(): void }>,
    extensionUri: Uri.file(extensionPath),
    extensionPath,
    globalState: createMemento(testState.globalStateData),
    workspaceState: createMemento(testState.workspaceStateData),
    secrets: {
      async get(key: string) {
        return testState.secretData.get(key) as string | undefined;
      },
      async store(key: string, value: string) {
        testState.secretData.set(key, value);
      },
      async delete(key: string) {
        testState.secretData.delete(key);
      }
    },
    asAbsolutePath: (relativePath: string) => `${extensionPath}/${relativePath}`
  };
}
