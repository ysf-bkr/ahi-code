import * as path from 'path';
import { runTests } from '@vscode/test-electron';

/**
 * VS Code entegrasyon testlerini gerçek bir VS Code örneğinde çalıştırır.
 *
 * Test paketi `npm run build:e2e` ile `out/e2e/suite.js` olarak paketlenir ve
 * extension host içinde çalışır; böylece aktivasyon, komutlar, yapılandırma
 * varsayılanları ve webview build'ini gerçek koşullarda sınayabilir.
 */
async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
  const extensionTestsPath = path.resolve(extensionDevelopmentPath, 'out', 'e2e', 'suite.js');
  const workspacePath = path.resolve(extensionDevelopmentPath, 'test', 'e2e', 'fixture');

  // Host hiç çıkmazsa terminali askıda bırakmak yerine hızlıca başarısız ol.
  const timeout = setTimeout(
    () => {
      process.stderr.write('E2E tests timed out after 5 minutes.\n');
      process.exit(1);
    },
    5 * 60 * 1000
  );
  timeout.unref?.();

  try {
    await runTests({
      // Varsayılan güncel stable sürümdür; desteklenen en düşük sürümü doğrulamak
      // için VSCODE_TEST_VERSION=1.106.0 ayarlanabilir.
      version: process.env.VSCODE_TEST_VERSION || 'stable',
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        workspacePath,
        '--disable-extensions',
        '--disable-gpu',
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes',
        '--no-sandbox'
      ]
    });
  } catch (err) {
    process.stderr.write(`VS Code integration tests failed: ${String(err)}\n`);
    process.exit(1);
  }
}

void main();
