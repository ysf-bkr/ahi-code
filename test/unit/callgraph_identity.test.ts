import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  isSensitivePath,
  isSupportedSource,
  isTestFile,
  nodeId
} from '@ahicode/core/core/callgraph/identity';
import {
  buildFileNodes,
  enclosingNode,
  looksExported,
  toNodeKind
} from '@ahicode/core/core/callgraph/extractor';

describe('callgraph identity: kararlı kimlik ve yol kuralları', () => {
  it('satır numarası olmadan kimlik üretir', () => {
    assert.strictEqual(nodeId('src/a.ts', 'foo'), 'src/a.ts#foo');
  });

  it('sınıf metotlarını sınıf adıyla niteler', () => {
    assert.strictEqual(nodeId('src/a.ts', 'run', { className: 'Runner' }), 'src/a.ts#Runner.run');
  });

  it('aynı adlı sembolleri sıra numarasıyla ayırır', () => {
    assert.strictEqual(nodeId('src/a.ts', 'foo', { occurrence: 1 }), 'src/a.ts#foo');
    assert.strictEqual(nodeId('src/a.ts', 'foo', { occurrence: 2 }), 'src/a.ts#foo:2');
  });

  it('test dosyalarını tanır', () => {
    for (const file of ['a.test.ts', 'b.spec.tsx', 'src/__tests__/c.ts', 'test/d.ts', 'e_test.py']) {
      assert.strictEqual(isTestFile(file), true, file);
    }
    for (const file of ['a.ts', 'src/testing/helpers.ts', 'contest.ts']) {
      assert.strictEqual(isTestFile(file), false, file);
    }
  });

  it('hassas dosyaları haritadan dışlar', () => {
    for (const file of ['.env', 'config/.env.local', 'certs/server.pem', 'keys/id_rsa', '.git/config']) {
      assert.strictEqual(isSensitivePath(file), true, file);
    }
    assert.strictEqual(isSensitivePath('src/index.ts'), false);
  });

  it('desteklenen kaynak uzantılarını tanır', () => {
    assert.strictEqual(isSupportedSource('src/a.ts'), true);
    assert.strictEqual(isSupportedSource('app/main.py'), true);
    assert.strictEqual(isSupportedSource('README.md'), false);
    assert.strictEqual(isSupportedSource('image.png'), false);
  });
});

describe('callgraph extractor: sembolden düğüme', () => {
  const nodes = buildFileNodes(
    'src/sample.ts',
    [
      'export function alpha() {',
      '  return 1;',
      '}',
      'function beta() {',
      '  return alpha();',
      '}',
      'export class Runner {',
      '  run() { return beta(); }',
      '}'
    ].join('\n'),
    [
      { name: 'alpha', kind: 'Function', line: 1, endLine: 3 },
      { name: 'beta', kind: 'Function', line: 4, endLine: 6 },
      { name: 'Runner', kind: 'Class', line: 7, endLine: 9 },
      { name: 'Runner.run', kind: 'Method', line: 8, endLine: 8 }
    ]
  );

  it('fonksiyon, sınıf ve metodu ayırır', () => {
    assert.deepStrictEqual(
      nodes.map((node) => `${node.kind}:${node.name}`),
      ['function:alpha', 'function:beta', 'class:Runner', 'method:run']
    );
  });

  it('dışa aktarılan sembolü işaretler', () => {
    assert.strictEqual(nodes[0]?.exported, true); // alpha
    assert.strictEqual(nodes[1]?.exported, false); // beta
  });

  it('sınıf metodunu className ile niteler', () => {
    assert.strictEqual(nodes[3]?.className, 'Runner');
    assert.strictEqual(nodes[3]?.id, 'src/sample.ts#Runner.run');
  });

  it('bilinmeyen sembol türlerini atlar', () => {
    assert.strictEqual(toNodeKind('Variable'), 'function');
    assert.strictEqual(toNodeKind('Interface'), undefined);
    assert.strictEqual(toNodeKind('Enum'), undefined);
  });

  it('satırı kapsayan en dar düğümü bulur', () => {
    const inner = enclosingNode(nodes, 8);
    assert.strictEqual(inner?.name, 'run', 'iç içe aralıkta metot seçilmeli');
    assert.strictEqual(enclosingNode(nodes, 5)?.name, 'beta');
    assert.strictEqual(enclosingNode(nodes, 100), undefined);
  });

  it('export tespiti tek satırlık ve çok satırlı bildirimleri yakalar', () => {
    assert.strictEqual(looksExported(['export const x = 1;'], 1), true);
    assert.strictEqual(looksExported(['const x = 1;'], 1), false);
    assert.strictEqual(looksExported(['async function f() {}'], 1), false);
  });
});
