import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { resolveCallGraphPanelRequest } from '../../src/webview/callgraphPanel';
import type { CallGraphDocument } from '@ahicode/core/core/callgraph/types';

/** Belirli bir düğüm/kenar kümesiyle küçük bir harita kurar. */
function fakeDocument(): CallGraphDocument {
  return {
    meta: {
      version: 1,
      root: '/w',
      createdAt: 1,
      updatedAt: 2,
      languageServers: [],
      nodeCount: 3,
      edgeCount: 2,
      fileCount: 3,
      incompleteFiles: 1
    },
    nodes: [
      {
        id: 'a.ts#run',
        name: 'run',
        kind: 'function',
        file: 'a.ts',
        startLine: 5,
        endLine: 9,
        exported: true,
        isTest: false
      },
      {
        id: 'b.ts#main',
        name: 'main',
        kind: 'function',
        file: 'b.ts',
        startLine: 3,
        endLine: 7,
        exported: false,
        isTest: false
      },
      {
        id: 'c.test.ts#runTest',
        name: 'runTest',
        kind: 'function',
        file: 'c.test.ts',
        startLine: 1,
        endLine: 4,
        exported: false,
        isTest: true
      }
    ],
    edges: [
      { from: 'b.ts#main', to: 'a.ts#run', lines: [4], confidence: 'exact' },
      { from: 'c.test.ts#runTest', to: 'a.ts#run', lines: [2], confidence: 'exact' }
    ],
    files: {
      'a.ts': { hash: 'h1', status: 'complete', nodeCount: 1, edgeCount: 0, externalCalls: 0, scannedAt: 1 },
      'b.ts': { hash: 'h2', status: 'partial', nodeCount: 1, edgeCount: 1, externalCalls: 0, scannedAt: 1 },
      'c.test.ts': {
        hash: 'h3',
        status: 'complete',
        nodeCount: 1,
        edgeCount: 1,
        externalCalls: 0,
        scannedAt: 1
      }
    }
  };
}

const fakeManager = (doc: CallGraphDocument | undefined) => ({
  ensureReady: async () => ({ ready: Boolean(doc), building: false, message: doc ? 'hazır' : 'harita yok' }),
  getDocument: () => doc,
  rebuild: async () => ({ ready: Boolean(doc), building: false, message: 'yeniden kuruldu' })
});

describe('callgraphPanel: çağrı grafiği ekranı çözücüsü', () => {
  it('çalışma alanı yoksa dürüst mesaj döner', async () => {
    const result = await resolveCallGraphPanelRequest(fakeManager(fakeDocument()), undefined, {
      action: 'status'
    });
    assert.strictEqual(result.ready, false);
    assert.match(result.message, /çalışma alanı/i);
  });

  it('status: düğüm/kenar/dosya sayıları ve eksik tarama sayımı', async () => {
    const result = await resolveCallGraphPanelRequest(fakeManager(fakeDocument()), '/w', {
      action: 'status'
    });
    assert.ok(result.ready);
    assert.strictEqual(result.stats?.nodes, 3);
    assert.strictEqual(result.stats?.edges, 2);
    assert.strictEqual(result.stats?.files, 3);
    assert.strictEqual(result.stats?.incompleteFiles, 1);
  });

  it('search: sorguyu düğüm listesiyle yanıtlar', async () => {
    const result = await resolveCallGraphPanelRequest(fakeManager(fakeDocument()), '/w', {
      action: 'search',
      query: 'main'
    });
    assert.ok(result.matches?.some((node) => node.id === 'b.ts#main'));
  });

  it('neighbors: çağıranlar ve çağrılanlar kademe bilgisiyle döner', async () => {
    const result = await resolveCallGraphPanelRequest(fakeManager(fakeDocument()), '/w', {
      action: 'neighbors',
      nodeId: 'a.ts#run'
    });
    assert.ok(result.callers?.some((node) => node.id === 'b.ts#main' && node.depth === 1));
    assert.strictEqual(result.callees?.length, 0);
  });

  it('bilinmeyen düğüm kimliği hata değil boş komşu üretir', async () => {
    const result = await resolveCallGraphPanelRequest(fakeManager(fakeDocument()), '/w', {
      action: 'neighbors',
      nodeId: 'yok.ts#x'
    });
    assert.match(result.message, /bulunamadı/);
  });

  it('harita yokken arama yapılır ama "hazır değil" denir', async () => {
    const result = await resolveCallGraphPanelRequest(fakeManager(undefined), '/w', {
      action: 'search',
      query: 'run'
    });
    assert.strictEqual(result.ready, false);
    assert.strictEqual(result.matches, undefined);
  });
});
