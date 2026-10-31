import * as path from 'path';
// `import * as process from 'process'` kullanma: esbuild CJS paketinde bu bir
// namespace kopyası oluşturur ve process.on() EventEmitter olayları o kopyaya
// kaydedilmeye çalışır; "_eventsCount" hatasına yol açar. Varsayılan import
// gerçek process nesnesini verir.
import process from 'process';
import { createInterface } from 'readline/promises';
import { createModelProvider } from '@ahicode/core/providers';
import { ALL_TOOLS } from '@ahicode/core/tools';
import { ToolExecutionContext } from '@ahicode/core/tools/base';
import { runToolCall } from '@ahicode/core/core/toolRunner';
import { generateSystemPrompt } from '@ahicode/core/core/prompts/systemPrompt';
import { PermissionManager } from '@ahicode/core/core/permission/PermissionManager';
import { SnapshotManager } from '@ahicode/core/core/snapshot/SnapshotManager';
import { VerificationManager } from '@ahicode/core/core/verification/VerificationManager';
import { GitManager } from '@ahicode/core/core/git/GitManager';
import { ProjectMemoryManager } from '@ahicode/core/core/memory/ProjectMemoryManager';
import { TaskPlanner } from '@ahicode/core/core/plan/TaskPlanner';
import { ContextManager } from '@ahicode/core/core/context/ContextManager';
import {
  collapseRepetition,
  findRepetitionCollapse,
  StreamRepetitionGuard
} from '@ahicode/core/shared/repetition';
import { ProviderMessage } from '@ahicode/core/providers/base';
import { ModelProviderType, ToolName, UserSettings } from '@ahicode/core/shared/types';
import { errorMessage } from '@ahicode/core/shared/errors';

const CLI_TOOLS = new Set<ToolName>([
  'read_file',
  'write_file',
  'edit_file',
  'search_files',
  'list_directory',
  'execute_command',
  'run_tests',
  'run_linter',
  'git_status',
  'git_diff',
  'read_skill',
  'undo_change',
  'update_plan',
  'run_verification',
  'index_workspace',
  'find_symbol',
  'analyze_impact',
  'git_create_branch',
  'git_commit',
  'prepare_pr',
  'search_memory',
  'read_notebook',
  'web_fetch',
  'web_search'
]);

const READ_ONLY_TOOLS = new Set<ToolName>([
  'read_file',
  'search_files',
  'list_directory',
  'git_status',
  'git_diff',
  'read_skill',
  'update_plan',
  'index_workspace',
  'find_symbol',
  'analyze_impact',
  'prepare_pr',
  'search_memory',
  'read_notebook',
  'web_fetch',
  'web_search'
]);

export interface CliOptions {
  prompt: string;
  workspace: string;
  provider: ModelProviderType;
  model: string;
  apiKey: string;
  maxSteps: number;
  yes: boolean;
  readOnly: boolean;
}

