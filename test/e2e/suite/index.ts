import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

/**
 * Integration suite executed inside a real VS Code extension host.
 *
 * Kept dependency-free (no Mocha): a tiny harness collects failures and the
 * entry point rejects, which makes @vscode/test-electron exit with code 1.
 */

const EXTENSION_ID = 'ysf-bkr.ahi-code';
const VIEW_TYPE = 'ahi-code.SidebarProvider';
const CONTAINER_ID = 'ahi-code-sidebar-view';

interface Manifest {
  engines?: { vscode?: string };
  main?: string;
  activationEvents?: string[];
  contributes?: {
    viewsContainers?: Record<string, Array<{ id: string; title: string; icon?: string }>>;
    views?: Record<string, Array<{ id: string; type?: string; name: string }>>;
    commands?: Array<{ command: string; title: string }>;
    configuration?: { properties?: Record<string, { default?: unknown; type?: string }> };
  };
}

const failures: string[] = [];
let passed = 0;

function errorText(error: unknown): string {
  return error instanceof Error ? error.stack || error.message : String(error);
}

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (error) {
    failures.push(`${name}: ${errorText(error)}`);
    console.error(`  not ok - ${name}`);
    console.error(`    ${errorText(error).split('\n').join('\n    ')}`);
  }
}

function readManifest(extensionPath: string): Manifest {
  return JSON.parse(fs.readFileSync(path.join(extensionPath, 'package.json'), 'utf-8')) as Manifest;
}

