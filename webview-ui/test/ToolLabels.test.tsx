import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { ToolCall, ToolName, TOOL_NAMES } from '@shared/types';
import { TOOL_TITLES, subagentRoleName, toolStepDetail } from '../src/utils/toolLabels';

const step = (name: ToolName, args: Record<string, unknown> = {}): ToolCall => ({
  id: 't1',
  name,
  args,
  requiresApproval: false,
  status: 'executing'
});

describe('toolLabels: her araç Türkçe başlıkla çizilir', () => {
  it('ToolName birleşimindeki her aracın Türkçe başlığı var', () => {
    for (const name of TOOL_NAMES as readonly ToolName[]) {
      const title = TOOL_TITLES[name];
      assert.ok(title, `${name} başlıksız kalamaz`);
      assert.notStrictEqual(title, name, `${name} ham kimlikle gösterilemez`);
      assert.match(title, /[a-zA-Zğüşıöç]/u);
    }
  });

  it('alt ajan rolü Türkçe Görünen Adla gösterilir', () => {
    assert.equal(subagentRoleName('manager'), 'Yönetici');
    assert.equal(subagentRoleName('@explorer'), 'Keşif Uzmanı');
    assert.equal(subagentRoleName('SECURITY'), 'Güvenlik Uzmanı');
    assert.equal(subagentRoleName('bilinmeyen-rol'), 'bilinmeyen-rol');
    assert.equal(subagentRoleName(undefined), 'uzman');
  });

  it('ayrıntı satırı en anlamlı argümanı tek satıra indirger', () => {
    assert.equal(toolStepDetail(step('execute_command', { command: 'npm  test' })), 'npm test');
    assert.equal(toolStepDetail(step('execute_command')), 'Komut otomatik seçildi');
    assert.equal(
      toolStepDetail(step('web_fetch', { url: 'https://example.com/a' })),
      'https://example.com/a'
    );
    assert.equal(toolStepDetail(step('get_callers', { symbol: 'routeFor' })), 'routeFor');
    assert.equal(toolStepDetail(step('call_graph_impact', { symbols: ['a', 'b'] })), 'a, b');
    assert.equal(
      toolStepDetail(step('invoke_subagent', { role: 'git', task: 'logları incele' })),
      'logları incele'
    );
    assert.equal(toolStepDetail(step('list_directory')), '.');
    assert.equal(toolStepDetail(step('get_diagnostics')), 'Tüm proje');
  });

  it('çok satırlı ve uzun ayrıntılar kartı bozmayacak biçime kısaltılır', () => {
    const long = toolStepDetail(step('write_spec', { goal: `amaç\n${'x'.repeat(300)}` }));
    assert.ok(!long.includes('\n'), 'ayrıntı tek satır olmalı');
    assert.ok(long.length <= 160, 'ayrıntı 160 karakteri aşmamalı');
  });
});