function usage(): string {
  return [
    'AhiCode CLI',
    '',
    'Usage:',
    '  npm run cli -- --prompt "Task" [options]',
    '  npm run cli --                    Interactive chat (terminalde sohbet; exit ile çık)',
    '',
    'Options:',
    '  --workspace <path>   Workspace (default: cwd)',
    '  --provider <name>    evren | ollama | openrouter | openai-compatible',
    '  --model <id>         Model ID',
    '  --api-key <key>      API key. WARNING: command-line arguments are visible',
    '                       in shell history and the process list; prefer the',
    '                       EVREN_API_KEY / OPENROUTER_API_KEY / OPENAI_COMPATIBLE_API_KEY',
    '                       environment variables.',
    '  --max-steps <n>      Maximum agent steps (default: 30)',
    '  --yes                Automatically approve operations that require approval',
    '  --read-only          Read-only tools only',
    '  --help               Show this message'
  ].join('\n');
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    prompt: '',
    workspace: process.cwd(),
    provider: 'ollama',
    model: '',
    apiKey: '',
    maxSteps: 30,
    yes: false,
    readOnly: false
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? '';
    const next = argv[index + 1];
    switch (arg) {
      case '--prompt':
        options.prompt = next || '';
        index++;
        break;
      case '--workspace':
        options.workspace = path.resolve(next || '.');
        index++;
        break;
      case '--provider': {
        const provider = next as ModelProviderType;
        if (
          provider === 'evren' ||
          provider === 'openrouter' ||
          provider === 'ollama' ||
          provider === 'openai-compatible'
        ) {
          options.provider = provider;
        }
        index++;
        break;
      }
      case '--model':
        options.model = next || options.model;
        index++;
        break;
      case '--api-key':
        options.apiKey = next || '';
        index++;
        process.stderr.write(
          'Warning: --api-key is visible in shell history and the process list. ' +
            'Prefer the provider-specific environment variable instead.\n'
        );
        break;
      case '--max-steps':
        options.maxSteps = Math.max(1, Number(next) || 30);
        index++;
        break;
      case '--yes':
        options.yes = true;
        break;
      case '--read-only':
        options.readOnly = true;
        break;
      case '--help':
      case '-h':
        process.stdout.write(`${usage()}\n`);
        process.exit(0);
        break;
      default:
        if (!arg.startsWith('-') && !options.prompt) options.prompt = arg;
        break;
    }
  }

  // Etkileşimli sohbet yalnızca gerçek bir terminalde anlamlıdır; boru/hook
  // altında istem boşsa hâlâ --prompt şarttır.
  if (!options.prompt.trim() && !process.stdin.isTTY) {
    throw new Error(`--prompt is required.\n\n${usage()}`);
  }
  // Sağlayıcıya göre anahtar ortam değişkenini seç
  const providerKeyEnv =
    options.provider === 'evren'
      ? process.env.EVREN_API_KEY
      : options.provider === 'openrouter'
        ? process.env.OPENROUTER_API_KEY
        : options.provider === 'openai-compatible'
          ? process.env.OPENAI_COMPATIBLE_API_KEY
          : undefined;
  options.apiKey = options.apiKey || providerKeyEnv || '';
  return options;
}

export function buildSettings(options: CliOptions): UserSettings {
  const defaultModelForProvider =
    options.provider === 'evren'
      ? 'auto'
      : options.provider === 'ollama'
        ? 'llama3.1'
        : options.provider === 'openrouter'
          ? 'anthropic/claude-3.5-sonnet'
          : '';
  const selectedModel = options.model.trim() || defaultModelForProvider;
  return {
    selectedProvider: options.provider,
    selectedModel,
    apiKeys: {
      evren: options.provider === 'evren' ? options.apiKey : undefined,
      openrouter: options.provider === 'openrouter' ? options.apiKey : undefined,
      openaiCompatible: options.provider === 'openai-compatible' ? options.apiKey : undefined
    },
    openAiCompatibleBaseUrl: process.env.OPENAI_COMPATIBLE_BASE_URL,
    autoApprove: {
      readFiles: true,
      writeFiles: options.yes,
      executeCommands: options.yes
    },
    autoVerify: false,
    maxStepsPerTask: options.maxSteps,
    sandbox: { mode: 'none', image: 'node:20-bookworm', network: false }
  };
}

// Tek paylaşılan readline akışı: onay soruları ile etkileşimli sohbet aynı
// stdin'i kullanır; her soru için yeni arayüz açmak girdiyi bölüp kilitlerdi.
let sharedReadline: ReturnType<typeof createInterface> | undefined;
function getReadline(): ReturnType<typeof createInterface> {
  if (!sharedReadline) {
    sharedReadline = createInterface({ input: process.stdin, output: process.stdout });
  }
  return sharedReadline;
}

