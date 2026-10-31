import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  analyzeCallGraphImpact,
  clampDepth,
  findCallees,
  findCallers,
  limitNeighbors,
  resolveNodes,
  suggestNodes,
  testNodes
} from '@ahicode/core/core/callgraph/query';
import type { CallGraphDocument, CallGraphNode } from '@ahicode/core/core/callgraph/types';

function node(id: string, overrides: Partial<CallGraphNode> = {}): CallGraphNode {
  const [file, name] = id.split('#');
  return {
    id,
    name: name ?? id,
    kind: 'function',
    file: file ?? 'src/a.ts',
    startLine: 1,
    endLine: 3,
    exported: false,
    isTest: false,
    ...overrides
  };
}

function doc(
  nodes: CallGraphNode[],
  edges: Array<[string, string, number]>,
  meta: Partial<CallGraphDocument['meta']> = {}
): CallGraphDocument {
  return {
    meta: {
      version: 1,
      root: '/tmp/x',
      createdAt: 1,
      updatedAt: 1,
      languageServers: [],
      nodeCount: nodes.length,
      edgeCount: edges.length,
      fileCount: 1,
      incompleteFiles: 0,
      ...meta
    },
    nodes,
    edges: edges.map(([from, to, line]) => ({
      from,
      to,
      lines: [line],
      confidence: 'exact' as const
    })),
    files: {}
  };
}

// A → B → C zinciri ve döngü: D → E → D
const chain = doc(
  [
    node('src/a.ts#A'),
    node('src/b.ts#B'),
    node('src/c.ts#C'),
    node('src/d.ts#D'),
    node('src/e.ts#E'),
    node('test/a.test.ts#testA', { isTest: true })
  ],
  [
    ['src/a.ts#A', 'src/b.ts#B', 5],
    ['src/b.ts#B', 'src/c.ts#C', 7],
    ['src/d.ts#D', 'src/e.ts#E', 2],
    ['src/e.ts#E', 'src/d.ts#D', 3],
    ['test/a.test.ts#testA', 'src/a.ts#A', 4]
  ]
);

describe('callgraph query: gezinme ve etki analizi', () => {
  it('derinlik sınırına uyar', () => {
    const depth1 = findCallers(chain, ['src/b.ts#B'], 1);
    assert.deepStrictEqual(
      depth1.map((neighbor) => neighbor.node.id),
      ['src/a.ts#A']
    );

    const depth2 = findCallers(chain, ['src/b.ts#B'], 2);
    assert.deepStrictEqual(depth2.map((neighbor) => neighbor.node.id).sort(), [
      'src/a.ts#A',
      'test/a.test.ts#testA'
    ]);
  });

  it('çağrılanları ters yönde bulur', () => {
    const callees = findCallees(chain, ['src/a.ts#A'], 2);
    assert.deepStrictEqual(
      callees.map((neighbor) => neighbor.node.id),
      ['src/b.ts#B', 'src/c.ts#C']
    );
    assert.deepStrictEqual(
      callees.map((neighbor) => neighbor.depth),
      [1, 2]
    );
  });

  it('döngüde sonsuza gitmez', () => {
    const callers = findCallers(chain, ['src/d.ts#D'], 5);
    // D'nin çağıranı E; E'nin çağıranı D ama D başlangıçta ziyaret edildi.
    assert.deepStrictEqual(
      callers.map((neighbor) => neighbor.node.id),
      ['src/e.ts#E']
    );
  });

  it('kimlik, ad ve dosya#ad biçimini çözer', () => {
    assert.strictEqual(resolveNodes(chain, 'src/b.ts#B').length, 1);
    assert.strictEqual(resolveNodes(chain, 'C').length, 1);
    assert.strictEqual(resolveNodes(chain, 'yok').length, 0);
  });

  it('bilinmeyen sembol için benzer ad önerir', () => {
    assert.deepStrictEqual(
      suggestNodes(chain, 'b').map((item) => item.name),
      ['B']
    );
  });

  it('etki analizi doğrudan/dolaylı ve testleri ayırır', () => {
    const impact = analyzeCallGraphImpact(chain, ['src/b.ts#B'], 3);
    assert.deepStrictEqual(
      impact.directCallers.map((item) => item.node.id),
      ['src/a.ts#A']
    );
    assert.deepStrictEqual(
      impact.affectedTests.map((item) => item.node.id),
      ['test/a.test.ts#testA']
    );
    assert.ok(impact.affectedFiles.includes('src/a.ts'));
    assert.ok(impact.affectedFiles.includes('src/b.ts'));
    assert.ok(impact.affectedFiles.includes('test/a.test.ts'));
  });

  it('eksik tarama uyarı üretir', () => {
    const incomplete = doc([node('src/a.ts#A')], [], { incompleteFiles: 2 });
    const impact = analyzeCallGraphImpact(incomplete, ['src/a.ts#A'], 1);
    assert.ok(impact.warnings.some((warning) => warning.includes('eksik tarandı')));
  });

  it('dışa aktarılan ve çağıranı olmayan sembolde uyarır', () => {
    const exported = doc([node('src/a.ts#A', { exported: true })], []);
    const impact = analyzeCallGraphImpact(exported, ['src/a.ts#A'], 1);
    assert.strictEqual(impact.exportedChange, true);
    assert.ok(impact.warnings.some((warning) => warning.includes('Dışa aktarılan')));
  });

  it('geniş etki alanını özetler', () => {
    const nodes = [node('src/target.ts#T')];
    const edges: Array<[string, string, number]> = [];
    for (let i = 0; i < 60; i++) {
      nodes.push(node(`src/c${i}.ts#caller${i}`));
      edges.push([`src/c${i}.ts#caller${i}`, 'src/target.ts#T', i + 1]);
    }
    const impact = analyzeCallGraphImpact(doc(nodes, edges), ['src/target.ts#T'], 1);
    assert.strictEqual(impact.directCallers.length, 60);
    assert.ok(impact.warnings.some((warning) => warning.includes('geniş')));
  });

  it('derinliği normalize eder; 0 ve negatif sınırsız demektir', () => {
    assert.strictEqual(clampDepth(undefined), 1);
    assert.strictEqual(clampDepth(3), 3);
    // Yapay üst sınır yok: verilen derinlik korunur.
    assert.strictEqual(clampDepth(99), 99);
    // 0 / negatif: tüm grafik gezilir.
    assert.strictEqual(clampDepth(0), Number.MAX_SAFE_INTEGER);
    assert.strictEqual(clampDepth(-5), Number.MAX_SAFE_INTEGER);
  });

  it('komşuları sınırlar ve kırpılan sayıyı bildirir', () => {
    const impact = analyzeCallGraphImpact(chain, ['src/b.ts#B'], 3);
    const limited = limitNeighbors(impact.directCallers, 0);
    assert.strictEqual(limited.items.length, 0);
    assert.strictEqual(limited.omitted, 1);
  });

  it('test düğümlerini listeler', () => {
    assert.deepStrictEqual(
      testNodes(chain).map((item) => item.id),
      ['test/a.test.ts#testA']
    );
  });
});
