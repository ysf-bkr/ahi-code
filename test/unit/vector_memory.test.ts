import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { ProjectMemoryManager } from '@ahicode/core/core/memory/ProjectMemoryManager';
import { KnowledgeStore } from '@ahicode/core/core/knowledge/KnowledgeStore';
import { VectorMemory } from '@ahicode/core/core/memory/VectorMemory';

describe('VectorMemory: Vektörel Hafıza ve Asla Unutmama', () => {
  let tmpDir: string;
  let projectMemory: ProjectMemoryManager;
  let knowledgeStore: KnowledgeStore;
  let vectorMemory: VectorMemory;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-vector-memory-'));
    projectMemory = new ProjectMemoryManager();
    knowledgeStore = new KnowledgeStore();
    vectorMemory = new VectorMemory(projectMemory, knowledgeStore);
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('geçmiş görevleri (yaptıklarımız) anlamsal kosinüs benzerliği ile hatırlar', async () => {
    await projectMemory.append(tmpDir, {
      taskId: 's1:m1',
      mode: 'code',
      status: 'completed',
      prompt: 'PostgreSQL ve Redis önbellekleme mimarisi kur',
      files: ['src/db/redis.ts', 'src/db/postgres.ts'],
      summary: 'Redis cache-aside deseni ve connection pool oluşturuldu.'
    });

    await projectMemory.append(tmpDir, {
      taskId: 's1:m2',
      mode: 'code',
      status: 'completed',
      prompt: 'Kullanıcı profil fotoğrafı yükleme endpointi',
      files: ['src/upload.ts'],
      summary: 'S3 multipart yükleme desteği eklendi.'
    });

    const matches = await vectorMemory.search(tmpDir, 'veritabanı redis önbellek nasıl yapıldı');
    assert.ok(matches.length > 0, 'en az bir anlamsal eşleşme bulunmalı');
    assert.strictEqual(matches[0]?.item.category, 'task');
    assert.ok(matches[0]?.item.content.includes('Redis'));
    assert.ok((matches[0]?.score ?? 0) > 0.2);
  });

  it('proje kurallarını ve mimari kararlarını (projemizdekiler) hatırlar', async () => {
    await knowledgeStore.writeHumanFile(
      tmpDir,
      'decisions',
      '## Karar 1: Kimlik Doğrulama\nJWT tokenlar HTTP-only cookie içinde saklanacak.'
    );
    await knowledgeStore.writeHumanFile(
      tmpDir,
      'conventions',
      '## Kod Kuralı\nBileşenlerde inline stil yerine Tailwind tokenları kullanılır.'
    );

    await vectorMemory.sync(tmpDir, true);

    const matches = await vectorMemory.search(tmpDir, 'cookie jwt kimlik token nerede saklanır');
    assert.ok(matches.length > 0);
    assert.strictEqual(matches[0]?.item.category, 'decision');
    assert.ok(matches[0]?.item.content.includes('HTTP-only cookie'));
  });

  it('formatForPrompt ile ilişkili hafızayı sistem istemine enjekte edilecek formata dönüştürür', async () => {
    const formatted = await vectorMemory.formatForPrompt(tmpDir, 'redis cache ayarları', 2);
    assert.ok(formatted.includes('VEKTÖR BELLEK'));
    assert.ok(formatted.includes('Redis'));
    assert.ok(formatted.includes('cache'));
  });

  it('ilişkisiz sorgularda gürültü yapmaz ve boş döner', async () => {
    const formatted = await vectorMemory.formatForPrompt(
      tmpDir,
      'astrofizik kuantum mekaniği denklemleri',
      2
    );
    assert.strictEqual(formatted, '');
  });
});
