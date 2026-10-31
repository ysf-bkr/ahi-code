import { describe, it, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import {
  CALLGRAPH_FILENAME,
  CALLGRAPH_VERSION,
  callGraphPath,
  deleteCallGraph,
  emptyDocument,
  loadCallGraph,
  saveCallGraph
} from '@ahicode/core/core/callgraph/store';
import { hashContent } from '@ahicode/core/core/callgraph/builder';

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-cg-store-'));
  roots.push(root);
  return root;
}

// Temizlik iki suite'in de dışında: `after` bir `describe` içinde tanımlanınca
// yalnızca o suite bitince çalışıyor, ikinci suite'in kökü sızıyordu.
after(async () => {
  await Promise.all(roots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('callgraph store: atomik kalıcılık', () => {
  it('yazar, okur ve sayaçları günceller', async () => {
    const root = await makeRoot();
    const document = emptyDocument(root);
    document.nodes.push({
      id: 'src/a.ts#foo',
      name: 'foo',
      kind: 'function',
      file: 'src/a.ts',
      startLine: 1,
      endLine: 3,
      exported: true,
      isTest: false
    });
    document.files['src/a.ts'] = {
      hash: hashContent('x'),
      status: 'complete',
      nodeCount: 1,
      edgeCount: 0,
      externalCalls: 0,
      scannedAt: Date.now()
    };

    await saveCallGraph(root, document);
    const loaded = await loadCallGraph(root);

    assert.ok(loaded);
    assert.strictEqual(loaded.meta.nodeCount, 1);
    assert.strictEqual(loaded.meta.fileCount, 1);
    assert.strictEqual(loaded.meta.version, CALLGRAPH_VERSION);
    assert.strictEqual(loaded.nodes[0]?.id, 'src/a.ts#foo');
  });

  it('geçici dosya bırakmaz', async () => {
    const root = await makeRoot();
    await saveCallGraph(root, emptyDocument(root));
    const entries = await fs.readdir(path.join(root, '.ahi'));
    assert.deepStrictEqual(entries, [CALLGRAPH_FILENAME]);
  });

  it('bozuk JSON sessizce yok sayılır', async () => {
    const root = await makeRoot();
    await fs.mkdir(path.join(root, '.ahi'), { recursive: true });
    await fs.writeFile(callGraphPath(root), '{ bu bozuk json', 'utf-8');
    assert.strictEqual(await loadCallGraph(root), undefined);
  });

  it('sürüm uyumsuz kayıt yok sayılır', async () => {
    const root = await makeRoot();
    const document = emptyDocument(root);
    document.meta.version = CALLGRAPH_VERSION + 1;
    await saveCallGraph(root, document);
    // saveCallGraph sürümü korur; okuma uyumsuz sürümü reddetmeli.
    assert.strictEqual(await loadCallGraph(root), undefined);
  });

  it('eksik alanlı kayıt harita sayılmaz', async () => {
    const root = await makeRoot();
    await fs.mkdir(path.join(root, '.ahi'), { recursive: true });
    await fs.writeFile(callGraphPath(root), JSON.stringify({ meta: { version: 1 } }), 'utf-8');
    assert.strictEqual(await loadCallGraph(root), undefined);
  });

  it('silme hem haritayı hem geçici dosyayı kaldırır', async () => {
    const root = await makeRoot();
    await saveCallGraph(root, emptyDocument(root));
    await deleteCallGraph(root);
    assert.strictEqual(await loadCallGraph(root), undefined);
  });

  it('dosya yoksa undefined döner', async () => {
    const root = await makeRoot();
    assert.strictEqual(await loadCallGraph(root), undefined);
  });
});

describe('callgraph store: eşzamanlı yazma', () => {
  it('paralel yazımlar birbirini ezmez ve geçici dosya bırakmaz', async () => {
    const root = await makeRoot();
    const first = emptyDocument(root);
    const second = emptyDocument(root);
    second.nodes.push({
      id: 'src/z.ts#zed',
      name: 'zed',
      kind: 'function',
      file: 'src/z.ts',
      startLine: 1,
      endLine: 1,
      exported: true,
      isTest: false
    });

    await Promise.all([saveCallGraph(root, first), saveCallGraph(root, second), saveCallGraph(root, first)]);

    const loaded = await loadCallGraph(root);
    assert.ok(loaded, 'harita okunabilmeli');
    // Yazımlar sıralı işlendiği için dosya her zaman geçerli JSON olmalı.
    const entries = await fs.readdir(path.join(root, '.ahi'));
    const tempFiles = entries.filter((entry) => entry.includes('.tmp'));
    assert.deepStrictEqual(tempFiles, []);
  });
});
