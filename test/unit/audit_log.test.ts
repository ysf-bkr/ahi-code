import { describe, it, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { AuditLog, auditFilePath, GENESIS_HASH, AUDIT_FILE_NAME } from '../../src/core/audit/AuditLog';

describe('AuditLog: hash chain', () => {
  let root: string;
  // Her test kendi çalışma alanını oluşturur; `after` hepsini silmeli,
  // aksi halde her çalışma geçici klasörde beş dizin bırakır.
  const roots: string[] = [];

  after(async () => {
    await Promise.all(roots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('considers empty log valid', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-audit-'));
    roots.push(root);
    const result = await AuditLog.verify(root);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.entries, 0);
  });

  it('chains and verifies entries', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-audit-'));
    roots.push(root);
    const first = await AuditLog.append(root, {
      decision: 'completed',
      tool: 'read_file',
      args: '{"path":"a.ts"}'
    });
    const second = await AuditLog.append(root, {
      decision: 'rejected',
      tool: 'write_file',
      args: '{"path":"b.ts"}'
    });

    assert.strictEqual(first.prevHash, GENESIS_HASH);
    assert.strictEqual(second.prevHash, first.hash);
    assert.notStrictEqual(first.hash, second.hash);

    const result = await AuditLog.verify(root);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.entries, 2);
    assert.strictEqual(result.headHash, second.hash);
  });

  it('detects tampered record', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-audit-'));
    roots.push(root);
    await AuditLog.append(root, { decision: 'completed', tool: 'read_file', args: '{"path":"a.ts"}' });
    await AuditLog.append(root, { decision: 'completed', tool: 'read_file', args: '{"path":"b.ts"}' });

    const file = auditFilePath(root);
    const lines = (await fs.readFile(file, 'utf-8')).split('\n').filter(Boolean);
    const tampered = JSON.parse(lines[0] as string);
    tampered.decision = 'allowed';
    lines[0] = JSON.stringify(tampered);
    await fs.writeFile(file, `${lines.join('\n')}\n`, 'utf-8');

    const result = await AuditLog.verify(root);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.brokenAt, 0);
    assert.match(result.message, /Hash mismatch/i);
  });

  it('detects deleted record (chain break)', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-audit-'));
    roots.push(root);
    await AuditLog.append(root, { decision: 'completed', tool: 't1', args: '{}' });
    await AuditLog.append(root, { decision: 'completed', tool: 't2', args: '{}' });
    await AuditLog.append(root, { decision: 'completed', tool: 't3', args: '{}' });

    const file = auditFilePath(root);
    const lines = (await fs.readFile(file, 'utf-8')).split('\n').filter(Boolean);
    lines.splice(1, 1); // remove the middle entry
    await fs.writeFile(file, `${lines.join('\n')}\n`, 'utf-8');

    const result = await AuditLog.verify(root);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.brokenAt, 1);
    assert.match(result.message, /Chain break/i);
  });

  it('skips legacy TSV records and warns', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-audit-'));
    roots.push(root);
    await fs.mkdir(path.join(root, '.ahi'), { recursive: true });
    const file = path.join(root, '.ahi', AUDIT_FILE_NAME);
    await fs.writeFile(file, '2026-01-01T00:00:00.000Z\tcompleted\tread_file\t{}\n', 'utf-8');

    await AuditLog.append(root, { decision: 'completed', tool: 'edit_file', args: '{}' });
    const result = await AuditLog.verify(root);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.entries, 1);
    assert.strictEqual(result.legacyEntries, 1);
  });

  it('does not break chain on concurrent appends', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-audit-'));
    roots.push(root);
    await Promise.all(
      Array.from({ length: 12 }, (_value, index) =>
        AuditLog.append(root, { decision: 'completed', tool: `tool_${index}`, args: '{}' })
      )
    );

    const result = await AuditLog.verify(root);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.entries, 12);
  });
});
