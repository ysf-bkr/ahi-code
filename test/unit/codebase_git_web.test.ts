import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { KnowledgeStore } from '../../src/core/knowledge/KnowledgeStore';
import { GitManager } from '../../src/core/git/GitManager';
import {
  assertSafeUrl,
  extractDuckDuckGoHtml,
  isPublicHttpUrl,
  looksLikeDuckDuckGoResults,
  readLimitedBody,
  stripHtml
} from '../../src/tools/web';
import { ALL_TOOLS } from '../../src/tools';
import { ToolExecutionContext } from '../../src/tools/base';
import { Readable } from 'node:stream';

const execFileAsync = promisify(execFile);

describe('KnowledgeStore: sembol ve etki analizi', () => {
  let root: string;

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-index-'));
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'src', 'a.ts'),
      'export function hesapla(x: number) { return x * 2; }\n',
      'utf-8'
    );
    await fs.writeFile(
      path.join(root, 'src', 'b.ts'),
      "import { hesapla } from './a';\nexport const sonuc = hesapla(2);\n",
      'utf-8'
    );
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('sembolleri indeksler ve arar', async () => {
    const index = new KnowledgeStore();
    const status = await index.indexWorkspace(root);
    assert.strictEqual(status.fileCount, 2);
    const symbols = index.findSymbols('hesapla');
    assert.ok(symbols.some((symbol) => symbol.name === 'hesapla'));
    assert.ok(symbols.some((symbol) => symbol.file === 'src/a.ts'));
  });

  it('finds dependent files in impact analysis', async () => {
    const index = new KnowledgeStore();
    await index.indexWorkspace(root);
    const impact = index.analyzeImpact('hesapla');
    assert.ok(impact.definitionFiles.includes('src/a.ts'));
    assert.ok(impact.impactedFiles.includes('src/b.ts'));
  });
});

describe('GitManager: dal, commit ve PR metni', () => {
  let repo: string;

  before(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-git-'));
    await execFileAsync('git', ['init', '-q'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: repo });
    await fs.writeFile(path.join(repo, 'README.md'), '# test\n', 'utf-8');
    await execFileAsync('git', ['add', '.'], { cwd: repo });
    await execFileAsync('git', ['commit', '-q', '-m', 'ilk'], { cwd: repo });
  });

  after(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it('creates a branch, commits changes, and generates a PR description', async () => {
    const git = new GitManager();
    assert.strictEqual(await git.isRepository(repo), true);
    await git.createBranch(repo, 'ahi/test');
    await fs.writeFile(path.join(repo, 'yeni.txt'), 'içerik', 'utf-8');
    await git.stage(repo);
    const commit = await git.commit(repo, 'yeni dosya ekle');
    assert.ok(commit.includes('yeni dosya ekle'));

    // Calling commit with no changes should return info without crashing
    const emptyCommit = await git.commit(repo, 'ikinci commit');
    assert.ok(emptyCommit.includes('No changes to commit'));

    const body = await git.preparePrBody(repo, { title: 'Test PR' });
    assert.ok(body.includes('Test PR'));
    assert.ok(body.includes('ahi/test'));
    assert.ok(body.includes('yeni.txt') || body.includes('README.md'));
  });
});

