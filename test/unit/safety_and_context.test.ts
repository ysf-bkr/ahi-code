import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import { resolveWorkspacePath } from '../../src/tools/pathSafety';
import { ContextManager } from '../../src/core/context/ContextManager';
import { ProviderMessage } from '../../src/providers/base';

describe('P0-02: Path Jail & Safety', () => {
  const fakeRoot = '/Users/test/workspace/project';

  it('allows safe relative path within workspace', () => {
    const res = resolveWorkspacePath('src/index.ts', fakeRoot);
    assert.strictEqual(res, path.normalize('/Users/test/workspace/project/src/index.ts'));
  });

  it('allows safe absolute path inside root', () => {
    const res = resolveWorkspacePath('/Users/test/workspace/project/README.md', fakeRoot);
    assert.strictEqual(res, path.normalize('/Users/test/workspace/project/README.md'));
  });

  it('rejects path traversal attempting to escape root', () => {
    assert.throws(() => {
      resolveWorkspacePath('../../etc/passwd', fakeRoot);
    }, /Security violation/);
  });

  it('accepts legitimate path on case-insensitive platforms', async () => {
    if (process.platform !== 'darwin' && process.platform !== 'win32') return;
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'Ahi-Case-'));
    try {
      await fs.writeFile(path.join(root, 'File.txt'), 'x', 'utf-8');
      const differentCase = path.join(root.toUpperCase(), 'file.txt');
      assert.doesNotThrow(() => resolveWorkspacePath(differentCase, root));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('rejects external absolute paths outside workspace', () => {
    assert.throws(() => {
      resolveWorkspacePath('/etc/passwd', fakeRoot);
    }, /Security violation/);
  });
});

describe('P0-10: Context Budget & Manager', () => {
  const manager = new ContextManager({ contextWindowTokens: 1000, maxToolOutputChars: 200 });

  it('estimates token count accurately', () => {
    const tokens = manager.estimateTokens('12345678'); // 8 chars ~ 3 tokens
    assert.ok(tokens >= 2 && tokens <= 4);
  });

  it('truncates oversized tool outputs with a warning note', () => {
    const longOutput = 'A'.repeat(500);
    const truncated = manager.truncateToolOutput(longOutput);
    assert.ok(truncated.includes('truncated'), 'truncation should be indicated');
    assert.ok(truncated.includes('characters omitted'), 'omitted character count should be written');
    assert.ok(truncated.length < 500);
  });

  it('keeps the tail of a truncated command log so the exit reason survives', () => {
    const log = `${'build output line\n'.repeat(200)}exit code: 1`;
    const truncated = manager.truncateToolOutput(log);
    assert.ok(truncated.endsWith('exit code: 1'), 'last line should be preserved');
  });

  it('truncates older, oversized system messages to fit the context window', () => {
    const tight = new ContextManager({ contextWindowTokens: 500 });
    const messages: ProviderMessage[] = [
      { role: 'system', content: 'ANA TALİMAT' },
      { role: 'system', content: 'DOGRULAMA '.repeat(500) },
      { role: 'system', content: 'DOGRULAMA2 '.repeat(500) },
      { role: 'system', content: 'SON SISTEM' },
      { role: 'user', content: 'soru' },
      { role: 'assistant', content: 'yanit' }
    ];
    const pruned = tight.pruneMessages(messages);
    const systemText = pruned
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n');
    assert.ok(systemText.includes('truncated'));
    assert.ok(systemText.length < 'DOGRULAMA '.repeat(1000).length);
  });

  it('prunes the final large units to fit the context window', () => {
    const tight = new ContextManager({ contextWindowTokens: 900 });
    const messages: ProviderMessage[] = [{ role: 'system', content: 'sistem' }];
    for (let i = 0; i < 3; i++) {
      messages.push({
        role: 'assistant',
        content: `adım ${i}`,
        toolCalls: [{ id: `call_${i}`, name: 'read_file', arguments: { path: 'a.ts' } }]
      });
      messages.push({ role: 'tool', toolCallId: `call_${i}`, content: 'B'.repeat(10_000) });
    }
    const pruned = tight.pruneMessages(messages);
    assert.ok(tight.estimateMessagesTokens(pruned) <= 1_400);
    assert.ok(pruned.some((message) => message.content.includes('truncated to fit the context window')));
    assert.strictEqual(pruned[0]?.role, 'system');
  });

  it('preserves system and recent messages during pruning', () => {
    const messages: ProviderMessage[] = [
      { role: 'system', content: 'System instruction' },
      { role: 'user', content: 'First query' },
      { role: 'assistant', content: 'Long answer '.repeat(50) },
      { role: 'tool', content: 'Huge tool result '.repeat(100), toolCallId: 'call_1' },
      { role: 'user', content: 'Recent query' },
      { role: 'assistant', content: 'Recent answer' }
    ];

    const pruned = manager.pruneMessages(messages);
    assert.strictEqual(pruned[0]?.role, 'system');
    assert.strictEqual(pruned[pruned.length - 1]?.content, 'Recent answer');
  });
});