function parseVersion(value: string): number[] {
  return value
    .replace(/^[^\d]*/, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
}

function isAtLeast(actual: string, minimum: string): boolean {
  const a = parseVersion(actual);
  const b = parseVersion(minimum);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) return left > right;
  }
  return true;
}

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `Extension ${EXTENSION_ID} was not discovered by VS Code.`);

  const manifest = readManifest(extension.extensionPath);

  console.log('\nExtension manifest and activation');

  await test('manifest engines.vscode matches the API we use', () => {
    const minimum = manifest.engines?.vscode ?? '';
    assert.ok(minimum, 'engines.vscode is missing.');
    // viewsContainers.secondarySidebar is only supported from 1.106 onwards.
    assert.ok(
      isAtLeast(minimum, '1.106.0'),
      `engines.vscode is ${minimum}; secondarySidebar requires >= 1.106.0.`
    );
    assert.ok(
      isAtLeast(vscode.version, '1.106.0'),
      `Running VS Code ${vscode.version} is older than the declared minimum ${minimum}.`
    );
  });

  await test('extension activates without throwing', async () => {
    await extension.activate();
    assert.strictEqual(extension.isActive, true);
  });

  await test('activation event targets the contributed view', () => {
    const events = manifest.activationEvents ?? [];
    assert.ok(
      events.includes(`onView:${VIEW_TYPE}`),
      `activationEvents must include onView:${VIEW_TYPE}, got ${JSON.stringify(events)}`
    );
    const views = manifest.contributes?.views?.[CONTAINER_ID] ?? [];
    assert.ok(
      views.some((view) => view.id === VIEW_TYPE),
      `view ${VIEW_TYPE} is not contributed to ${CONTAINER_ID}`
    );
  });

  await test('view container is contributed to the secondary sidebar', () => {
    const containers = manifest.contributes?.viewsContainers?.secondarySidebar ?? [];
    const container = containers.find((item) => item.id === CONTAINER_ID);
    assert.ok(container, `container ${CONTAINER_ID} is missing from secondarySidebar`);
    assert.ok(container.icon, 'container icon is required');
  });

  await test('view is a webview type', () => {
    const views = manifest.contributes?.views?.[CONTAINER_ID] ?? [];
    const view = views.find((item) => item.id === VIEW_TYPE);
    assert.ok(view, `view ${VIEW_TYPE} is not contributed`);
    assert.strictEqual(view.type, 'webview');
  });

  console.log('\nCommands');

  await test('declared commands are registered at runtime', async () => {
    const declared = (manifest.contributes?.commands ?? []).map((command) => command.command).sort();
    assert.ok(declared.length > 0, 'no commands are declared');
    const registered = await vscode.commands.getCommands(true);
    for (const command of declared) {
      assert.ok(registered.includes(command), `${command} is declared but not registered`);
    }
  });

  await test('newTask command executes without throwing', async () => {
    await vscode.commands.executeCommand('ahi-code.newTask');
  });

  console.log('\nConfiguration');

  await test('settings expose the documented defaults', () => {
    const config = vscode.workspace.getConfiguration('ahiCode');
    // Local-first: a fresh install must work without an account or API key.
    assert.strictEqual(config.get('selectedProvider'), 'ollama');
    assert.strictEqual(config.get('selectedModel'), 'llama3.1');
    assert.strictEqual(config.get('promptCaching'), true);
    assert.strictEqual(config.get('autoVerify'), true);
    assert.strictEqual(config.get('sandboxMode'), 'none');
    assert.strictEqual(config.get('sandboxImage'), 'node:20-bookworm');
  });

  await test('every declared setting is readable through the configuration API', () => {
    const properties = manifest.contributes?.configuration?.properties ?? {};
    const config = vscode.workspace.getConfiguration('ahiCode');
    const keys = Object.keys(properties);
    assert.ok(keys.length > 0, 'no settings are declared');
    for (const key of keys) {
      const short = key.replace(/^ahiCode\./, '');
      const fromApi = config.get(short);
      const declared = properties[key]?.default;
      if (declared !== undefined) {
        assert.deepStrictEqual(fromApi, declared, `${key} default mismatch`);
      }
    }
  });

  console.log('\nPackaged artifacts');

  await test('main entry from the manifest exists', () => {
    const main = manifest.main ?? '';
    assert.ok(main, 'manifest.main is missing');
    const mainPath = path.join(extension.extensionPath, main);
    assert.ok(fs.existsSync(mainPath), `${main} does not exist; run npm run compile`);
  });

  await test('webview assets referenced by index.html exist', () => {
    const webviewDist = path.join(extension.extensionPath, 'webview-ui', 'dist');
    const indexPath = path.join(webviewDist, 'index.html');
    assert.ok(fs.existsSync(indexPath), 'webview-ui/dist/index.html is missing; run npm run build:ui');

    const html = fs.readFileSync(indexPath, 'utf-8');
    const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((match) => match[1] ?? '')
      .filter((ref) => ref && !ref.startsWith('http') && !ref.startsWith('data:'));

    assert.ok(references.length > 0, 'index.html does not reference any local asset');
    for (const reference of references) {
      const assetPath = path.join(webviewDist, reference.replace(/^\.\//, '').replace(/^\//, ''));
      assert.ok(fs.existsSync(assetPath), `referenced asset is missing: ${reference}`);
    }
  });

  await test('workspace fixture is open', () => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    assert.ok(folders.length > 0, 'no workspace folder was opened for the tests');
    assert.strictEqual(path.basename(folders[0]!.uri.fsPath), 'fixture');
  });

  await test('webview HTML is generated with a strict CSP', async () => {
    // Build the HTML the same way the provider does, using the real CSP source
    // and URI mapping from a live webview.
    const { buildWebviewHtml } = await import('../../../src/webview/webviewHtml');
    const extensionUri = extension.extensionUri;
    const html = buildWebviewHtml({
      distDir: path.join(extensionUri.fsPath, 'webview-ui', 'dist'),
      cspSource: 'vscode-webview://e2e',
      toWebviewUri: (asset: string) => `vscode-webview://e2e/${asset}`,
      theme: {
        editorFontFamily: '',
        editorFontSize: 13,
        editorFontWeight: 'normal',
        editorLineHeight: 1.4,
        terminalFontFamily: '',
        terminalFontSize: 13
      }
    });

    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /default-src 'none'/);
    assert.ok(!/script-src[^;]*unsafe-inline/.test(html), 'script-src must not allow inline scripts');
    assert.ok(!html.includes('src="/assets/'), 'asset URLs were not rewritten to webview URIs');
  });

  await test('settings written by the user are picked up without a reload', async () => {
    const config = vscode.workspace.getConfiguration('ahiCode');
    const original = config.get<number>('maxStepsPerTask');
    try {
      await config.update('maxStepsPerTask', 7, vscode.ConfigurationTarget.Workspace);
      assert.strictEqual(vscode.workspace.getConfiguration('ahiCode').get('maxStepsPerTask'), 7);
    } finally {
      await config.update('maxStepsPerTask', undefined, vscode.ConfigurationTarget.Workspace);
    }
    assert.strictEqual(vscode.workspace.getConfiguration('ahiCode').get('maxStepsPerTask'), original);
  });

  console.log('\nApproval, cancellation and workspace trust');

  await test('a write tool pauses for approval and writes only after it', async () => {
    const { AgentCore } = await import('../../../src/core/agent/AgentCore');
    const fs = await import('node:fs/promises');
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'no workspace folder');
    const target = path.join(folder.uri.fsPath, 'approval-e2e.txt');
    await fs.rm(target, { force: true });

    const states: Array<{ status: string; pendingToolCall?: { id: string } }> = [];
    let call = 0;
    const provider = {
      id: 'e2e',
      name: 'E2E',
      async sendMessage() {
        call++;
        return call === 1
          ? {
              text: '',
              toolCalls: [
                {
                  id: 'e2e_write',
                  name: 'write_file',
                  arguments: { path: 'approval-e2e.txt', content: 'approved-by-e2e\n' }
                }
              ]
            }
          : { text: 'done' };
      }
    };

    const core = new AgentCore(
      {
        subscriptions: [],
        extensionUri: extension.extensionUri,
        extensionPath: extension.extensionPath,
        globalState: { get: () => undefined, update: async () => {}, keys: () => [] },
        workspaceState: { get: () => undefined, update: async () => {}, keys: () => [] },
        secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} },
        asAbsolutePath: (p: string) => p
      } as never,
      {
        selectedProvider: 'ollama',
        selectedModel: 'llama3.1',
        apiKeys: {},
        autoApprove: { readFiles: true, writeFiles: false, executeCommands: false },
        autoVerify: false,
        maxRepairAttempts: 0,
        useIntegratedTerminal: false
      } as never,
      (state) => states.push(state as never),
      () => {},
      undefined,
      { provider: provider as never }
    );

    const workflow = core.getState().workflow;
    if (workflow) {
      workflow.stage = 'build';
      workflow.specApproved = true;
      workflow.planApproved = true;
      workflow.knowledgeReady = true;
    }

    const run = core.handleSendMessage('create the file');
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (states.some((state) => state.status === 'waiting_approval')) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const pending = states.filter((state) => state.status === 'waiting_approval').at(-1);
    assert.ok(pending?.pendingToolCall, 'the agent did not pause for approval');
    await assert.rejects(() => fs.access(target), 'the file must not exist before approval');

    await core.approveTool(pending.pendingToolCall?.id ?? '');
    await run;
    assert.strictEqual(await fs.readFile(target, 'utf-8'), 'approved-by-e2e\n');
    await fs.rm(target, { force: true });
  });

  await test('cancelling while waiting for approval stops the turn', async () => {
    const { AgentCore } = await import('../../../src/core/agent/AgentCore');
    const states: Array<{ status: string }> = [];
    const provider = {
      id: 'e2e',
      name: 'E2E',
      async sendMessage() {
        return {
          text: '',
          toolCalls: [
            {
              id: 'e2e_write_cancel',
              name: 'write_file',
              arguments: { path: 'never-written.txt', content: 'x' }
            }
          ]
        };
      }
    };

    const core = new AgentCore(
      {
        subscriptions: [],
        extensionUri: extension.extensionUri,
        extensionPath: extension.extensionPath,
        globalState: { get: () => undefined, update: async () => {}, keys: () => [] },
        workspaceState: { get: () => undefined, update: async () => {}, keys: () => [] },
        secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} },
        asAbsolutePath: (p: string) => p
      } as never,
      {
        selectedProvider: 'ollama',
        selectedModel: 'llama3.1',
        apiKeys: {},
        autoApprove: { readFiles: true, writeFiles: false, executeCommands: false },
        autoVerify: false,
        maxRepairAttempts: 0,
        useIntegratedTerminal: false
      } as never,
      (state) => states.push(state as never),
      () => {},
      undefined,
      { provider: provider as never }
    );
    const workflow = core.getState().workflow;
    if (workflow) {
      workflow.stage = 'build';
      workflow.specApproved = true;
      workflow.planApproved = true;
      workflow.knowledgeReady = true;
    }

    const run = core.handleSendMessage('write and never finish');
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (states.some((state) => state.status === 'waiting_approval')) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await core.cancelTask();
    await run;
    assert.strictEqual(core.getState().status, 'cancelled');
  });

  await test('repository hooks require an explicit approval', async () => {
    const { HookManager } = await import('../../../src/core/hooks/HookManager');
    const fs = await import('node:fs/promises');
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'no workspace folder');
    const hookDir = path.join(folder.uri.fsPath, '.ahi');
    const hookFile = path.join(hookDir, 'hooks.json');
    await fs.mkdir(hookDir, { recursive: true });
    await fs.writeFile(
      hookFile,
      JSON.stringify({ hooks: [{ lifecycle: 'PreToolUse', command: 'touch hook-ran.txt' }] }),
      'utf-8'
    );

    try {
      // No approval channel: fail closed, the hook must not run.
      const unapproved = new HookManager(() => vscode.workspace.isTrusted);
      await unapproved.loadWorkspaceHooks(folder.uri.fsPath);
      await unapproved.runPreToolUse('read_file', { path: 'x' }, folder.uri.fsPath);
      await assert.rejects(() => fs.access(path.join(folder.uri.fsPath, 'hook-ran.txt')));

      // An explicit approval runs it.
      const approved = new HookManager(
        () => vscode.workspace.isTrusted,
        async () => true
      );
      await approved.loadWorkspaceHooks(folder.uri.fsPath);
      await approved.runPreToolUse('read_file', { path: 'x' }, folder.uri.fsPath);
      await fs.access(path.join(folder.uri.fsPath, 'hook-ran.txt'));
    } finally {
      await fs.rm(path.join(folder.uri.fsPath, 'hook-ran.txt'), { force: true });
      await fs.rm(hookFile, { force: true });
    }
  });

  // The agent writes audit/checkpoint/memory records into the workspace it
  // runs in. Remove them so a local e2e run leaves the fixture checkout clean.
  await test('e2e run leaves no agent artifacts in the fixture', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'no workspace folder');
    const fs = await import('node:fs/promises');
    await fs.rm(path.join(folder.uri.fsPath, '.ahi'), { recursive: true, force: true });

    for (const name of ['approval-e2e.txt', 'never-written.txt', 'hook-ran.txt']) {
      await assert.rejects(
        () => fs.access(path.join(folder.uri.fsPath, name)),
        `${name} must not survive the test`
      );
    }
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);

  if (failures.length > 0) {
    throw new Error(`VS Code integration tests failed:\n${failures.join('\n')}`);
  }
}
