import * as path from 'path';
// Do not use `import * as process from 'process'`: in the esbuild CJS bundle,
// it creates a namespace copy and attempts to register process.on() EventEmitter
// events on that copy, causing an "_eventsCount" error. The default import
// provides the actual process object.
import process from 'process';
import { createInterface } from 'readline/promises';
import { createModelProvider } from './providers';
import { ALL_TOOLS } from './tools';
import { ToolExecutionContext } from './tools/base';
import { runToolCall } from './core/toolRunner';
import { generateSystemPrompt } from './core/prompts/systemPrompt';
import { PermissionManager } from './core/permission/PermissionManager';
import { SnapshotManager } from './core/snapshot/SnapshotManager';
import { VerificationManager } from './core/verification/VerificationManager';
import { GitManager } from './core/git/GitManager';
import { ProjectMemoryManager } from './core/memory/ProjectMemoryManager';
import { TaskPlanner } from './core/plan/TaskPlanner';
import { ProviderMessage } from './providers/base';
import { ModelProviderType, ToolName, UserSettings } from './shared/types';
import { errorMessage } from './shared/errors';

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

  if (!options.prompt.trim()) {
    throw new Error(`--prompt is required.\n\n${usage()}`);
  }
  // Select the key environment variable based on the provider
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

async function askApproval(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === 'e' || answer === 'evet' || answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const settings = buildSettings(options);
  const provider = createModelProvider(settings);
  const permissionManager = new PermissionManager(settings);
  // The CLI has no Workspace Trust UI, so repository-provided allow rules are
  // only honored when the user explicitly opted in with --yes. Otherwise the
  // global settings and the approval prompts govern every write/command.
  await permissionManager.loadProjectPermissions(options.workspace, options.yes);

  // Ctrl+C: stop model requests and running commands with AbortSignal.
  // A second Ctrl+C forces an immediate exit.
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
  const messages: ProviderMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: options.prompt }
  ];
  const context: ToolExecutionContext = {
    workspaceRoot: options.workspace,
    snapshotManager,
    verificationManager,
    gitManager,
    projectMemory,
    signal: abortController.signal
  };

  for (let step = 0; step < options.maxSteps; step++) {
    let response;
    try {
      response = await provider.sendMessage(
        messages,
        tools,
        (chunk) => {
          process.stdout.write(chunk);
        },
        abortController.signal
      );
    } catch (err) {
      if (abortController.signal.aborted) {
        process.stdout.write('\nCancelled.\n');
        process.exit(130);
      }
      throw err;
    }
    if (response.text) process.stdout.write('\n');

    messages.push({
      role: 'assistant',
      content: response.text,
      toolCalls: response.toolCalls
    });

    if (!response.toolCalls || response.toolCalls.length === 0) {
      return;
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
    }
  }

  process.stderr.write(`Maximum step limit (${options.maxSteps}) reached.\n`);
  process.exit(1);
}

export function isMainModule(): boolean {
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
