import * as path from 'path';
import { runTests } from '@vscode/test-electron';

/**
 * Runs the VS Code integration suite against a real VS Code instance.
 *
 * The suite is bundled by `npm run build:e2e` into `out/e2e/suite.js` and runs
 * inside the extension host, so it can exercise activation, commands,
 * configuration defaults and the webview build.
 */
async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
  const extensionTestsPath = path.resolve(extensionDevelopmentPath, 'out', 'e2e', 'suite.js');
  const workspacePath = path.resolve(extensionDevelopmentPath, 'test', 'e2e', 'fixture');

  // Fail fast instead of hanging the terminal if the host never exits.
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
      // Defaults to the current stable build; set VSCODE_TEST_VERSION=1.106.0
      // to verify the minimum supported version instead.
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
