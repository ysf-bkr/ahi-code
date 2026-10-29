import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { SnapshotManager } from '../../src/core/snapshot/SnapshotManager';
import { PermissionManager } from '../../src/core/permission/PermissionManager';
import { UserSettings } from '../../src/shared/types';
import {
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirectoryTool,
  searchFilesTool,
  executeCommandTool
} from '../../src/tools';
import { ToolExecutionContext } from '../../src/tools/base';

let tmpDir: string;

function ctx(): ToolExecutionContext {
  return { workspaceRoot: tmpDir };
}

describe('SnapshotManager: real file rollback', () => {
  let manager: SnapshotManager;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-snapshot-'));
    manager = new SnapshotManager();
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('restores an existing file to its pre-change state', async () => {
    const file = path.join(tmpDir, 'a.txt');
    await fs.writeFile(file, 'eski içerik', 'utf-8');

    const id = await manager.createSnapshot('a.txt', tmpDir, 'call_1');
    await fs.writeFile(file, 'yeni içerik', 'utf-8');

    const res = await manager.revertSnapshot(id, tmpDir);
    assert.strictEqual(res.success, true);
    assert.strictEqual(await fs.readFile(file, 'utf-8'), 'eski içerik');
  });

  it('deletes a newly created file when rolling back', async () => {
    const file = path.join(tmpDir, 'yeni.txt');
    const id = await manager.createSnapshot('yeni.txt', tmpDir, 'call_2');
    await fs.writeFile(file, 'yeni', 'utf-8');

    const res = await manager.revertSnapshot(id, tmpDir);
    assert.strictEqual(res.success, true);
    await assert.rejects(() => fs.access(file));
  });

  it('does not snapshot a path outside the workspace', async () => {
    await assert.rejects(() => manager.createSnapshot('/etc/passwd', tmpDir), /Security violation/);
  });

  it('does not treat an unreadable file as missing; throws a snapshot error', async () => {
    // EACCES/EPERM gibi okuma hataları existsBefore=false sayılmamalı;
    // aksi halde mevcut bir dosya geri alırken yanlışlıkla silinebilir.
    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    if (process.platform === 'win32' || isRoot) {
      // Bu ortamlarda chmod 000 okuma hatası üretmeyebilir
      return;
    }
    const file = path.join(tmpDir, 'korunan.txt');
    await fs.writeFile(file, 'gizli içerik', 'utf-8');
    try {
      await fs.chmod(file, 0o000);
      await assert.rejects(() => manager.createSnapshot('korunan.txt', tmpDir, 'call_eperm'));
    } finally {
      // Restore permissions so cleanup can run
      await fs.chmod(file, 0o644).catch(() => {});
    }
    // Dosya hâlâ yerinde ve silinmedi
    assert.strictEqual(await fs.readFile(file, 'utf-8'), 'gizli içerik');
  });
});

