import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { ContextManager, trimSmart } from '../../src/core/context/ContextManager';
import { ProviderMessage } from '../../src/providers/base';

describe('trimSmart: smart output truncation', () => {
  it('does not modify text below limit', () => {
    const text = 'kısa çıktı';
    assert.strictEqual(trimSmart(text, 100), text);
  });

  it('preserves start and end, indicates truncation', () => {
    const text = `${'A'.repeat(5000)}${'M'.repeat(5000)}${'Z'.repeat(5000)}`;
    const result = trimSmart(text, 1000);

    assert.ok(result.startsWith('A'));
    assert.ok(result.endsWith('Z'));
    assert.match(result, /truncated/);
    assert.ok(result.length < text.length);
  });

  it('preserves middle error lines', () => {
    const middle = Array.from({ length: 200 }, (_v, i) =>
      i === 100 ? 'ERROR: cannot find module "foo"' : `bilgi satiri ${i}`
    ).join('\n');
    const text = `${'H'.repeat(3000)}\n${middle}\n${'T'.repeat(3000)}`;
    const result = trimSmart(text, 2000);

    assert.match(result, /cannot find module/);
    assert.match(result, /signal line/i);
  });

  it('does not treat very long lines as signal', () => {
    const longLine = `ERROR ${'x'.repeat(500)}`;
    const text = `${'H'.repeat(3000)}\n${longLine}\n${'T'.repeat(3000)}`;
    const result = trimSmart(text, 1500);
    assert.ok(!result.includes(longLine));
  });
});

describe('ContextManager: per-tool limits', () => {
  const manager = new ContextManager({ contextWindowTokens: 64000, compactionTokenRatio: 0 });

  it('truncates search_files output more aggressively than read_file', () => {
    const big = 'x'.repeat(30_000);
    const search = manager.truncateToolOutput(big, 'search_files');
    const read = manager.truncateToolOutput(big, 'read_file');
    assert.ok(search.length < read.length, 'search output should be shorter');
    assert.ok(search.length <= 3_200);
    assert.ok(read.length <= 12_200);
  });

  it('keeps command output short', () => {
    const result = manager.truncateToolOutput('y'.repeat(30_000), 'execute_command');
    assert.ok(result.length <= 4_200);
  });

  it('uses default limit for unknown tool', () => {
    const result = manager.truncateToolOutput('z'.repeat(30_000), 'unknown_tool');
    assert.ok(result.length <= 6_200);
  });

  it('büyük projelerde çağrı grafiği çıktılarını sıkı sınırlar', () => {
    const big = 'g'.repeat(30_000);
    assert.ok(manager.truncateToolOutput(big, 'get_callers').length <= 2_700);
    assert.ok(manager.truncateToolOutput(big, 'get_callees').length <= 2_700);
    assert.ok(manager.truncateToolOutput(big, 'call_graph_impact').length <= 3_200);
    assert.ok(manager.truncateToolOutput(big, 'find_related_code').length <= 3_200);
    assert.ok(manager.truncateToolOutput(big, 'call_graph_status').length <= 1_200);
  });

  it('falls back to general limit when tool name not provided', () => {
    const result = manager.truncateToolOutput('w'.repeat(30_000));
    assert.ok(result.length <= 12_200);
  });
});

describe('ContextManager: early history summarization', () => {
  function buildHistory(steps: number, outputChars: number): ProviderMessage[] {
    const messages: ProviderMessage[] = [{ role: 'system', content: 'sistem' }];
    for (let i = 0; i < steps; i++) {
      messages.push({
        role: 'assistant',
        content: `adım ${i}`,
        toolCalls: [{ id: `c${i}`, name: 'read_file', arguments: { path: `f${i}.ts` } }]
      });
      messages.push({ role: 'tool', toolCallId: `c${i}`, content: `sonuc ${i} `.repeat(outputChars / 9) });
    }
    return messages;
  }

  it('does not modify short conversation', () => {
    const manager = new ContextManager({ contextWindowTokens: 64000, compactionTokenRatio: 0 });
    const history = buildHistory(3, 900);
    assert.deepStrictEqual(manager.compactHistory(history), history);
  });

  it('compresses old tool outputs when threshold exceeded', () => {
    const manager = new ContextManager({ contextWindowTokens: 64000, compactionTokenRatio: 0 });
    const history = buildHistory(15, 4000);
    const before = manager.estimateMessagesTokens(history);
    const compacted = manager.compactHistory(history);
    const after = manager.estimateMessagesTokens(compacted);

    assert.ok(after < before, `tokens should decrease: ${before} -> ${after}`);
    const toolMessages = compacted.filter((m) => m.role === 'tool');
    const compactedCount = toolMessages.filter((m) => m.content.includes('compacted')).length;
    assert.ok(compactedCount >= 5, `at least 5 outputs should be compacted, found: ${compactedCount}`);
  });

  it('leaves recent steps as-is', () => {
    const manager = new ContextManager({ contextWindowTokens: 64000, compactionTokenRatio: 0 });
    const history = buildHistory(15, 4000);
    const compacted = manager.compactHistory(history, { keepRecent: 4 });
    const toolMessages = compacted.filter((m) => m.role === 'tool');
    const recent = toolMessages.slice(-4);
    for (const message of recent) {
      assert.ok(!message.content.includes('compacted'), 'recent outputs must not be compressed');
    }
  });

  it('does not compress short outputs', () => {
    const manager = new ContextManager({ contextWindowTokens: 64000, compactionTokenRatio: 0 });
    const history = buildHistory(12, 100);
    const compacted = manager.compactHistory(history);
    assert.ok(!compacted.some((m) => m.content.includes('compacted')));
  });

  it('does not break tool_call and tool_result matching', () => {
    const manager = new ContextManager({ contextWindowTokens: 64000, compactionTokenRatio: 0 });
    const compacted = manager.compactHistory(buildHistory(15, 4000));
    for (let i = 0; i < compacted.length; i++) {
      const message = compacted[i];
      if (message?.role !== 'tool') continue;
      const hasCall = compacted
        .slice(0, i)
        .some(
          (prev) => prev.role === 'assistant' && prev.toolCalls?.some((tc) => tc.id === message.toolCallId)
        );
      assert.ok(hasCall, `orphan tool message: ${message.toolCallId}`);
    }
  });

  it('does not compact while token pressure stays under the ratio', () => {
    // Oran varsayılanı 0,5: 64k pencerede eşik 32k token; bu geçmiş ~16k token.
    const manager = new ContextManager({ contextWindowTokens: 64000 });
    const history = buildHistory(15, 4000);
    assert.ok(manager.estimateMessagesTokens(history) < 32000, 'test önkoşulu: baskı eşiğin altında');
    assert.deepStrictEqual(manager.compactHistory(history), history, 'baskı yokken sıkıştırma çalışmamalı');
  });

  it('compacts once token pressure exceeds the ratio', () => {
    // Küçük pencere: ~16k token, 8k×0,5 = 4k eşeği aşar → sıkıştırma devrede.
    const manager = new ContextManager({ contextWindowTokens: 8000 });
    const compacted = manager.compactHistory(buildHistory(15, 4000));
    const count = compacted.filter((m) => m.role === 'tool' && m.content.includes('compacted')).length;
    assert.ok(count >= 5, `baskıda eski çıktılar sıkışmalı, görülen: ${count}`);
  });
});
