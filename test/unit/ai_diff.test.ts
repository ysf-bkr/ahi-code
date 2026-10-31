import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { formatAiDiff, isLockfile, isAsset } from '@ahicode/core/shared/aiDiff';
import { GitManager } from '@ahicode/core/core/git/GitManager';
import { gitDiffTool } from '@ahicode/core/tools/git';
import { ToolExecutionContext } from '@ahicode/core/tools/base';

const execFileAsync = promisify(execFile);

describe('aiDiff: token tasarruflu diff ayrıştırıcı', () => {
  it('boş diff veya değişiklik yok durumunu anlaşılır metinle döner', () => {
    assert.strictEqual(formatAiDiff(''), '(No changes)');
    assert.strictEqual(formatAiDiff('(No diff)'), '(No changes)');
    assert.strictEqual(formatAiDiff('(No changes)'), '(No changes)');
  });

  it('lockfile ve asset tespitini doğru yapar', () => {
    assert.strictEqual(isLockfile('package-lock.json'), true);
    assert.strictEqual(isLockfile('sub/dir/pnpm-lock.yaml'), true);
    assert.strictEqual(isLockfile('src/index.ts'), false);

    assert.strictEqual(isAsset('dist/bundle.min.js'), true);
    assert.strictEqual(isAsset('dist/app.map'), true);
    assert.strictEqual(isAsset('resources/logo.svg'), true);
    assert.strictEqual(isAsset('src/app.ts'), false);
  });

  it('standart unified diff başlıklarını kompakt AI formatına çevirir', () => {
    const rawDiff = `diff --git a/src/index.ts b/src/index.ts
index 7886470..e48b11a 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -10,6 +10,7 @@ export function selam() {
   const a = 1;
   const b = 2;
+  const c = 3;
   return a + b;
 }`;

    const formatted = formatAiDiff(rawDiff);
    assert.ok(formatted.includes('=== AI-Optimized Diff: 1 file (+1, -0)'));
    assert.ok(formatted.includes('--- [M - Modified] src/index.ts (+1, -0) ---'));
    assert.ok(formatted.includes('@@ L10 [export function selam() {]:'));
    assert.ok(formatted.includes('+  const c = 3;'));
    assert.ok(!formatted.includes('diff --git'));
    assert.ok(!formatted.includes('index 7886470'));
  });

  it('büyük lockfile değişikliklerini otomatik katlayarak token tasarrufu sağlar', () => {
    const rawDiff = `diff --git a/package-lock.json b/package-lock.json
index 1111111..2222222 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,15 +1,20 @@
 {
   "name": "ornek",
+  "version": "1.0.1",
+  "lockfileVersion": 3,
+  "dep1": "1.0.0",
+  "dep2": "2.0.0",
+  "dep3": "3.0.0",
+  "dep4": "4.0.0"
 }`;

    const formatted = formatAiDiff(rawDiff);
    assert.ok(formatted.includes('Generated lockfile: hunks collapsed to save tokens'));
    assert.ok(!formatted.includes('"dep4": "4.0.0"'));
  });

  it('hedef dosya olarak özellikle lockfile istendiğinde katlamaz', () => {
    const rawDiff = `diff --git a/package-lock.json b/package-lock.json
index 1111111..2222222 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,10 +1,15 @@
 {
+  "dep1": "1.0.0",
+  "dep2": "2.0.0",
+  "dep3": "3.0.0",
+  "dep4": "4.0.0",
+  "dep5": "5.0.0",
+  "dep6": "6.0.0"
 }`;

    const formatted = formatAiDiff(rawDiff, { targetPath: 'package-lock.json' });
    assert.ok(!formatted.includes('collapsed to save tokens'));
    assert.ok(formatted.includes('+  "dep1": "1.0.0"'));
  });

  it('yeni dosya, silinen dosya ve ikili dosyaları etiketler', () => {
    const rawDiff = `diff --git a/src/yeni.ts b/src/yeni.ts
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/src/yeni.ts
@@ -0,0 +1,2 @@
+export const x = 1;
+export const y = 2;
diff --git a/src/eski.ts b/src/eski.ts
deleted file mode 100644
index 1234567..0000000
--- a/src/eski.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-const sil = true;
diff --git a/assets/resim.png b/assets/resim.png
index abc..def 100644
Binary files a/assets/resim.png and b/assets/resim.png differ`;

    const formatted = formatAiDiff(rawDiff);
    assert.ok(formatted.includes('[A - Added] src/yeni.ts (+2, -0)'));
    assert.ok(formatted.includes('[D - Deleted] src/eski.ts (+0, -1)'));
    assert.ok(formatted.includes('[B - Binary] assets/resim.png'));
  });

  it('bütçe aşıldığında kalan dosyaları özetleyerek keser', () => {
    const rawDiff = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,3 @@
-bir
+iki
diff --git a/src/b.ts b/src/b.ts
index 333..444 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -1,3 +1,3 @@
-uc
+dort`;

    const formatted = formatAiDiff(rawDiff, { maxChars: 70 });
    assert.ok(formatted.includes('Diff truncated at 70 chars budget'));
    assert.ok(formatted.includes('Remaining 1 files'));
  });
});

describe('GitManager.diff ve gitDiffTool entegrasyonu', () => {
  let root: string;
  let gitManager: GitManager;

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-ai-diff-'));
    gitManager = new GitManager();

    await execFileAsync('git', ['init', '-q'], { cwd: root });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: root });

    await fs.writeFile(path.join(root, 'a.txt'), 'satir 1\nsatir 2\nsatir 3\n', 'utf-8');
    await fs.writeFile(path.join(root, 'b.txt'), 'eski icerik\n', 'utf-8');
    await execFileAsync('git', ['add', '.'], { cwd: root });
    await execFileAsync('git', ['commit', '-m', 'ilk commit', '-q'], { cwd: root });

    // a.txt üzerinde değişiklik
    await fs.writeFile(path.join(root, 'a.txt'), 'satir 1\nsatir 2 degisti\nsatir 3\n', 'utf-8');
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('GitManager.diff kompakt AI formatında döner', async () => {
    const diff = await gitManager.diff(root);
    assert.ok(diff.includes('=== AI-Optimized Diff: 1 file (+1, -1)'));
    assert.ok(diff.includes('--- [M - Modified] a.txt (+1, -1) ---'));
    assert.ok(diff.includes('+satir 2 degisti'));
  });

  it('GitManager.diff path argümanıyla yalnızca hedeflenen dosyayı döner', async () => {
    await fs.writeFile(path.join(root, 'b.txt'), 'yeni icerik\n', 'utf-8');
    const diff = await gitManager.diff(root, { path: 'a.txt' });
    assert.ok(diff.includes('a.txt'));
    assert.ok(!diff.includes('b.txt'));
  });

  it('GitManager.diff compact: false verilince ham unified diff döner', async () => {
    const raw = await gitManager.diff(root, { compact: false });
    assert.ok(raw.includes('diff --git'));
    assert.ok(raw.includes('--- a/'));
    assert.ok(raw.includes('+++ b/'));
  });

  it('GitManager.diff statOnly: true verilince özet istatistik döner', async () => {
    const stat = await gitManager.diff(root, { statOnly: true });
    assert.ok(stat.includes('a.txt'));
    assert.ok(!stat.includes('@@'));
  });

  it('gitDiffTool execute ile çalıştırılır', async () => {
    const context: ToolExecutionContext = {
      workspaceRoot: root,
      gitManager
    };

    const result = await gitDiffTool.execute({ path: 'a.txt', compact: true }, context);
    assert.ok(result.includes('=== AI-Optimized Diff'));
    assert.ok(result.includes('a.txt'));
  });
});