describe('File tools', () => {
  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-tools-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('write_file creates a file; read_file returns line numbers with offset/limit', async () => {
    await writeFileTool.execute({ path: 'src/test.txt', content: 'bir\niki\nüç\ndört' }, ctx());
    const content = await readFileTool.execute({ path: 'src/test.txt', offset: 2, limit: 2 }, ctx());
    assert.strictEqual(content, '2: iki\n3: üç');
  });

  it('edit_file rejects empty targetText and multiple matches', async () => {
    await writeFileTool.execute({ path: 'edit.txt', content: 'x x' }, ctx());
    await assert.rejects(
      () => editFileTool.execute({ path: 'edit.txt', targetText: '', replacementText: 'y' }, ctx()),
      /cannot be empty/
    );
    await assert.rejects(
      () => editFileTool.execute({ path: 'edit.txt', targetText: 'x', replacementText: 'y' }, ctx()),
      /appears 2 times/
    );
  });

  it('edit_file replaces every match with allowMultiple', async () => {
    await writeFileTool.execute({ path: 'edit2.txt', content: 'x x' }, ctx());
    await editFileTool.execute(
      { path: 'edit2.txt', targetText: 'x', replacementText: 'y', allowMultiple: true },
      ctx()
    );
    assert.strictEqual(await fs.readFile(path.join(tmpDir, 'edit2.txt'), 'utf-8'), 'y y');
  });

  it('edit_file matches an LF target in a CRLF file and preserves line endings', async () => {
    await writeFileTool.execute({ path: 'crlf.txt', content: 'bir\r\niki\r\nüç' }, ctx());
    await editFileTool.execute(
      {
        path: 'crlf.txt',
        targetText: 'bir\niki',
        replacementText: 'yeni\ndeğer'
      },
      ctx()
    );
    assert.strictEqual(await fs.readFile(path.join(tmpDir, 'crlf.txt'), 'utf-8'), 'yeni\r\ndeğer\r\nüç');
  });

  it('edit_file does not interpret $ sequences in the replacement', async () => {
    await writeFileTool.execute({ path: 'dolar.txt', content: 'fiyat = ESKI' }, ctx());
    await editFileTool.execute(
      { path: 'dolar.txt', targetText: 'ESKI', replacementText: '"$& $1 $$"' },
      ctx()
    );
    assert.strictEqual(await fs.readFile(path.join(tmpDir, 'dolar.txt'), 'utf-8'), 'fiyat = "$& $1 $$"');
  });

  it('write_file does not write outside the workspace', async () => {
    await assert.rejects(
      () => writeFileTool.execute({ path: '../kacak.txt', content: 'x' }, ctx()),
      /Security violation/
    );
  });

  it('execute_command returns output and can be cancelled with an abort signal', async () => {
    const output = await executeCommandTool.execute({ command: 'echo merhaba' }, ctx());
    assert.strictEqual(output.trim(), 'merhaba');

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    await assert.rejects(
      () =>
        executeCommandTool.execute(
          { command: 'node -e "setTimeout(() => {}, 3000)"' },
          { ...ctx(), signal: controller.signal }
        ),
      /cancelled by the user/
    );
  });

  it('execute_command bounds retained output for large processes', async () => {
    const output = await executeCommandTool.execute(
      { command: `node -e "process.stdout.write('x'.repeat(1000000))"` },
      ctx()
    );
    assert.ok(output.length <= 15_000);
    assert.ok(output.includes('Output truncated'));
  });

  it('search_files finds text and skips noisy directories', async () => {
    await fs.writeFile(path.join(tmpDir, 'aranan.ts'), 'const benzersizDeger = 42;', 'utf-8');
    await fs.writeFile(path.join(tmpDir, '.ENV'), 'benzersizDeger', 'utf-8');
    await fs.mkdir(path.join(tmpDir, 'node_modules'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'node_modules', 'gizli.ts'), 'benzersizDeger', 'utf-8');
    const result = await searchFilesTool.execute({ query: 'benzersizDeger' }, ctx());
    assert.ok(result.includes('aranan.ts'));
    assert.ok(!result.includes('.ENV'));
    assert.ok(!result.includes('gizli.ts'));
  });

  it('search_files applies the same deny rules as read_file (F04)', async () => {
    // ripgrep kurulu olsun ya da olmasın deny kapsamındaki içerik görünmemeli.
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-search-perm-'));
    try {
      await fs.mkdir(path.join(root, '.ahi'), { recursive: true });
      await fs.writeFile(
        path.join(root, '.ahi', 'permissions.json'),
        JSON.stringify({ deny: { readFiles: ['private/**'] } }),
        'utf-8'
      );
      await fs.mkdir(path.join(root, 'private'), { recursive: true });
      await fs.writeFile(path.join(root, 'private', 'notes.txt'), 'AUDIT_DENIED_CONTENT gizli', 'utf-8');
      await fs.writeFile(path.join(root, 'public.txt'), 'AUDIT_DENIED_CONTENT acik', 'utf-8');

      const settings: UserSettings = {
        selectedProvider: 'ollama',
        selectedModel: 'llama3.1',
        apiKeys: {},
        autoApprove: { readFiles: true, writeFiles: false, executeCommands: false }
      };
      const permissionManager = new PermissionManager(settings);
      await permissionManager.loadProjectPermissions(root);

      // read_file doğrudan engelleniyor...
      assert.strictEqual(
        permissionManager.isToolBlocked('read_file', { path: 'private/notes.txt' }).blocked,
        true
      );
      // ...arama da aynı kararı uygulamalı.
      const result = await searchFilesTool.execute(
        { query: 'AUDIT_DENIED_CONTENT' },
        { workspaceRoot: root, permissionManager }
      );
      assert.ok(result.includes('public.txt'), 'herkese açık dosya sonuçta olmalı');
      assert.ok(!result.includes('AUDIT_DENIED_CONTENT gizli'), 'deny kapsamındaki içerik sızdı');
      assert.ok(!result.includes('private/notes.txt'), 'deny kapsamındaki dosya yolu sızdı');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('list_directory shows config files and hides noisy directories', async () => {
    await fs.mkdir(path.join(tmpDir, 'node_modules'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, '.github'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.eslintrc'), 'x');
    await fs.writeFile(path.join(tmpDir, 'gorunur.ts'), 'x');

    const output = await listDirectoryTool.execute({ path: '.' }, ctx());
    assert.ok(output.includes('gorunur.ts'));
    assert.ok(output.includes('.eslintrc'));
    assert.ok(output.includes('.github'));
    assert.ok(!output.includes('node_modules'));
  });
});
