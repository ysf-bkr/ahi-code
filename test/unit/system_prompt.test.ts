import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { generateSystemPrompt } from '../../src/core/prompts/systemPrompt';

/**
 * Sistem prompt'u akışın gerçek davranışıyla çelişmemelidir.
 *
 * `auto` modda kapılar otomatik geçildiği hâlde prompt "onay bekle" derse model
 * gereksiz yere durur; `manual` modda "onay otomatik" derse onay kapısı
 * atlanmış gibi davranır. İkisi de gerçek hataydı.
 */
describe('systemPrompt: autonomy consistency', () => {
  it('manual mode asks for approval', async () => {
    const prompt = await generateSystemPrompt('/w', 'code', '', '', '', 'manual');
    assert.match(prompt, /must approve it before you plan or write code/);
    assert.match(prompt, /Wait for approval before building/);
    assert.doesNotMatch(prompt, /Approval is granted automatically/);
  });

  it('auto mode never tells the model to wait for approval', async () => {
    const prompt = await generateSystemPrompt('/w', 'code', '', '', '', 'auto');
    assert.doesNotMatch(prompt, /must approve it before you plan or write code/);
    assert.doesNotMatch(prompt, /Wait for approval before building/);
    assert.match(prompt, /AUTONOMY: AUTO/);
    assert.match(prompt, /Approval is granted automatically/);
  });

  it('guided mode auto-approves flow gates but keeps safety wording', async () => {
    const prompt = await generateSystemPrompt('/w', 'code', '', '', '', 'guided');
    assert.match(prompt, /AUTONOMY: GUIDED/);
    assert.match(prompt, /safety approvals \(writes, commands\) still go to the user/);
    assert.doesNotMatch(prompt, /Wait for approval before building/);
  });

  it('orchestration rule is always present', async () => {
    for (const level of ['manual', 'guided', 'auto'] as const) {
      const prompt = await generateSystemPrompt('/w', 'code', '', '', '', level);
      assert.match(prompt, /\[Orchestrate\]/, `${level} için orkestrasyon kuralı yok`);
      assert.match(prompt, /invoke_subagent/);
    }
  });

  it('omitting autonomy keeps the manual wording (backward compatible)', async () => {
    const prompt = await generateSystemPrompt('/w');
    assert.match(prompt, /Wait for approval before building/);
  });

  it('her seviyede kullanıcı-facing rapor sözleşmesi taşır', async () => {
    for (const level of ['manual', 'guided', 'auto'] as const) {
      const prompt = await generateSystemPrompt('/w', 'code', '', '', '', level);
      assert.match(prompt, /\[Close with a User-Facing Report\]/, `${level} için rapor kuralı yok`);
      assert.match(prompt, /the report IS the deliverable/);
      assert.match(prompt, /Merge subagent reports/);
    }
  });

  it('auto bölümü yeni onay gerçekliğini yansıtır', async () => {
    const prompt = await generateSystemPrompt('/w', 'code', '', '', '', 'auto');
    assert.match(prompt, /Routine file writes and allow-listed safe commands run without approval cards/);
    assert.match(prompt, /risky or unknown commands.*still go to the user/);
  });
});
