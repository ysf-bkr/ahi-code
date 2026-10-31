import { describe, it, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { collectMentionSnippets, extractFileMentions } from '@ahicode/core/core/agent/fileMentions';

describe('fileMentions: @file context', () => {
  const roots: string[] = [];

  after(async () => {
    await Promise.all(roots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('extracts unique mentions in order', () => {
    assert.deepStrictEqual(extractFileMentions('check @src/a.ts and @package.json and @src/a.ts'), [
      'src/a.ts',
      'package.json'
    ]);
    assert.deepStrictEqual(extractFileMentions('no mentions here'), []);
  });

  it('reads mentioned files and reports the remaining lines', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-mention-'));
    roots.push(root);
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'a.ts'), 'line1\nline2\nline3', 'utf-8');

    const snippets = await collectMentionSnippets('look at @src/a.ts', {
      workspaceRoot: root,
      maxLinesPerFile: 2
    });

    assert.strictEqual(snippets.length, 1);
    assert.ok(snippets[0]?.includes('@src/a.ts'));
    assert.ok(snippets[0]?.includes('line1'));
    assert.ok(!snippets[0]?.includes('line3'));
    assert.ok(snippets[0]?.includes('1 remaining lines truncated'));
  });

  it('skips blocked files, directories and missing paths', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-mention-blocked-'));
    roots.push(root);
    await fs.mkdir(path.join(root, 'secret'), { recursive: true });
    await fs.writeFile(path.join(root, 'secret', 'keys.txt'), 'token', 'utf-8');
    await fs.writeFile(path.join(root, 'ok.txt'), 'fine', 'utf-8');

    const snippets = await collectMentionSnippets('@secret/keys.txt @missing.txt @secret @ok.txt', {
      workspaceRoot: root,
      isBlocked: (relative) => relative.startsWith('secret')
    });

    assert.strictEqual(snippets.length, 1);
    assert.ok(snippets[0]?.includes('@ok.txt'));
  });
});
