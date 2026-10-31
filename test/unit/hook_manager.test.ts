import { describe, it, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { HookManager } from '@ahicode/core/core/hooks/HookManager';

describe('HookManager: security and environment cleanup', () => {
  let root: string;
  const roots: string[] = [];

  after(async () => {
    await Promise.all(roots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('does not run dangerous hook command', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-hook-'));
    roots.push(root);
    const manager = new HookManager(() => true);
    manager.registerHook({ lifecycle: 'PreToolUse', command: 'rm -rf /' });
    const result = await manager.runPreToolUse('read_file', { path: 'x' }, root);
    assert.strictEqual(result.proceed, true);
  });

  it('cleans API keys from hook environment', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-hook-env-'));
    roots.push(root);
    const previousKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'cok-gizli-anahtar';
    try {
      const manager = new HookManager(() => true);
      manager.registerHook({
        lifecycle: 'PreToolUse',
        command:
          "node -e \"require('fs').writeFileSync('env-check.txt', process.env.OPENAI_API_KEY || 'clean')\""
      });
      await manager.runPreToolUse('read_file', { path: 'x' }, root);
      const content = await fs.readFile(path.join(root, 'env-check.txt'), 'utf-8');
      assert.strictEqual(content, 'clean');
    } finally {
      if (previousKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousKey;
      }
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('does not load project hooks without an approval channel', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-hook-noapproval-'));
    roots.push(root);
    await fs.mkdir(path.join(root, '.ahi'), { recursive: true });
    await fs.writeFile(
      path.join(root, '.ahi', 'hooks.json'),
      JSON.stringify({ hooks: [{ lifecycle: 'PreToolUse', command: 'touch should-not-run.txt' }] }),
      'utf-8'
    );
    // Fail closed: no approval callback means repository hooks are ignored.
    const manager = new HookManager(() => true);
    await manager.loadWorkspaceHooks(root);
    await manager.runPreToolUse('read_file', { path: 'x' }, root);
    await assert.rejects(() => fs.access(path.join(root, 'should-not-run.txt')));
  });

  it('loads project hooks only after the fingerprint is approved', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-hook-approval-'));
    roots.push(root);
    await fs.mkdir(path.join(root, '.ahi'), { recursive: true });
    await fs.writeFile(
      path.join(root, '.ahi', 'hooks.json'),
      JSON.stringify({ hooks: [{ lifecycle: 'PreToolUse', command: 'touch approved.txt' }] }),
      'utf-8'
    );

    let requestedFingerprint = '';
    const manager = new HookManager(
      () => true,
      async (fingerprint) => {
        requestedFingerprint = fingerprint;
        return true;
      }
    );
    await manager.loadWorkspaceHooks(root);
    assert.strictEqual(requestedFingerprint.length, 64);
    await manager.runPreToolUse('read_file', { path: 'x' }, root);
    await assert.doesNotReject(() => fs.access(path.join(root, 'approved.txt')));
  });

  it('skips project hooks when the user rejects the approval', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-hook-rejected-'));
    roots.push(root);
    await fs.mkdir(path.join(root, '.ahi'), { recursive: true });
    await fs.writeFile(
      path.join(root, '.ahi', 'hooks.json'),
      JSON.stringify({ hooks: [{ lifecycle: 'PreToolUse', command: 'touch rejected.txt' }] }),
      'utf-8'
    );
    const manager = new HookManager(
      () => true,
      async () => false
    );
    await manager.loadWorkspaceHooks(root);
    await manager.runPreToolUse('read_file', { path: 'x' }, root);
    await assert.rejects(() => fs.access(path.join(root, 'rejected.txt')));
  });

  it('does not load hook file from untrusted workspace', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-hook-untrusted-'));
    roots.push(root);
    await fs.mkdir(path.join(root, '.ahi'), { recursive: true });
    await fs.writeFile(
      path.join(root, '.ahi', 'hooks.json'),
      JSON.stringify({ hooks: [{ lifecycle: 'PreToolUse', command: 'touch x' }] }),
      'utf-8'
    );
    const manager = new HookManager(() => false);
    await manager.loadWorkspaceHooks(root);
    const result = await manager.runPreToolUse('read_file', { path: 'x' }, root);
    assert.strictEqual(result.proceed, true);
    await fs.rm(root, { recursive: true, force: true });
  });
});
