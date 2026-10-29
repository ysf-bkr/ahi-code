import { runCommand } from '../../src/core/verification/CommandRunner';
import { describe, it } from 'node:test';
import * as assert from 'node:assert';

/**
 * Spawn hatalarının görünürlüğü.
 *
 * Önceki davranış: `child.on('error', () => finish(null))` hata mesajını
 * yutuyordu; "docker bulunamadı" gibi bir arıza kullanıcıya "(no output)"
 * olarak görünüyor ve neden gizli kalıyordu.
 */
describe('CommandRunner: spawn hataları', () => {
  it('bilinmeyen komutun hata mesajını gösterir', async () => {
    const result = await runCommand('bu-komut-kesinlikle-yok-xyz-12345', process.cwd(), {
      timeoutMs: 5_000
    });

    assert.strictEqual(result.ok, false);
    assert.match(result.output, /SPAWN ERROR|not found|ENOENT/i, `hata mesajı görünmeli: ${result.output}`);
    assert.notStrictEqual(result.output, '(no output)');
  });
});
