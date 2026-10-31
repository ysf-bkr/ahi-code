import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { ProjectMemoryManager } from '@ahicode/core/core/memory/ProjectMemoryManager';

let tmpDir: string;

describe('ProjectMemoryManager', () => {
  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-memory-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes task record to .ahi/memory.md file', async () => {
    const manager = new ProjectMemoryManager();
    await manager.append(tmpDir, {
      taskId: 'session_1:msg_1',
      mode: 'code',
      status: 'completed',
      prompt: 'Login hatasını düzelt',
      files: ['src/auth.ts'],
      summary: 'Hata yönetimi güncellendi.'
    });

    const snapshot = await manager.load(tmpDir);
    assert.strictEqual(snapshot.entryCount, 1);
    assert.ok(snapshot.content.includes('Login hatasını düzelt'));
    assert.ok(snapshot.content.includes('src/auth.ts'));
    assert.strictEqual(snapshot.path, path.join(tmpDir, '.ahi', 'memory.md'));
  });

  it('does not record same task id twice', async () => {
    const manager = new ProjectMemoryManager();
    await manager.append(tmpDir, {
      taskId: 'session_1:msg_1',
      mode: 'code',
      status: 'completed',
      prompt: 'tekrar',
      files: []
    });

    const snapshot = await manager.load(tmpDir);
    assert.strictEqual(snapshot.entryCount, 1);
  });

  it('includes recent records in the system prompt context', async () => {
    const manager = new ProjectMemoryManager();
    await manager.append(tmpDir, {
      taskId: 'session_1:msg_2',
      mode: 'plan',
      status: 'completed',
      prompt: 'Mimari plan çıkar',
      files: [],
      summary: 'Plan hazırlandı.'
    });

    const context = await manager.formatForPrompt(tmpDir, 4000);
    assert.ok(context.includes('PROJECT MEMORY'));
    assert.ok(context.includes('Mimari plan çıkar'));
  });

  it('searches in structured records', async () => {
    const manager = new ProjectMemoryManager();
    await manager.append(tmpDir, {
      taskId: 'session_1:msg_3',
      mode: 'code',
      status: 'completed',
      prompt: 'Ödeme sağlayıcısı entegrasyonu',
      files: ['src/payment.ts'],
      summary: 'Stripe webhook doğrulaması eklendi.'
    });

    const results = await manager.search(tmpDir, 'webhook');
    assert.ok(results.includes('Ödeme sağlayıcısı'));
    assert.ok(results.includes('Stripe'));
    assert.ok(results.includes('src/payment.ts'));
  });

  it('clears memory', async () => {
    const manager = new ProjectMemoryManager();
    const cleared = await manager.clear(tmpDir);
    assert.strictEqual(cleared, true);
    const snapshot = await manager.load(tmpDir);
    assert.strictEqual(snapshot.entryCount, 0);
    assert.strictEqual(snapshot.content, '');
  });
});
