import { ToolName, WorkflowState } from '../shared/types';
// Araçlar çekirdek sınıflara değil, dar portlara bağlanır (bkz. `contracts.ts`).
// Bu import'lar `import type` olarak kalmalı; değer importu araç katmanını
// VS Code'a bağımlı çekirdek modüllerine zincirler (bkz. architecture testi).
import type { SandboxConfig } from '../core/verification/CommandRunner';
import type {
  CallGraphPort,
  EmbeddingPort,
  GitPort,
  KnowledgePort,
  LspPort,
  PermissionPort,
  ProjectMemoryPort,
  SnapshotPort,
  SpecPort,
  VerificationPort,
  VectorMemoryPort
} from './contracts';

export interface JsonSchema {
  type: string;
  description?: string;
  enum?: string[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
}

export interface ToolDefinition {
  name: ToolName;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, JsonSchema>;
    required: string[];
  };
  execute: (args: Record<string, unknown>, context: ToolExecutionContext) => Promise<string>;
}

/** Bir komutu VS Code tümleşik terminalinde çalıştırıp çıktısını döndürür. */
export type TerminalRunner = (
  command: string,
  workspaceRoot: string,
  signal?: AbortSignal
) => Promise<string>;

export interface ToolExecutionContext {
  workspaceRoot?: string;
  lspClient?: LspPort;
  snapshotManager?: SnapshotPort;
  /**
   * Dolaylı okuma yolları (arama) için ortak izin kapısı. Verilirse arama
   * sonuçları `read_file` ile aynı deny/hassas dosya kurallarından geçirilir.
   */
  permissionManager?: PermissionPort;
  verificationManager?: VerificationPort;
  gitManager?: GitPort;
  projectMemory?: ProjectMemoryPort;
  knowledgeStore?: KnowledgePort;
  /** Vektör bellek (geçmiş görevler ve bilgi tabanı). */
  vectorMemory?: VectorMemoryPort;
  /** Bilgi tabanı üzerinde yerel anlamsal arama (isteğe bağlı). */
  embeddingIndex?: EmbeddingPort;
  specStore?: SpecPort;
  /** Salt-okunur çağrı haritası (opsiyonel). */
  callGraph?: CallGraphPort;
  workflow?: WorkflowState;
  sandbox?: SandboxConfig;
  /** Verilirse (ve Docker sandbox etkin değilse) komutlar burada çalışır. */
  terminal?: TerminalRunner;
  signal?: AbortSignal;
}

/**
 * Araç argümanlarını şemaya göre doğrular.
 *
 * Özyineleme yerine açık bir yığın kullanır. Şemalar MCP sunucularından
 * gelebildiği için derinlik dışarıdan gelir; özyineleme "Maximum call stack
 * size exceeded" ile tüm eklentiyi düşürebilirdi. Döngü sürümünde yapay bir
 * derinlik sınırı yoktur ve yığın taşmaz.
 *
 * Dönen dize hata mesajıdır; `undefined` argümanların geçerli olduğu anlamına gelir.
 */
function validateNested(rootValue: unknown, rootSchema: JsonSchema, rootPath: string): string | undefined {
  interface Task {
    value: unknown;
    schema: JsonSchema;
    path: string;
  }

  const stack: Task[] = [{ value: rootValue, schema: rootSchema, path: rootPath }];
  // Döngüsel şema (A -> A) sonsuz döngüye yol açmasın: aynı şema nesnesi ikinci
  // kez açılmaz. Doğrulama idempotent olduğu için bu güvenlidir.
  const expanded = new WeakSet<object>();

  while (stack.length > 0) {
    const task = stack.pop();
    if (!task) break;
    const { value, schema, path } = task;

    if (!schema || value === undefined || value === null) continue;

    if (Array.isArray(schema.enum) && !schema.enum.includes(String(value))) {
      return `Invalid value for '${path}': ${JSON.stringify(value)}. Allowed values: ${schema.enum.join(', ')}`;
    }

    if (schema.type === 'string' && typeof value !== 'string') {
      return `'${path}' must be a string.`;
    }
    if (schema.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
      return `'${path}' must be a number.`;
    }
    if (schema.type === 'integer' && (typeof value !== 'number' || !Number.isInteger(value))) {
      return `'${path}' must be an integer.`;
    }
    if (schema.type === 'boolean' && typeof value !== 'boolean') {
      return `'${path}' must be a boolean.`;
    }

    if (schema.type === 'array') {
      if (!Array.isArray(value)) {
        return `'${path}' must be an array.`;
      }
      if (schema.items && !expanded.has(schema)) {
        expanded.add(schema);
        for (let index = 0; index < value.length; index++) {
          stack.push({ value: value[index], schema: schema.items, path: `${path}[${index}]` });
        }
      }
      continue;
    }

    if (schema.type === 'object') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return `'${path}' must be an object.`;
      }
      const objectValue = value as Record<string, unknown>;
      const required = schema.required || [];
      const missing = required.filter((key) => objectValue[key] === undefined || objectValue[key] === null);
      if (missing.length > 0) {
        return `Missing required field(s) for '${path}': ${missing.join(', ')}`;
      }
      if (schema.properties && !expanded.has(schema)) {
        expanded.add(schema);
        for (const [key, childSchema] of Object.entries(schema.properties)) {
          stack.push({ value: objectValue[key], schema: childSchema, path: `${path}.${key}` });
        }
      }
    }
  }

  return undefined;
}