async function askApproval(question: string): Promise<boolean> {
  const answer = (await getReadline().question(`${question} [y/N] `)).trim().toLowerCase();
  return answer === 'e' || answer === 'evet' || answer === 'y' || answer === 'yes';
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const settings = buildSettings(options);
  const provider = createModelProvider(settings);
  const permissionManager = new PermissionManager(settings);
  // CLI'da Workspace Trust arayüzü yoktur; bu yüzden depo tarafından verilen
  // allow kuralları yalnızca kullanıcı --yes ile açıkça izin verdiğinde geçerli
  // olur. Aksi hâlde her yazma/komutu global ayarlar ve onay istemleri yönetir.
  await permissionManager.loadProjectPermissions(options.workspace, options.yes);

  // Ctrl+C: model isteklerini ve çalışan komutları AbortSignal ile durdurur.
  // İkinci bir Ctrl+C anında çıkmaya zorlar.
  const abortController = new AbortController();
  process.on('SIGINT', () => {
    if (abortController.signal.aborted) {
      process.exit(130);
    }
    process.stdout.write('\nStopping... (press Ctrl+C again to force exit)\n');
    abortController.abort();
  });

  const snapshotManager = new SnapshotManager();
  const verificationManager = new VerificationManager();
  verificationManager.setCommandFilter(
    (command) => !permissionManager.isToolBlocked('execute_command', { command }).blocked
  );
  const gitManager = new GitManager();
  const projectMemory = new ProjectMemoryManager();
  const planner = new TaskPlanner();

  // Salt-okunur mod hem modele sunulan araçları hem yürütücünün izin kümesini daraltır.
  const allowedTools = new Set<ToolName>(
    [...CLI_TOOLS].filter((name) => !options.readOnly || READ_ONLY_TOOLS.has(name))
  );
  const tools = Object.values(ALL_TOOLS).filter((tool) => allowedTools.has(tool.name));
  const systemPrompt = await generateSystemPrompt(
    options.workspace,
    'code',
    '',
    '',
    planner.formatForPrompt()
  );
  const messages: ProviderMessage[] = [{ role: 'system', content: systemPrompt }];
  const context: ToolExecutionContext = {
    workspaceRoot: options.workspace,
    snapshotManager,
    permissionManager,
    verificationManager,
    gitManager,
    projectMemory,
    signal: abortController.signal
  };

  // Bağlam bütçesi: araç şemaları da sayılır; uzun görevlerde istek taşmasın.
  const contextManager = new ContextManager({
    contextWindowTokens: Number(process.env.AHI_CONTEXT_WINDOW_TOKENS) || undefined,
    tools
  });
  // Dejeneratif tekrar koruması: model bir satıra kilitlenirse akışı kes.
  let repetitionHit = false;

  // Döngü koruması: aynı araç aynı argümanlarla art arda üçüncü kez patlarsa
  // dur; aksi hâlde CLI otuz adımı aynı hatayla tüketir.
  let lastFailure: { key: string; count: number } | undefined;

  // Tek istem turu: etkileşimli modda aynı mesaj geçmişi sürer; model araçsız
  // yanıt verince tur biter ve söz terminale döner.
  const runPrompt = async (promptText: string): Promise<boolean> => {
    messages.push({ role: 'user', content: promptText });
    for (let step = 0; step < options.maxSteps; step++) {
      const outbound = contextManager.pruneMessages(contextManager.compactHistory(messages), tools);
      const guard = new StreamRepetitionGuard();
      repetitionHit = false;
      // Adıma özel iptal: tekrar kesintisi sonraki istekleri sakatlamasın.
      const stepAbort = new AbortController();
      const stepSignal =
        typeof AbortSignal.any === 'function'
          ? AbortSignal.any([abortController.signal, stepAbort.signal])
          : abortController.signal;
      let assistantProbe = '';
      let response;
      try {
        response = await provider.sendMessage(
          outbound,
          tools,
          (chunk) => {
            if (repetitionHit) return;
            process.stdout.write(chunk);
            assistantProbe += chunk;
            if (guard.check(assistantProbe)) {
              repetitionHit = true;
              process.stdout.write('\n⚠ Model tekrara girdi; yanıt kesildi.\n');
              stepAbort.abort();
            }
          },
          stepSignal
        );
      } catch (err) {
        if (repetitionHit) {
          // Korumalı kesinti: iptal değil, yanıtsız tur. Modele durumu bildir.
          messages.push({
            role: 'assistant',
            content: '[The response collapsed into repeated lines and was truncated by the client.]'
          });
          messages.push({
            role: 'user',
            content:
              'Your previous answer collapsed into a repeated line. Continue the task concisely without repeating.'
          });
          continue;
        }
        if (abortController.signal.aborted) {
          process.stdout.write('\nCancelled.\n');
          process.exit(130);
        }
        throw err;
      }
      if (response.text) {
        // Akışsız sağlayıcılar için son kontrol; akışta yazılan metin tekrar
        // içermiyorsa hiçbir şey değişmez.
        if (!repetitionHit && findRepetitionCollapse(response.text)) {
          response = { ...response, text: collapseRepetition(response.text) };
        }
        process.stdout.write('\n');
      }

      messages.push({
        role: 'assistant',
        content: response.text,
        toolCalls: response.toolCalls
      });

      if (!response.toolCalls || response.toolCalls.length === 0) {
        return true;
      }

      for (const toolCall of response.toolCalls) {
        const toolName = toolCall.name as ToolName;
        // Kapı zinciri paylaşılan yürütücüdedir; CLI kendi kopyasını taşımaz.
        const outcome = await runToolCall(
          {
            id: toolCall.id,
            name: toolName,
            args: toolCall.arguments ?? {},
            requiresApproval: false,
            status: 'pending'
          },
          {
            workspaceRoot: options.workspace,
            permissionManager,
            snapshotManager,
            planner,
            context,
            allowedTools,
            approve: options.yes
              ? async () => true
              : (explanation) => askApproval(`${explanation} Do you approve?`)
          }
        );

        const result = outcome.output;
        process.stdout.write(`\n[${toolName}] ${result.slice(0, 2_000)}\n`);
        messages.push({ role: 'tool', toolCallId: toolCall.id, content: result });

        // Döngü koruması: aynı araç aynı argümanlarla art arda üçüncü kez
        // patlarsa çıkmaz sokakta dönülüyordur; CLI'ı nazikçe durdur.
        if (!outcome.ok) {
          const key = `${toolName}::${JSON.stringify(toolCall.arguments ?? {})}`;
          lastFailure =
            lastFailure && lastFailure.key === key
              ? { key, count: lastFailure.count + 1 }
              : { key, count: 1 };
          if (lastFailure.count >= 3) {
            process.stderr.write(
              `\n“${toolName}” aynı argümanlarla üst üste üç kez hata verdi; döngü durduruldu. ` +
                'Yaklaşımı değiştirin ya da onay/izin ayarlarını gözden geçirin.\n'
            );
            process.exit(1);
          }
        } else {
          lastFailure = undefined;
        }
      }
    }
    process.stderr.write(`Maximum step limit (${options.maxSteps}) reached.\n`);
    return false;
  };

  if (options.prompt.trim()) {
    const completed = await runPrompt(options.prompt);
    sharedReadline?.close();
    if (!completed) {
      process.exit(1);
    }
    return;
  }

  // Terminal sohbeti: mesaj geçmişi istemler arasında kalıcıdır.
  process.stdout.write('AhiCode etkileşimli sohbet — çıkmak için: exit\n');
  for (;;) {
    const line = (await getReadline().question('\nsen> ')).trim();
    if (!line || /^(exit|quit|\/exit|\/q)$/i.test(line)) break;
    await runPrompt(line);
  }
  sharedReadline?.close();
}

function isMainModule(): boolean {
  if (typeof process === 'undefined' || !process.argv[1]) return false;
  const script = process.argv[1].replace(/\\/g, '/');
  return (script.endsWith('/cli.ts') || script.endsWith('/cli.js')) && !process.argv.includes('--test');
}

if (isMainModule()) {
  main().catch((error) => {
    process.stderr.write(`AhiCode CLI error: ${errorMessage(error)}\n`);
    process.exit(1);
  });
}
