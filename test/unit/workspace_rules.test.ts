import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { WorkspaceRuleManager } from '@ahicode/core/core/rules/WorkspaceRuleManager';

describe('WorkspaceRuleManager: single source of truth', () => {
  let root: string;

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-rules-'));
    await fs.writeFile(path.join(root, 'AGENTS.md'), '# Ajan kuralı\n- AGENTS kuralı', 'utf-8');
    await fs.writeFile(path.join(root, '.ahirules'), '- Öncelikli kural', 'utf-8');
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('loads AGENTS.md and .ahirules together', async () => {
    const manager = new WorkspaceRuleManager();
    await manager.load(root);
    assert.ok(manager.getAgentsMd()?.includes('AGENTS kuralı'));
    assert.ok(manager.getAhiRules()?.includes('Öncelikli kural'));
    const prompt = manager.formatForPrompt();
    assert.ok(prompt.includes('AGENTS.MD INSTRUCTIONS'));
    assert.ok(prompt.includes('PROJECT-SPECIFIC RULES'));
    assert.ok(prompt.includes('take precedence'));
  });
});
