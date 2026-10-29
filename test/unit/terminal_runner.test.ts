import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { ALL_TOOLS, executeCommandTool } from '../../src/tools';
import { ToolExecutionContext } from '../../src/tools/base';

describe('runShellCommand: integrated terminal routing', () => {
  it('delegates command to terminal runner when available', async () => {
    const calls: Array<{ command: string; root: string }> = [];
    const context: ToolExecutionContext = {
      workspaceRoot: '/tmp/project',
      terminal: async (command, root) => {
        calls.push({ command, root });
        return 'terminal output';
      }
    };

    const result = await executeCommandTool.execute({ command: 'npm test' }, context);

    assert.deepEqual(calls, [{ command: 'npm test', root: '/tmp/project' }]);
    assert.strictEqual(result, 'terminal output');
  });

  it('uses isolated runner instead of terminal with sandbox', async () => {
    let terminalUsed = false;
    const context: ToolExecutionContext = {
      workspaceRoot: '/tmp/project',
      sandbox: { image: 'node:20-bookworm', workspaceRoot: '/tmp/project', network: false },
      terminal: async () => {
        terminalUsed = true;
        return 'should not run';
      }
    };

    // Docker sandbox yolu `docker`'ı kabukta çalıştırır; test ortamında yoktur,
    // bu yüzden burada beklenen sonuç bir reddedilmedir.
    await assert.rejects(executeCommandTool.execute({ command: 'echo hi' }, context), (_err: unknown) => {
      assert.equal(terminalUsed, false, 'terminal must not be used with sandbox');
      return true;
    });
  });

  it('run_tests passes detected command to terminal runner', async () => {
    const commands: string[] = [];
    const context: ToolExecutionContext = {
      workspaceRoot: process.cwd(),
      terminal: async (command) => {
        commands.push(command);
        return 'ok';
      }
    };

    // Çalışma alanında package.json var; test komutu otomatik algılanır ve
    // terminale ulaşan, çözülen komutun kendisidir.
    await ALL_TOOLS.run_tests.execute({}, context);
    assert.ok(commands.length === 1, 'exactly one command should run');
    assert.match(commands[0] ?? '', /^(npm|pnpm|yarn) test$/);
  });

  it('uses hidden process path when no terminal runner (CLI)', async () => {
    const context: ToolExecutionContext = { workspaceRoot: process.cwd() };
    const result = await executeCommandTool.execute({ command: 'echo hidden-path' }, context);
    assert.match(result, /hidden-path/);
  });
});