describe('Web tools: URL and HTML safety', () => {
  it('blocks private network and local addresses', () => {
    assert.strictEqual(isPublicHttpUrl('https://example.com'), true);
    assert.strictEqual(isPublicHttpUrl('http://localhost:3000'), false);
    assert.strictEqual(isPublicHttpUrl('http://127.0.0.1'), false);
    assert.strictEqual(isPublicHttpUrl('http://192.168.1.2'), false);
    assert.strictEqual(isPublicHttpUrl('http://2130706433'), false);
    assert.strictEqual(isPublicHttpUrl('http://0x7f000001'), false);
    assert.strictEqual(isPublicHttpUrl('http://[::1]'), false);
    assert.strictEqual(isPublicHttpUrl('file:///etc/passwd'), false);
  });

  it('blocks NAT64, 6to4 and TRIP ranges (SSRF gaps)', () => {
    assert.strictEqual(isPublicHttpUrl('http://[64:ff9b::192.0.2.33]'), false);
    assert.strictEqual(isPublicHttpUrl('http://[64:ff9b:1::]'), false);
    assert.strictEqual(isPublicHttpUrl('http://[2002:7f00:1::]'), false);
    assert.strictEqual(isPublicHttpUrl('http://192.0.0.9'), false);
    assert.strictEqual(isPublicHttpUrl('http://[100::]'), false);
    // Sanity: a normal public IPv6 address stays reachable.
    assert.strictEqual(isPublicHttpUrl('http://[2606:4700:4700::1111]'), true);
  });

  it('DNS/private IP validation rejects unsafe addresses', async () => {
    await assert.rejects(() => assertSafeUrl('http://127.0.0.1'), /blocked|private/i);
    await assert.rejects(() => assertSafeUrl('http://[::1]'), /blocked|private/i);
  });

  it('rejects the response body when the size limit is exceeded', async () => {
    const body = Readable.from([Buffer.alloc(8), Buffer.alloc(8)]);
    await assert.rejects(() => readLimitedBody(body, 10), /exceeded the 10-byte limit/);
  });

  it('strips HTML tags and script content', () => {
    const text = stripHtml(
      '<html><style>x{}</style><script>alert(1)</script><h1>Merhaba</h1><p>Dünya</p></html>'
    );
    assert.ok(text.includes('Merhaba'));
    assert.ok(text.includes('Dünya'));
    assert.ok(!text.includes('alert'));
    assert.ok(!text.includes('<h1>'));
  });

  it('parses DuckDuckGo HTML results', () => {
    const html = `
      <a class="result__a" href="https://example.com/a">Example <b>Title</b></a>
      <a class="result__snippet">Example description</a>
    `;
    const results = extractDuckDuckGoHtml(html);
    assert.strictEqual(results.length, 1);
    const first = results[0];
    assert.ok(first, 'search result not found');
    assert.strictEqual(first.url, 'https://example.com/a');
    assert.ok(first.title.includes('Title'));
    assert.ok(first.text.includes('description'));
  });

  it('reports an unrecognized DuckDuckGo page as a markup change', () => {
    // The parser finds nothing either way; the page-shape check tells a
    // markup change or block page apart from a genuinely empty result set.
    assert.strictEqual(looksLikeDuckDuckGoResults('<html><body>captcha</body></html>'), false);
    assert.strictEqual(looksLikeDuckDuckGoResults('<a class="result__a" href="x">y</a>'), true);
    assert.strictEqual(extractDuckDuckGoHtml('<html><body>captcha</body></html>').length, 0);
  });

  it('reads notebook cells', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-notebook-'));
    try {
      await fs.writeFile(
        path.join(root, 'ornek.ipynb'),
        JSON.stringify({
          cells: [
            { cell_type: 'markdown', source: ['# Başlık'] },
            { cell_type: 'code', source: ['print("merhaba")'] }
          ],
          metadata: {},
          nbformat: 4,
          nbformat_minor: 5
        }),
        'utf-8'
      );

      const context: ToolExecutionContext = { workspaceRoot: root };
      const result = await ALL_TOOLS.read_notebook.execute({ path: 'ornek.ipynb' }, context);
      assert.ok(result.includes('Başlık'));
      assert.ok(result.includes('print'));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('GitManager: status ayrıştırma', () => {
  it('çalışma ağacı durumunu ve dosya adını kırpmadan okur', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-git-status-'));
    try {
      await execFileAsync('git', ['init', '-q'], { cwd: root });
      await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
      await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: root });
      await fs.writeFile(path.join(root, 'a.txt'), 'ilk\n', 'utf-8');
      await execFileAsync('git', ['add', '.'], { cwd: root });
      await execFileAsync('git', ['commit', '-q', '-m', 'ilk'], { cwd: root });

      // Yalnızca çalışma ağacında değişiklik: " M a.txt" (baştaki boşluk anlamlı).
      await fs.writeFile(path.join(root, 'a.txt'), 'değişti\n', 'utf-8');

      const changes = await new GitManager().listChanges(root);
      const change = changes.find((item) => item.path === 'a.txt');
      assert.ok(change, `dosya adı bozulmamalı, bulunan: ${JSON.stringify(changes)}`);
      assert.strictEqual(change.workTreeStatus, 'M');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('GitManager: komut geri alma (checkpoint)', () => {
  async function freshRepo(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-cmd-undo-'));
    await execFileAsync('git', ['init', '-q'], { cwd: dir });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    await fs.writeFile(path.join(dir, 'tracked.txt'), 'ilk içerik\n', 'utf-8');
    await execFileAsync('git', ['add', '-A'], { cwd: dir });
    await execFileAsync('git', ['commit', '-q', '-m', 'initial'], { cwd: dir });
    return dir;
  }

  it('takes a checkpoint in a clean repository', async () => {
    const dir = await freshRepo();
    try {
      const manager = new GitManager();
      const checkpoint = await manager.createCommandCheckpoint(dir);
      assert.ok(checkpoint, 'a checkpoint must exist');
      assert.ok(checkpoint.head.length >= 7);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('skips the checkpoint in a dirty repository (protects user work)', async () => {
    const dir = await freshRepo();
    try {
      await fs.writeFile(path.join(dir, 'tracked.txt'), 'kullanıcı değişikliği\n', 'utf-8');
      const manager = new GitManager();
      assert.strictEqual(await manager.createCommandCheckpoint(dir), undefined);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('reverts files created and modified by a command', async () => {
    const dir = await freshRepo();
    try {
      const manager = new GitManager();
      const checkpoint = await manager.createCommandCheckpoint(dir);
      assert.ok(checkpoint);

      // Simulate a command: modify a tracked file and create new ones.
      await fs.writeFile(path.join(dir, 'tracked.txt'), 'komut değiştirdi\n', 'utf-8');
      await fs.writeFile(path.join(dir, 'generated.ts'), 'export const x = 1;\n', 'utf-8');
      await fs.mkdir(path.join(dir, 'dist'), { recursive: true });
      await fs.writeFile(path.join(dir, 'dist', 'bundle.js'), 'x', 'utf-8');

      const message = await manager.restoreCommandCheckpoint(checkpoint);
      assert.match(message, /reverted/i);

      assert.strictEqual(await fs.readFile(path.join(dir, 'tracked.txt'), 'utf-8'), 'ilk içerik\n');
      await assert.rejects(fs.access(path.join(dir, 'generated.ts')));
      await assert.rejects(fs.access(path.join(dir, 'dist', 'bundle.js')));

      const status = await execFileAsync('git', ['status', '--porcelain'], { cwd: dir });
      assert.strictEqual(status.stdout.trim(), '');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('reverts a commit made by a command', async () => {
    const dir = await freshRepo();
    try {
      const manager = new GitManager();
      const checkpoint = await manager.createCommandCheckpoint(dir);
      assert.ok(checkpoint);

      await fs.writeFile(path.join(dir, 'tracked.txt'), 'yeni\n', 'utf-8');
      await execFileAsync('git', ['add', '-A'], { cwd: dir });
      await execFileAsync('git', ['commit', '-q', '-m', 'komut commit etti'], { cwd: dir });

      await manager.restoreCommandCheckpoint(checkpoint);

      const head = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: dir });
      assert.strictEqual(head.stdout.trim(), checkpoint.head);
      assert.strictEqual(await fs.readFile(path.join(dir, 'tracked.txt'), 'utf-8'), 'ilk içerik\n');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('git deposu olmayan yolda checkpoint almaz', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-nogit-'));
    try {
      const manager = new GitManager();
      assert.strictEqual(await manager.createCommandCheckpoint(dir), undefined);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
