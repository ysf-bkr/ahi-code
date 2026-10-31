import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { redactForAudit, redactSecrets } from '@ahicode/core/shared/redaction';

describe('redaction: audit log redaction', () => {
  it('masks bearer token and known key formats', () => {
    const text = 'curl -H "Authorization: Bearer abcdefghijklmnop" https://api.test';
    assert.ok(!redactSecrets(text).includes('abcdefghijklmnop'));
    assert.match(redactSecrets(text), /\[REDACTED\]/);

    assert.ok(!redactSecrets('export KEY=sk-1234567890abcdef').includes('1234567890abcdef'));
    assert.match(redactSecrets('token ghp_abcdefghijklmnopqrstuvwx'), /REDACTED_KEY/);
  });

  it('preserves command, only masks secret', () => {
    const args = JSON.stringify({ command: 'npm test -- --token=supersecretvalue' }, redactForAudit);
    const parsed = JSON.parse(args) as { command: string };
    assert.match(parsed.command, /npm test/);
    assert.ok(!parsed.command.includes('supersecretvalue'));
  });

  it('completely hides sensitive keys', () => {
    const args = JSON.stringify({ apiKey: 'abc', token: 'def', path: 'src/a.ts' }, redactForAudit);
    const parsed = JSON.parse(args) as Record<string, string>;
    assert.strictEqual(parsed.apiKey, '[REDACTED]');
    assert.strictEqual(parsed.token, '[REDACTED]');
    assert.strictEqual(parsed.path, 'src/a.ts');
  });

  it('does not modify secret-free text', () => {
    const text = 'npm run build && git status';
    assert.strictEqual(redactSecrets(text), text);
  });
});
