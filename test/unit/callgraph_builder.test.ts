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
} from '../../src/core/callgraph/builder';
import type { CallGraphLanguageService, ReferenceLocation } from '../../src/core/callgraph/languageService';
import type { RawSymbol } from '../../src/core/callgraph/extractor';

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
