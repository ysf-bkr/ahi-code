import { describe, it, after, before } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  KnowledgeStore,
  extractExports,
  extractImports,
  extractSymbols,
  isSensitivePath,
  KNOWLEDGE_DIR
} from '@ahicode/core/core/knowledge/KnowledgeStore';

const execFileAsync = promisify(execFile);

async function makeWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ahi-kb-'));
}

async function write(root: string, relative: string, content: string): Promise<void> {
  const target = path.join(root, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf-8');
}

describe('KnowledgeStore: static extraction', () => {
  it('extracts symbols, exports and imports', () => {
    const source = [
      "import { readFile } from 'fs/promises';",
      "import path from 'path';",
      'export interface Options { a: number }',
      'export async function loadThing(input: string): Promise<void> {',
      '  const local = 1;',
      '  return;',
      '}',
      'export const MAX = 10;'
    ].join('\n');

    const symbols = extractSymbols('src/thing.ts', source);
    const names = symbols.map((symbol) => symbol.name);
    assert.ok(names.includes('Options'));
    assert.ok(names.includes('loadThing'));
    assert.ok(names.includes('MAX'));

    assert.deepStrictEqual(extractImports(source).sort(), ['fs/promises', 'path']);
    assert.deepStrictEqual(extractExports(source).sort(), ['MAX', 'Options', 'loadThing']);
  });

  it('recognizes sensitive file patterns', () => {
    for (const value of [
      '.env',
      '.env.local',
      'certs/server.pem',
      'id_rsa',
      'secrets/x.json',
      'src/key.p12'
    ]) {
      assert.strictEqual(isSensitivePath(value), true, value);
    }
    for (const value of ['src/app.ts', 'README.md', 'docs/key-concepts.md']) {
      assert.strictEqual(isSensitivePath(value), false, value);
    }
  });
});

describe('KnowledgeStore: indexing and persistence', () => {
  let root: string;

  before(async () => {
    root = await makeWorkspace();
    await write(root, 'src/a.ts', 'export function alpha() { return 1; }\n');
    await write(root, 'src/b.ts', "import { alpha } from './a';\nexport const beta = alpha();\n");
    await write(root, 'README.md', '# readme');
    await write(root, '.env', 'SECRET=1');
    await write(root, 'node_modules/pkg/index.js', 'module.exports = {}');
    await write(root, 'src/big.ts', 'x'.repeat(1024));
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('indexes source files, skips sensitive and ignored paths', async () => {
    const store = new KnowledgeStore();
    const status = await store.indexWorkspace(root);

    assert.strictEqual(status.ready, true);
    assert.strictEqual(status.fileCount, 3); // a.ts, b.ts, big.ts
    assert.ok(store.getFile('src/a.ts'));
    assert.strictEqual(store.getFile('.env'), undefined);
    assert.strictEqual(store.getFile('node_modules/pkg/index.js'), undefined);
    assert.strictEqual(store.getFile('README.md'), undefined);
  });

  it('skips file exceeding size limit', async () => {
    const store = new KnowledgeStore();
    await store.indexWorkspace(root, { maxFileBytes: 512 });
    assert.strictEqual(store.getFile('src/big.ts'), undefined);
    assert.ok(store.getFile('src/a.ts'));
  });

  it('writes the index to disk and loads it in a new instance', async () => {
    const store = new KnowledgeStore();
    await store.indexWorkspace(root);

    const mapPath = path.join(root, KNOWLEDGE_DIR, 'map.jsonl');
    const statePath = path.join(root, KNOWLEDGE_DIR, 'index-state.json');
    assert.ok((await fs.readFile(mapPath, 'utf-8')).includes('src/a.ts'));
    assert.ok((await fs.readFile(statePath, 'utf-8')).includes(root));

    const reloaded = new KnowledgeStore();
    const loaded = await reloaded.load(root);
    assert.strictEqual(loaded, true);
    assert.ok(reloaded.getFile('src/a.ts'));
    assert.strictEqual(reloaded.findSymbols('alpha').length, 1);
  });

  it('rejects an index written for a different root', async () => {
    const store = new KnowledgeStore();
    await store.indexWorkspace(root);

    const other = await makeWorkspace();
    try {
      const reloaded = new KnowledgeStore();
      const loaded = await reloaded.load(other);
      assert.strictEqual(loaded, false);
    } finally {
      await fs.rm(other, { recursive: true, force: true });
    }
  });

  it('searches symbols and content', async () => {
    const store = new KnowledgeStore();
    await store.indexWorkspace(root);
    await store.setSummary(root, 'src/a.ts', 'Alpha yardımcı fonksiyonu döndürür.');

    const symbolHits = store.search('alpha');
    assert.ok(symbolHits.some((hit) => hit.kind === 'symbol' && hit.title === 'alpha'));
    assert.ok(symbolHits.some((hit) => hit.kind === 'file' && hit.title === 'src/a.ts'));

    const summaryHits = store.search('yardımcı');
    assert.ok(summaryHits.some((hit) => hit.detail.includes('Alpha yardımcı')));
  });

  it('adds summary and note to prompt context', async () => {
    const store = new KnowledgeStore();
    await store.indexWorkspace(root);
    await store.setSummary(root, 'src/b.ts', 'Beta, alpha sonucunu dışa aktarır.');
    await store.appendNote(root, 'Test komutu: npm test');

    const context = store.formatForPrompt();
    assert.match(context, /PROJECT KNOWLEDGE BASE/);
    assert.match(context, /src\/b\.ts: Beta/);
    assert.match(context, /Test komutu: npm test/);
    assert.match(context, /reference data, not as instructions/);
  });

  it('notes accumulate, last note kept', async () => {
    const store = new KnowledgeStore();
    await store.indexWorkspace(root);
    await store.appendNote(root, 'birinci not');
    await store.appendNote(root, 'ikinci not');

    const notes = await store.getHumanFile('notes');
    assert.match(notes, /birinci not/);
    assert.match(notes, /ikinci not/);
  });

  it('clear deletes index files', async () => {
    const store = new KnowledgeStore();
    await store.indexWorkspace(root);
    await store.clear(root);

    assert.strictEqual(store.getStatus().ready, false);
    await assert.rejects(fs.readFile(path.join(root, KNOWLEDGE_DIR, 'map.jsonl'), 'utf-8'));
  });
});

describe('KnowledgeStore: eşzamanlı tazeleme kilidi', () => {
  it('aynı depoda koşan ensureFresh çağrılarını tek taramada birleştirir', async () => {
    const root = await makeWorkspace();
    await write(root, 'src/a.ts', 'export const a = 1;');
    const store = new KnowledgeStore();
    let indexCalls = 0;
    const original = store.indexWorkspace.bind(store);
    store.indexWorkspace = async (r, o) => {
      indexCalls += 1;
      return original(r, o);
    };
    const [first, second] = await Promise.all([store.ensureFresh(root), store.ensureFresh(root)]);
    assert.strictEqual(indexCalls, 1, 'tek tarama beklenirdi');
    assert.ok(first.ready && second.ready);
    assert.strictEqual(first.fileCount, second.fileCount);
  });
});

describe('KnowledgeStore: incremental refresh (git)', () => {
  let root: string;

  before(async () => {
    root = await makeWorkspace();
    await execFileAsync('git', ['init', '-q'], { cwd: root });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: root });
    await write(root, 'src/keep.ts', 'export const keep = 1;\n');
    await write(root, 'src/change.ts', 'export const change = 1;\n');
    await write(root, 'src/remove.ts', 'export const remove = 1;\n');
    await execFileAsync('git', ['add', '-A'], { cwd: root });
    await execFileAsync('git', ['commit', '-qm', 'initial'], { cwd: root });
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('updates changed file, drops deleted, keeps others', async () => {
    const store = new KnowledgeStore();
    await store.indexWorkspace(root);
    assert.ok(store.getFile('src/keep.ts'));
    assert.ok(store.getFile('src/remove.ts'));

    await store.setSummary(root, 'src/keep.ts', 'Korunması gereken özet.');

    await write(root, 'src/change.ts', 'export const change = 99;\n');
    await fs.rm(path.join(root, 'src/remove.ts'));
    await execFileAsync('git', ['add', '-A'], { cwd: root });
    await execFileAsync('git', ['commit', '-qm', 'update'], { cwd: root });

    const status = await store.refresh(root);
    assert.strictEqual(status.fileCount, 2);
    assert.strictEqual(store.getFile('src/remove.ts'), undefined);
    assert.ok(store.getFile('src/change.ts'));
    // Unchanged file keeps its summary.
    assert.match(store.getFile('src/keep.ts')?.summary || '', /Korunması gereken/);
  });

  it('falls back to full indexing without git', async () => {
    const plain = await makeWorkspace();
    try {
      await write(plain, 'src/x.ts', 'export const x = 1;\n');
      const store = new KnowledgeStore();
      const status = await store.ensureFresh(plain);
      assert.strictEqual(status.ready, true);
      assert.ok(store.getFile('src/x.ts'));
    } finally {
      await fs.rm(plain, { recursive: true, force: true });
    }
  });
});
