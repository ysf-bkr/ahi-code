import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { extractSymbols, KnowledgeStore, KNOWLEDGE_DIR } from '../../src/core/knowledge/KnowledgeStore';
import { ALL_TOOLS } from '../../src/tools';
import { validateToolArguments } from '../../src/tools/base';

describe('KnowledgeStore: symbol ranges and repo map', () => {
  let root: string;

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-map-'));
    await fs.mkdir(path.join(root, 'src', 'core'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'src', 'core', 'sample.ts'),
      [
        'export function alpha(): void {',
        '  // body',
        '}',
        '',
        'export class Beta {',
        '  run(): void {}',
        '}',
        '',
        'export const gamma = 1;'
      ].join('\n'),
      'utf-8'
    );
    await fs.writeFile(
      path.join(root, 'src', 'util.ts'),
      ['export function helper(): number {', '  return 1;', '}'].join('\n'),
      'utf-8'
    );
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('extractSymbols calculates symbol end lines', () => {
    const symbols = extractSymbols(
      'src/core/sample.ts',
      [
        'export function alpha(): void {',
        '  // body',
        '}',
        '',
        'export class Beta {',
        '  run(): void {}',
        '}',
        '',
        'export const gamma = 1;'
      ].join('\n')
    );
    assert.strictEqual(symbols.length, 3);
    const [alpha, beta, gamma] = symbols;
    assert.ok(alpha && beta && gamma, 'symbols not found');
    // alpha ends right before Beta starts; gamma extends to EOF.
    assert.strictEqual(alpha.endLine, beta.line - 1);
    assert.strictEqual(gamma.endLine, 9);
    assert.ok((gamma.endLine ?? 0) >= gamma.line);
  });

  it('mergeSymbols replaces regex symbols with LSP ranges', async () => {
    const store = new KnowledgeStore();
    await store.indexWorkspace(root);
    const before = store.findSymbols('Beta');
    assert.ok(before.length > 0, 'regex symbol not found');

    store.mergeSymbols('src/core/sample.ts', [
      { name: 'Beta', kind: 'class', line: 5, endLine: 7 },
      { name: 'run', kind: 'method', line: 6, endLine: 6 }
    ]);

    const after = store.findSymbols('Beta');
    assert.strictEqual(after.length, 1);
    assert.strictEqual(after[0]?.endLine, 7);
    // Other files are untouched.
    assert.ok(store.findSymbols('helper').length > 0);
    // The merged method symbol is present with its precise range.
    const run = store.findSymbols('run');
    assert.strictEqual(run[0]?.kind, 'method');
    assert.strictEqual(run[0]?.endLine, 6);
  });

  it('formatForPrompt includes repo map one line per file', async () => {
    const store = new KnowledgeStore();
    await store.indexWorkspace(root);
    await store.setSummary(root, 'src/core/sample.ts', 'Örnek modül. Alpha ve Beta içerir.');

    const prompt = store.formatForPrompt();
    assert.match(prompt, /=== REPO MAP/);
    assert.match(prompt, /src\/core\//);
    assert.match(prompt, /sample\.ts/);
    assert.match(prompt, /exports: alpha/);
    // The summary's first sentence appears as the one-liner.
    assert.match(prompt, /Örnek modül/);
    assert.match(prompt, /util\.ts/);
  });

  it('writeHumanFile writes, validates and persists the project file', async () => {
    const store = new KnowledgeStore();
    await store.indexWorkspace(root);

    await assert.rejects(() => store.writeHumanFile(root, 'project', 'çok kısa'), /too short/i);

    const written = await store.writeHumanFile(
      root,
      'project',
      '# Proje\n\nAhiCode: VS Code için Türkçe kodlama ajanı.'
    );
    assert.strictEqual(written, 'project.md');

    const onDisk = await fs.readFile(path.join(root, KNOWLEDGE_DIR, 'project.md'), 'utf-8');
    assert.match(onDisk, /AhiCode/);

    // Reloaded store sees the file, and the onboarding nudge turns off.
    const reloaded = new KnowledgeStore();
    await reloaded.load(root);
    assert.strictEqual(reloaded.needsOnboardingDraft(), false);
    assert.match(reloaded.formatForPrompt(), /=== PROJECT ===/);
    assert.strictEqual(store.needsOnboardingDraft(), false);
  });

  it('indexedFiles returns a list limited by the extension filter', async () => {
    const store = new KnowledgeStore();
    await store.indexWorkspace(root);
    const tsFiles = store.indexedFiles(new Set(['.ts']), 10);
    assert.ok(tsFiles.includes('src/core/sample.ts'));
    assert.ok(tsFiles.includes('src/util.ts'));
    assert.strictEqual(store.indexedFiles(new Set(['.py']), 10).length, 0);
  });

  it('semanticCorpus returns summaries and human files with keys', async () => {
    const store = new KnowledgeStore();
    await store.indexWorkspace(root);
    await store.setSummary(root, 'src/util.ts', 'Yardımcı fonksiyonlar.');
    await store.appendNote(root, 'test notu');

    const corpus = store.semanticCorpus();
    const keys = corpus.map((entry) => entry.key);
    assert.ok(keys.includes('file:src/util.ts'));
    assert.ok(keys.includes('human:notes'));
    assert.ok(!keys.includes('file:src/core/sample.ts'), 'file without summary should not be included');
  });
});

describe('Tools: find_symbol ranges and write_knowledge_file', () => {
  let root: string;

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-maptools-'));
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'src', 'app.ts'),
      ['export function main(): void {', '  work();', '}', '', 'function work(): void {}'].join('\n'),
      'utf-8'
    );
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('find_symbol returns line ranges', async () => {
    const store = new KnowledgeStore();
    await store.indexWorkspace(root);
    const output = await ALL_TOOLS.find_symbol.execute({ query: 'main' }, { knowledgeStore: store });
    assert.match(output, /main — src\/app\.ts:1-4/);
    assert.match(output, /read_file offset\/limit/);
  });

  it('write_knowledge_file writes content after approval flow', async () => {
    const store = new KnowledgeStore();
    await store.indexWorkspace(root);
    const output = await ALL_TOOLS.write_knowledge_file.execute(
      { file: 'decisions', content: '# Kararlar\n\n- Test çerçevesi node:test kullanılacak.' },
      { knowledgeStore: store, workspaceRoot: root }
    );
    assert.match(output, /decisions\.md/);
    const onDisk = await fs.readFile(path.join(root, KNOWLEDGE_DIR, 'decisions.md'), 'utf-8');
    assert.match(onDisk, /node:test/);
  });

  it('write_knowledge_file rejects invalid file name in schema', () => {
    const error = validateToolArguments(ALL_TOOLS.write_knowledge_file, {
      file: 'notes',
      content: 'x'.repeat(30)
    });
    assert.match(error || '', /Invalid value for 'file'/);
  });
});