/**
 * Şemaya göre tip dönüşümü yapar (dize sayı/boolean → gerçek tip).
 *
 * `validateNested` gibi açık yığın kullanır: dış kaynaklı derin şemalarda yığın
 * taşması olmaz, yapay derinlik sınırı da gerekmez.
 */
function coerceValue(rootValue: unknown, rootSchema: JsonSchema): unknown {
  if (rootValue === undefined || rootValue === null) return rootValue;

  interface Task {
    value: unknown;
    schema: JsonSchema;
    assign: (next: unknown) => void;
  }

  const rootBox: { value: unknown } = { value: rootValue };
  const stack: Task[] = [
    {
      value: rootValue,
      schema: rootSchema,
      assign: (next) => {
        rootBox.value = next;
      }
    }
  ];
  const expanded = new WeakSet<object>();

  while (stack.length > 0) {
    const task = stack.pop();
    if (!task) break;
    const { value, schema, assign } = task;

    if (value === undefined || value === null || !schema) {
      assign(value);
      continue;
    }

    if (schema.type === 'number') {
      if (typeof value === 'number') {
        assign(value);
      } else if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
        assign(Number(value));
      } else {
        assign(value);
      }
      continue;
    }

    if (schema.type === 'boolean') {
      if (typeof value === 'boolean') {
        assign(value);
        continue;
      }
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'on', 'evet'].includes(normalized)) {
          assign(true);
          continue;
        }
        if (['false', '0', 'no', 'off', 'hayir', 'hayır'].includes(normalized)) {
          assign(false);
          continue;
        }
      }
      assign(value);
      continue;
    }

    if (schema.type === 'array' && Array.isArray(value)) {
      if (!schema.items || expanded.has(schema)) {
        assign(value);
        continue;
      }
      expanded.add(schema);
      const output: unknown[] = new Array(value.length);
      for (let index = 0; index < value.length; index++) {
        const slot = index;
        stack.push({
          value: value[index],
          schema: schema.items,
          assign: (next) => {
            output[slot] = next;
          }
        });
      }
      assign(output);
      continue;
    }

    if (schema.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
      if (!schema.properties || expanded.has(schema)) {
        assign(value);
        continue;
      }
      expanded.add(schema);
      const source = value as Record<string, unknown>;
      const output: Record<string, unknown> = { ...source };
      for (const [key, childSchema] of Object.entries(schema.properties)) {
        const childValue = source[key];
        if (childValue === undefined) continue;
        const slot = key;
        stack.push({
          value: childValue,
          schema: childSchema,
          assign: (next) => {
            output[slot] = next;
          }
        });
      }
      assign(output);
      continue;
    }

    assign(value);
  }

  return rootBox.value;
}

/**
 * Küçük/yerel modeller sayı ve boolean alanları dize olarak döndürebilir.
 * Tipleri şemaya göre güvenle çevirir; ardından validateToolArguments çağrılmalıdır.
 */
export function coerceToolArguments(tool: ToolDefinition, args: unknown): Record<string, unknown> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return {};
  }
  const source = args as Record<string, unknown>;
  const result: Record<string, unknown> = { ...source };
  for (const [key, schema] of Object.entries(tool.parameters.properties || {})) {
    if (source[key] !== undefined) {
      result[key] = coerceValue(source[key], schema);
    }
  }
  return result;
}

export function validateToolArguments(tool: ToolDefinition, args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return `Arguments for '${tool.name}' must be a JSON object.`;
  }

  const values = args as Record<string, unknown>;
  const required = tool.parameters.required || [];
  const missing = required.filter((key) => values[key] === undefined || values[key] === null);
  if (missing.length > 0) {
    return `Missing required parameter(s) for '${tool.name}': ${missing.join(', ')}`;
  }

  for (const [key, schema] of Object.entries(tool.parameters.properties || {})) {
    const error = validateNested(values[key], schema, key);
    if (error) return `Argument error for '${tool.name}': ${error}`;
  }

  return undefined;
}
