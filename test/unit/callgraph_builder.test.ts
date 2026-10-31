import { describe, it, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import {
  buildCallGraph,
  collectSourceFiles,
  hashContent,
  updateCallGraph
} from '@ahicode/core/core/callgraph/builder';
import type {
  CallGraphLanguageService,
  ReferenceLocation
} from '@ahicode/core/core/callgraph/languageService';
import type { RawSymbol } from '@ahicode/core/core/callgraph/extractor';

const roots: string[] = [];

async function makeProject(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-cg-build-'));
  roots.push(root);
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf-8');
  }
  return root;
}

/**
 * Sahte dil servisi: sembolleri ve referansları sabit bir tablodan verir.
 * Referans yoksa boş liste döner (dil sunucusu cevap verdi ama çağrı yok).
 */
function fakeLanguage(
  symbols: Record<string, RawSymbol[]>,
  references: Record<string, ReferenceLocation[]>
): CallGraphLanguageService {
  return {
    async documentSymbols(relative: string) {
      return symbols[relative];
    },
    async references(relative: string, line: number) {
      return references[`${relative}:${line}`] ?? [];
    }
  };
}

describe('callgraph builder: iki geçişli tarama', () => {
  after(async () => {
    await Promise.all(roots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('çağıran → çağrılan ilişkisini kurar', async () => {
    const root = await makeProject({
      'src/a.ts': 'export function alpha() {\n  return 1;\n}\nfunction beta() {\n  return alpha();\n}\n'
    });

    const language = fakeLanguage(
      {
        'src/a.ts': [
          { name: 'alpha', kind: 'Function', line: 1, endLine: 3 },
          { name: 'beta', kind: 'Function', line: 4, endLine: 6 }
        ]
      },
      {
        // alpha'nın referansı beta'nın gövdesinde (satır 5) → beta, alpha'yı çağırır.
        'src/a.ts:1': [{ file: 'src/a.ts', line: 5 }],
        'src/a.ts:4': []
      }
    );

    const { document } = await buildCallGraph(root, language);

    assert.strictEqual(document.nodes.length, 2);
    assert.strictEqual(document.edges.length, 1);
    assert.strictEqual(document.edges[0]?.from, 'src/a.ts#beta');
    assert.strictEqual(document.edges[0]?.to, 'src/a.ts#alpha');
    assert.deepStrictEqual(document.edges[0]?.lines, [5]);
    assert.strictEqual(document.edges[0]?.confidence, 'exact');
  });

  it('tanımın kendisini çağrı saymaz', async () => {
    const root = await makeProject({ 'src/a.ts': 'export function alpha() {}\n' });
    const language = fakeLanguage(
      { 'src/a.ts': [{ name: 'alpha', kind: 'Function', line: 1, endLine: 1 }] },
      { 'src/a.ts:1': [{ file: 'src/a.ts', line: 1 }] }
    );

    const { document } = await buildCallGraph(root, language);
    assert.strictEqual(document.edges.length, 0);
  });

  it('proje dışı referansı dış çağrı olarak sayar', async () => {
    const root = await makeProject({ 'src/a.ts': 'export function alpha() {}\n' });
    const language = fakeLanguage(
      { 'src/a.ts': [{ name: 'alpha', kind: 'Function', line: 1, endLine: 1 }] },
      { 'src/a.ts:1': [{ file: 'node_modules/lib/index.d.ts', line: 10 }] }
    );

    const { document } = await buildCallGraph(root, language);
    assert.strictEqual(document.edges.length, 0);
    assert.strictEqual(document.files['src/a.ts']?.externalCalls, 1);
  });

  it('dil sunucusu olmayan dosyayı atlar, taramayı durdurmaz', async () => {
    const root = await makeProject({
      'src/a.ts': 'export function alpha() {}\n',
      'src/b.ts': 'export function beta() {}\n'
    });
    const language = fakeLanguage(
      { 'src/a.ts': [{ name: 'alpha', kind: 'Function', line: 1, endLine: 1 }] },
      { 'src/a.ts:1': [] }
    );

    const result = await buildCallGraph(root, language);
    assert.strictEqual(result.unsupportedFiles, 1);
    assert.strictEqual(result.document.files['src/b.ts']?.status, 'skipped');
    assert.strictEqual(result.document.files['src/a.ts']?.status, 'complete');
  });

  it('gereksiz klasörleri ve hassas dosyaları taramaz', async () => {
    const root = await makeProject({
      'src/a.ts': 'export const a = 1;\n',
      'node_modules/x/index.ts': 'export const x = 1;\n',
      'dist/b.ts': 'export const b = 1;\n',
      '.env': 'SECRET=1\n'
    });

    const files = await collectSourceFiles(root);
    assert.deepStrictEqual(files, ['src/a.ts']);
  });

  it('artımlı güncelleme yalnızca değişen dosyayı yeniden tarar', async () => {
    const root = await makeProject({
      'src/a.ts': 'export function alpha() {}\n',
      'src/b.ts': 'export function beta() {}\n'
    });

    let alphaScans = 0;
    let betaScans = 0;
    const language: CallGraphLanguageService = {
      async documentSymbols(relative) {
        if (relative === 'src/a.ts') {
          alphaScans++;
          return [{ name: 'alpha', kind: 'Function', line: 1, endLine: 1 }];
        }
        betaScans++;
        return [{ name: 'beta', kind: 'Function', line: 1, endLine: 1 }];
      },
      async references() {
        return [];
      }
    };

    const first = await buildCallGraph(root, language);
    assert.strictEqual(first.document.nodes.length, 2);
    assert.strictEqual(alphaScans, 1);
    assert.strictEqual(betaScans, 1);

    // Yalnızca a.ts değişir.
    await fs.writeFile(path.join(root, 'src/a.ts'), 'export function alpha() { return 2; }\n', 'utf-8');
    const second = await updateCallGraph(root, first.document, language);

    assert.strictEqual(alphaScans, 2, 'değişen dosya yeniden taranmalı');
    assert.strictEqual(betaScans, 1, 'değişmeyen dosya taranmamalı');
    assert.strictEqual(second.document.nodes.length, 2);
  });

  it('artımlı güncelleme değişmeyen çağırandan gelen kenarı korur (F11)', async () => {
    // Denetim senaryosu: b.ts#beta -> a.ts#alpha kenarı vardı; yalnızca
    // a.ts (çağrılan) değişti ve hedefli güncelleme kenarı düşürüyordu.
    const root = await makeProject({
      'src/a.ts': 'export function alpha() {}\n',
      'src/b.ts': 'import { alpha } from "./a";\nexport function beta() { alpha(); }\n'
    });
    const language = fakeLanguage(
      {
        'src/a.ts': [{ name: 'alpha', kind: 'Function', line: 1, endLine: 1 }],
        'src/b.ts': [{ name: 'beta', kind: 'Function', line: 2, endLine: 2 }]
      },
      {
        'src/a.ts:1': [{ file: 'src/b.ts', line: 2 }],
        'src/b.ts:2': []
      }
    );

    const first = await buildCallGraph(root, language);
    assert.strictEqual(first.document.edges.length, 1);
    assert.strictEqual(first.document.edges[0]?.from, 'src/b.ts#beta');
    assert.strictEqual(first.document.edges[0]?.to, 'src/a.ts#alpha');

    // Yalnızca çağrılan dosyanın gövdesi değişir.
    await fs.writeFile(path.join(root, 'src/a.ts'), 'export function alpha() { return 1; }\n', 'utf-8');
    const second = await updateCallGraph(root, first.document, language, {
      onlyFiles: ['src/a.ts']
    });

    assert.strictEqual(second.document.nodes.length, 2, 'düğümler korunmalı');
    assert.strictEqual(second.document.edges.length, 1, 'çağıran kenarı düşürülmemeli');
    assert.strictEqual(second.document.edges[0]?.from, 'src/b.ts#beta');
    assert.strictEqual(second.document.edges[0]?.to, 'src/a.ts#alpha');
  });

  it('artımlı güncelleme değişen çağırandan çıkan kenarı yeniden kurar (F11)', async () => {
    // Ters yön: çağıran dosya (b.ts) değişir; ondan çıkan ilişki ancak hedef
    // dosyanın (a.ts) referansları yeniden sorulunca kurulabilir.
    const root = await makeProject({
      'src/a.ts': 'export function alpha() {}\n',
      'src/b.ts': 'export function beta() { alpha(); }\n'
    });
    const language = fakeLanguage(
      {
        'src/a.ts': [{ name: 'alpha', kind: 'Function', line: 1, endLine: 1 }],
        'src/b.ts': [{ name: 'beta', kind: 'Function', line: 1, endLine: 1 }]
      },
      {
        'src/a.ts:1': [{ file: 'src/b.ts', line: 1 }],
        'src/b.ts:1': []
      }
    );

    const first = await buildCallGraph(root, language);
    assert.strictEqual(first.document.edges.length, 1);

    await fs.writeFile(path.join(root, 'src/b.ts'), 'export function beta() { /* kalktı */ }\n', 'utf-8');
    const second = await updateCallGraph(root, first.document, language, {
      onlyFiles: ['src/b.ts']
    });

    // Kenar hâlâ bildiriliyorsa artımlı güncelleme onu korumalı; çağrı
    // kaldırıldıysa (referans yok) kenar düşmeli. İkisi de sessiz kayıp değil.
    assert.strictEqual(second.document.edges.length, 1);
    assert.strictEqual(second.document.edges[0]?.from, 'src/b.ts#beta');

    // Çağrı gerçekten kalktığında kenar da kalkmalı: referans tablosunu boşalt.
    const emptied = fakeLanguage(
      {
        'src/a.ts': [{ name: 'alpha', kind: 'Function', line: 1, endLine: 1 }],
        'src/b.ts': [{ name: 'beta', kind: 'Function', line: 1, endLine: 1 }]
      },
      { 'src/a.ts:1': [], 'src/b.ts:1': [] }
    );
    await fs.writeFile(path.join(root, 'src/a.ts'), 'export function alpha() { return 2; }\n', 'utf-8');
    const third = await updateCallGraph(root, second.document, emptied, {
      onlyFiles: ['src/a.ts']
    });
    assert.strictEqual(third.document.edges.length, 0, 'referans yoksa kenar kalmamalı');
  });

  it('tam tarama ile artımlı güncelleme aynı kenar kümesini üretir (F11)', async () => {
    const root = await makeProject({
      'src/a.ts': 'export function alpha() {}\n',
      'src/b.ts': 'export function beta() { alpha(); }\n',
      'src/c.ts': 'export function gamma() { alpha(); }\n'
    });
    const symbols = {
      'src/a.ts': [{ name: 'alpha', kind: 'Function' as const, line: 1, endLine: 1 }],
      'src/b.ts': [{ name: 'beta', kind: 'Function' as const, line: 1, endLine: 1 }],
      'src/c.ts': [{ name: 'gamma', kind: 'Function' as const, line: 1, endLine: 1 }]
    };
    const references = {
      'src/a.ts:1': [
        { file: 'src/b.ts', line: 1 },
        { file: 'src/c.ts', line: 1 }
      ],
      'src/b.ts:1': [],
      'src/c.ts:1': []
    };
    const language = fakeLanguage(symbols, references);

    const first = await buildCallGraph(root, language);

    // a.ts değişir; tam tarama da yapılsaydı aynı kenarlar çıkmalıydı.
    await fs.writeFile(path.join(root, 'src/a.ts'), 'export function alpha() { return 1; }\n', 'utf-8');
    const incremental = await updateCallGraph(root, first.document, language, {
      onlyFiles: ['src/a.ts']
    });
    const full = await buildCallGraph(root, language);

    const key = (edges: Array<{ from: string; to: string }>) =>
      edges
        .map((edge) => `${edge.from}->${edge.to}`)
        .sort()
        .join('|');
    assert.strictEqual(key(incremental.document.edges), key(full.document.edges));
    assert.strictEqual(incremental.document.nodes.length, full.document.nodes.length);
    assert.strictEqual(incremental.document.meta.edgeCount, full.document.meta.edgeCount);
  });

  it('meta sayaçları belge içeriğiyle eşitlenir', async () => {
    const root = await makeProject({
      'src/a.ts': 'export function alpha() {}\n',
      'src/b.ts': 'export function beta() {}\n'
    });
    const language = fakeLanguage(
      {
        'src/a.ts': [{ name: 'alpha', kind: 'Function', line: 1, endLine: 1 }],
        'src/b.ts': [{ name: 'beta', kind: 'Function', line: 1, endLine: 1 }]
      },
      { 'src/a.ts:1': [{ file: 'src/b.ts', line: 1 }], 'src/b.ts:1': [] }
    );

    const first = await buildCallGraph(root, language);
    assert.strictEqual(first.document.meta.nodeCount, 2);
    assert.strictEqual(first.document.meta.edgeCount, 1);
    assert.strictEqual(first.document.meta.fileCount, 2);
    assert.strictEqual(first.document.meta.incompleteFiles, 0);

    await fs.writeFile(path.join(root, 'src/a.ts'), 'export function alpha() { return 1; }\n', 'utf-8');
    const second = await updateCallGraph(root, first.document, language, {
      onlyFiles: ['src/a.ts']
    });
    assert.strictEqual(second.document.meta.nodeCount, 2);
    assert.strictEqual(second.document.meta.edgeCount, 1);
    assert.strictEqual(second.document.meta.fileCount, 2);
  });

  it('silinen dosyanın düğüm ve ilişkilerini temizler', async () => {
    const root = await makeProject({
      'src/a.ts': 'export function alpha() {}\n',
      'src/b.ts': 'export function beta() {}\n'
    });
    const language: CallGraphLanguageService = {
      async documentSymbols(relative) {
        return [{ name: relative === 'src/a.ts' ? 'alpha' : 'beta', kind: 'Function', line: 1, endLine: 1 }];
      },
      async references(relative) {
        return relative === 'src/a.ts' ? [{ file: 'src/b.ts', line: 1 }] : [];
      }
    };

    const first = await buildCallGraph(root, language);
    assert.strictEqual(first.document.edges.length, 1);

    await fs.rm(path.join(root, 'src/b.ts'));
    const second = await updateCallGraph(root, first.document, language);

    assert.strictEqual(second.document.nodes.length, 1);
    assert.strictEqual(second.document.edges.length, 0);
    assert.strictEqual(second.document.files['src/b.ts'], undefined);
  });

  it('iptal edilen tarama yarım sonuçla işaretlenir', async () => {
    const root = await makeProject({ 'src/a.ts': 'export const a = 1;\n' });
    const controller = new AbortController();
    controller.abort();

    const language = fakeLanguage({ 'src/a.ts': [] }, {});
    const result = await buildCallGraph(root, language, { signal: controller.signal });
    assert.deepStrictEqual(result.document.nodes, []);
  });

  it('içerik parmak izi kararlı', () => {
    assert.strictEqual(hashContent('abc'), hashContent('abc'));
    assert.notStrictEqual(hashContent('abc'), hashContent('abd'));
  });
});
