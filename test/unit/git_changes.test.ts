import { describe, it, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { collectGitChanges, readGitFileDiff } from '../../src/webview/gitChanges';
import { GitManager } from '../../src/core/git/GitManager';

const execFileAsync = promisify(execFile);

async function initRepository(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-gitview-'));
  await execFileAsync('git', ['init', '-q'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: root });
  await fs.writeFile(path.join(root, 'a.txt'), 'ilk\n', 'utf-8');
  await execFileAsync('git', ['add', '.'], { cwd: root });
  await execFileAsync('git', ['commit', '-q', '-m', 'ilk commit'], { cwd: root });
  return root;
}

describe('gitChanges: Değişiklikler ekranı verisi', () => {
  const roots: string[] = [];

  after(async () => {
    await Promise.all(roots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('depo değilken açık bir payload döner', async () => {
    const payload = await collectGitChanges(undefined, new GitManager());
    assert.strictEqual(payload.isRepository, false);
    assert.ok(payload.error);
  });

  it('dalları, değişen dosyaları ve commit listesini toplar', async () => {
    const root = await initRepository();
    roots.push(root);
    await fs.writeFile(path.join(root, 'a.txt'), 'değişti\n', 'utf-8');

    const payload = await collectGitChanges(root, new GitManager());
    assert.strictEqual(payload.isRepository, true);
    assert.ok(payload.branch.length > 0);
    assert.ok(payload.files.some((file) => file.path === 'a.txt'));
    assert.strictEqual(payload.commits.length, 1);
    assert.strictEqual(payload.error, undefined);
  });

  it('tek dosya farkını döndürür, değişiklik yoksa hata verir', async () => {
    const root = await initRepository();
    roots.push(root);
    await fs.writeFile(path.join(root, 'a.txt'), 'değişti\n', 'utf-8');

    const diff = await readGitFileDiff(root, new GitManager(), 'a.txt');
    assert.ok(diff.includes('-ilk'));
    assert.ok(diff.includes('+değişti'));

    await execFileAsync('git', ['checkout', '--', 'a.txt'], { cwd: root });
    await assert.rejects(() => readGitFileDiff(root, new GitManager(), 'a.txt'), /fark bulunamadı/);
  });

  it('Git deposu olmayan dizinde anlaşılır hata verir', async () => {
    const plain = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-plain-view-'));
    roots.push(plain);
    await assert.rejects(() => readGitFileDiff(plain, new GitManager(), 'x.txt'), /Git deposu değil/);
  });
});
