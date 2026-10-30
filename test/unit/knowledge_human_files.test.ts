import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { KnowledgeStore } from '../../src/core/knowledge/KnowledgeStore';

/**
 * `.ahi` bilgi tabanı sözleşmesi.
 *
 * Regresyon: `load()` JSON indeksi yoksa erken dönüp insan dosyalarını
 * (`project.md`, `conventions.md`, `decisions.md`, `notes.md`) hiç okumuyordu.
 * Bu yüzden `.ahi` dolu olsa bile ajan proje bilgisini görmüyor ve her şeyi
 * yeniden soruyordu.
 */
describe('KnowledgeStore: .ahi insan dosyaları', () => {
  const roots: string[] = [];

  before(() => {
    assert.ok(true);
  });

  after(async () => {
    await Promise.all(roots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  async function workspace(): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-knowledge-'));
    roots.push(root);
    await fs.mkdir(path.join(root, '.ahi', 'knowledge'), { recursive: true });
    return root;
  }

  it('indeks yokken bile project.md ve conventions.md yükler', async () => {
    const root = await workspace();
    const knowledgeDir = path.join(root, '.ahi', 'knowledge');
    await fs.writeFile(path.join(knowledgeDir, 'project.md'), '# Proje\nMimari: katmanlı', 'utf-8');
    await fs.writeFile(path.join(knowledgeDir, 'conventions.md'), 'Test: node:test', 'utf-8');

    const store = new KnowledgeStore();
    const loaded = await store.load(root);

    assert.strictEqual(loaded, false, 'indeks yok: depo haritası hazır değil');
    const prompt = store.formatForPrompt();
    assert.match(prompt, /Mimari: katmanlı/, 'project.md prompt bağlamına girmeli');
    assert.match(prompt, /Test: node:test/, 'conventions.md prompt bağlamına girmeli');
  });

  it('indeks varken insan dosyalarını yüklemeye devam eder', async () => {
    const root = await workspace();
    const store = new KnowledgeStore();
    await store.indexWorkspace(root);
    await fs.writeFile(path.join(root, '.ahi', 'knowledge', 'project.md'), '# Proje\nModül: auth', 'utf-8');

    const reloaded = new KnowledgeStore();
    await reloaded.load(root);
    assert.match(reloaded.formatForPrompt(), /Modül: auth/);
  });
});
