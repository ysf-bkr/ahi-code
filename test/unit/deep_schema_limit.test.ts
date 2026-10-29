import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  coerceToolArguments,
  validateToolArguments,
  type JsonSchema,
  type ToolDefinition
} from '../../src/tools/base';

/**
 * Derinlik koruması testleri.
 *
 * Araç şemaları MCP sunucularından gelebilir; derinlik dışarıdan gelir. Bu
 * testler özyinelemenin (yığın taşması) geri dönmediğini doğrular: çok derin
 * şema bile çökme olmadan, anlaşılır biçimde işlenmeli.
 */

/** `depth` seviye iç içe nesne şeması üretir. */
function deepObjectSchema(depth: number): JsonSchema {
  let schema: JsonSchema = { type: 'string' };
  for (let i = 0; i < depth; i++) {
    schema = { type: 'object', properties: { child: schema } };
  }
  return schema;
}

/** `depth` seviye iç içe nesne değeri üretir. */
function deepObjectValue(depth: number): Record<string, unknown> {
  let value: unknown = 'leaf';
  for (let i = 0; i < depth; i++) {
    value = { child: value };
  }
  return value as Record<string, unknown>;
}

function toolWith(schema: JsonSchema): ToolDefinition {
  return {
    name: 'read_file',
    description: 'test',
    parameters: {
      type: 'object',
      properties: { deep: schema },
      required: ['deep']
    },
    execute: async () => ''
  };
}

describe('tools/base: derin şema yığın taşması yapmaz', () => {
  const DEPTH = 50_000;

  it('çok derin şemayı doğrular (özyineleme yok)', () => {
    const tool = toolWith(deepObjectSchema(DEPTH));
    const error = validateToolArguments(tool, { deep: deepObjectValue(DEPTH) });
    assert.strictEqual(error, undefined);
  });

  it('çok derin şemada tip hatasını yakalar', () => {
    const tool = toolWith(deepObjectSchema(DEPTH));
    // En dipte sayı var ama şema dize bekliyor.
    let bad: unknown = 42;
    for (let i = 0; i < DEPTH; i++) bad = { child: bad };
    const error = validateToolArguments(tool, { deep: bad });
    assert.ok(error, 'derin hatada da hata dönmeli');
    assert.ok(error.includes('must be a string'), error);
  });

  it('çok derin değeri dönüştürür (özyineleme yok)', () => {
    const tool = toolWith(deepObjectSchema(1));
    const args = coerceToolArguments(tool, { deep: { child: 5 } });
    // Şema dize bekliyor, 5 sayı olarak kalır (dönüşüm yalnızca number/boolean).
    assert.deepStrictEqual(args.deep, { child: 5 });
  });

  it('çok derin sayı/boolean zincirini dönüştürür', () => {
    let schema: JsonSchema = { type: 'number' };
    for (let i = 0; i < DEPTH; i++) schema = { type: 'object', properties: { child: schema } };

    const tool = toolWith(schema);
    const value = { deep: deepObjectValue(DEPTH) };
    // En dipteki değer dizeye çevrilir ki dönüşüm zinciri sınansın.
    let cursor = value.deep as Record<string, unknown>;
    while (typeof cursor.child === 'object' && cursor.child !== null) {
      cursor = cursor.child as Record<string, unknown>;
    }
    cursor.child = '7';

    const coerced = coerceToolArguments(tool, value);
    let out = coerced.deep as Record<string, unknown>;
    while (typeof out.child === 'object' && out.child !== null) {
      out = out.child as Record<string, unknown>;
    }
    assert.strictEqual(out.child, 7, 'en dipteki "7" sayıya çevrilmeli');
  });

  it('döngüsel şemada sonsuz döngüye girmez', () => {
    const cyclic: JsonSchema = { type: 'object', properties: {} };
    // Kendine referans veren şema.
    cyclic.properties = { self: cyclic };

    const tool = toolWith(cyclic);
    const error = validateToolArguments(tool, { deep: { self: { self: {} } } });
    assert.strictEqual(error, undefined);

    const coerced = coerceToolArguments(tool, { deep: { self: {} } });
    assert.ok(coerced.deep, 'döngüsel şema da sonuç üretmeli');
  });
});

describe('TaskPlanner: uzun bağımlılık zinciri yığın taşması yapmaz', () => {
  it('10.000 adımlık zinciri doğrular', async () => {
    const { TaskPlanner } = await import('../../src/core/plan/TaskPlanner');
    const planner = new TaskPlanner();

    const steps = Array.from({ length: 10_000 }, (_, index) => ({
      id: `s${index}`,
      title: `Adım ${index}`,
      dependsOn: index > 0 ? [`s${index - 1}`] : []
    }));

    const plan = planner.update({ goal: 'derin', steps } as never);
    assert.strictEqual(plan.steps.length, 10_000);
  });

  it('döngüyü hâlâ yakalar', async () => {
    const { TaskPlanner } = await import('../../src/core/plan/TaskPlanner');
    const planner = new TaskPlanner();

    assert.throws(
      () =>
        planner.update({
          goal: 'döngü',
          steps: [
            { id: 'a', title: 'A', dependsOn: ['b'] },
            { id: 'b', title: 'B', dependsOn: ['a'] }
          ]
        } as never),
      /Cycle detected/
    );
  });
});
