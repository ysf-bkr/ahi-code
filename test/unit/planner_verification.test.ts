import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { TaskPlanner } from '../../src/core/plan/TaskPlanner';
import { VerificationManager } from '../../src/core/verification/VerificationManager';
import { buildSandboxInvocation, sanitizeEnv } from '../../src/core/verification/CommandRunner';

describe('TaskPlanner: dependencies and status management', () => {
  it('identifies steps and resolves dependency order', () => {
    const planner = new TaskPlanner();
    const plan = planner.update({
      goal: 'Ödeme sistemi ekle',
      steps: [
        { title: 'Veritabanı şeması', completionCriteria: 'Migration çalışıyor' },
        { title: 'Backend API', dependsOn: ['veritabani-semasi'] },
        { title: 'Arayüz', dependsOn: ['backend-api'] }
      ]
    });

    assert.strictEqual(plan.steps.length, 3);
    assert.deepStrictEqual(
      planner.getReadySteps().map((s) => s.id),
      ['veritabani-semasi']
    );
    planner.setStepStatus('veritabani-semasi', 'completed');
    assert.deepStrictEqual(
      planner.getReadySteps().map((s) => s.id),
      ['backend-api']
    );
  });

  it('preserves completion status of step updated with same id', () => {
    const planner = new TaskPlanner();
    planner.update({
      goal: 'Test',
      steps: [
        { id: 'a', title: 'Birinci' },
        { id: 'b', title: 'İkinci', dependsOn: ['a'] }
      ]
    });
    planner.setStepStatus('a', 'completed');

    const updated = planner.update({
      goal: 'Test',
      steps: [
        { id: 'a', title: 'Birinci (güncel)' },
        { id: 'b', title: 'İkinci', dependsOn: ['a'] }
      ]
    });

    assert.ok(updated.steps[0], 'updated step not found');
    assert.strictEqual(updated.steps[0].status, 'completed');
    assert.strictEqual(planner.isComplete(), false);
    planner.setStepStatus('b', 'completed');
    assert.strictEqual(planner.isComplete(), true);
  });

  it('preserves completion status even if title changes without id', () => {
    const planner = new TaskPlanner();
    planner.update({
      steps: [
        { title: 'Veritabanı migration' },
        { title: 'API katmanı', dependsOn: ['veritabani-migration'] }
      ]
    });
    const firstId = planner.getPlan()!.steps[0]!.id;
    planner.setStepStatus(firstId, 'completed');

    const updated = planner.update({
      steps: [
        { title: 'Veritabanı migration dosyası oluşturuldu' },
        { title: 'API katmanı', dependsOn: [firstId] }
      ]
    });

    assert.ok(updated.steps[0], 'updated step not found');
    assert.strictEqual(updated.steps[0].id, firstId);
    assert.strictEqual(updated.steps[0].status, 'completed');
  });

  it('rejects cyclic dependencies', () => {
    const planner = new TaskPlanner();
    assert.throws(
      () =>
        planner.update({
          steps: [
            { id: 'a', title: 'A', dependsOn: ['b'] },
            { id: 'b', title: 'B', dependsOn: ['a'] }
          ]
        }),
      /cycle/i
    );
  });

  it('rejects unknown dependencies', () => {
    const planner = new TaskPlanner();
    assert.throws(
      () =>
        planner.update({
          steps: [{ id: 'a', title: 'A', dependsOn: ['yok'] }]
        }),
      /unknown step/i
    );
  });

  it('matches dependencies that differ in case', () => {
    const planner = new TaskPlanner();
    const plan = planner.update({
      steps: [
        { id: 'step-1', title: 'İlk Adım' },
        { id: 'step-2', title: 'İkinci Adım', dependsOn: ['Step-1'] }
      ]
    });
    assert.ok(plan.steps[1], 'second step not found');
    assert.deepStrictEqual(plan.steps[1].dependsOn, ['step-1']);
  });

  it('includes completion criteria in the prompt context', () => {
    const planner = new TaskPlanner();
    planner.update({
      goal: 'Hedef',
      steps: [{ title: 'Adım', completionCriteria: 'Testler geçiyor' }]
    });
    const context = planner.formatForPrompt();
    assert.ok(context.includes('ACTIVE TASK PLAN'));
    assert.ok(context.includes('Testler geçiyor'));
  });

  it('keeps the model-declared ownerRole and assigns missing roles', () => {
    const planner = new TaskPlanner();
    planner.update({
      goal: 'Hedef',
      steps: [
        { title: 'Veritabanı şeması', files: ['db/migrations/001.sql'] },
        { title: 'Ekran', files: ['src/App.tsx'], ownerRole: 'mobile' }
      ]
    });

    const assigned = planner.assignRoles();
    assert.ok(assigned);
    assert.strictEqual(assigned?.steps[0]?.ownerRole, 'database');
    assert.strictEqual(assigned?.steps[1]?.ownerRole, 'mobile', 'model ataması korunmalı');
  });

  it('persists ownerRole through hydrate and re-update', () => {
    const planner = new TaskPlanner();
    planner.update({ goal: 'Hedef', steps: [{ title: 'Adım', ownerRole: 'quality' }] });
    const plan = planner.getPlan();
    assert.ok(plan);

    const restored = new TaskPlanner();
    restored.hydrate(plan);
    assert.strictEqual(restored.getPlan()?.steps[0]?.ownerRole, 'quality');

    // Başlık değişse de atama kaybolmamalı.
    const updated = restored.update({
      goal: 'Hedef',
      steps: [{ id: plan.steps[0]!.id, title: 'Yeni adım' }]
    });
    assert.strictEqual(updated.steps[0]?.ownerRole, 'quality');
  });

  it('shows owner roles in the prompt context and assignments summary', () => {
    const planner = new TaskPlanner();
    planner.update({ goal: 'Hedef', steps: [{ title: 'Ekran', files: ['src/App.tsx'] }] });
    planner.assignRoles();

    assert.match(planner.formatForPrompt(), /Owner: @frontend/);
    assert.match(planner.formatAssignments(), /@frontend \(yönlendirme\)/);
  });
});

describe('VerificationManager: verification and baseline comparison', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-verify-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('detects project commands from package.json and tsconfig', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        scripts: { test: 'node --test', lint: 'eslint .' }
      }),
      'utf-8'
    );
    await fs.writeFile(path.join(tmpDir, 'tsconfig.json'), '{}', 'utf-8');

    const manager = new VerificationManager();
    const commands = await manager.detectCommands(tmpDir);
    const kinds = commands.map((c) => c.kind);
    assert.ok(kinds.includes('test'));
    assert.ok(kinds.includes('lint'));
    assert.ok(kinds.includes('typecheck'));
  });

  it('detects native (Rust/Cargo), backend (Go), and mobile (Flutter) verification commands', async () => {
    const manager = new VerificationManager();
    const rustDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-rust-test-'));
    const goDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-go-test-'));
    const flutterDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-flutter-test-'));

    try {
      await fs.writeFile(path.join(rustDir, 'Cargo.toml'), '[package]\nname = "test"\n', 'utf-8');
      const rustCommands = await manager.detectCommands(rustDir);
      assert.ok(rustCommands.some((c) => c.command === 'cargo test'));
      assert.ok(rustCommands.some((c) => c.command.includes('cargo clippy')));

      await fs.writeFile(path.join(goDir, 'go.mod'), 'module example.com/test\n', 'utf-8');
      const goCommands = await manager.detectCommands(goDir);
      assert.ok(goCommands.some((c) => c.command === 'go test ./...'));
      assert.ok(goCommands.some((c) => c.command === 'go vet ./...'));

      await fs.writeFile(path.join(flutterDir, 'pubspec.yaml'), 'name: test\n', 'utf-8');
      const flutterCommands = await manager.detectCommands(flutterDir);
      assert.ok(flutterCommands.some((c) => c.command === 'flutter test'));
      assert.ok(flutterCommands.some((c) => c.command === 'flutter analyze'));
    } finally {
      await fs.rm(rustDir, { recursive: true, force: true }).catch(() => {});
      await fs.rm(goDir, { recursive: true, force: true }).catch(() => {});
      await fs.rm(flutterDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('reports successful and failed commands', async () => {
    const manager = new VerificationManager();
    const ok = await manager.verify(tmpDir, {
      commands: [{ kind: 'test', command: 'node -e "process.exit(0)"' }]
    });
    assert.strictEqual(ok.status, 'passed');
    assert.strictEqual(ok.steps.length, 1);

    const failed = await manager.verify(tmpDir, {
      commands: [
        { kind: 'test', command: 'node -e "process.stderr.write(\'Error: boom\\n\'); process.exit(1)"' }
      ]
    });
    assert.strictEqual(failed.status, 'failed');
    assert.ok(failed.failureSignature.some((item) => item.includes('boom')));
    assert.ok(failed.summary.includes('failed'));
  });

  it('does not run commands rejected by the commandFilter', async () => {
    const manager = new VerificationManager();
    const result = await manager.verify(tmpDir, {
      commands: [
        { kind: 'test', command: 'node -e "process.exit(0)"' },
        { kind: 'lint', command: 'node -e "process.exit(1)"' }
      ],
      commandFilter: (command) => !command.includes('process.exit(1)')
    });
    assert.strictEqual(result.steps.length, 1);
    assert.strictEqual(result.status, 'passed');
  });

  it('sanitizes sensitive variables from the verification environment', () => {
    const env = sanitizeEnv({
      PATH: '/usr/bin',
      HOME: '/home/test',
      NODE_OPTIONS: '--no-warnings',
      OPENAI_API_KEY: 'gizli',
      npm_config_registry: 'https://registry.npmjs.org'
    });
    assert.strictEqual(env.PATH, '/usr/bin');
    assert.strictEqual(env.NODE_OPTIONS, '--no-warnings');
    assert.strictEqual(env.OPENAI_API_KEY, undefined);
    assert.strictEqual(env.npm_config_registry, 'https://registry.npmjs.org');
    assert.strictEqual(env.CI, '1');
  });

  it('preserves proxy, SSH agent, Git, XDG and Windows profile variables', () => {
    const env = sanitizeEnv({
      PATH: '/usr/bin',
      HTTP_PROXY: 'http://proxy.corp:3128',
      https_proxy: 'http://proxy.corp:3128',
      NO_PROXY: 'localhost,127.0.0.1',
      SSH_AUTH_SOCK: '/tmp/agent.sock',
      GIT_AUTHOR_NAME: 'Ahi',
      XDG_CONFIG_HOME: '/home/test/.config',
      TZ: 'Europe/Istanbul',
      USERPROFILE: 'C:\\Users\\test',
      APPDATA: 'C:\\Users\\test\\AppData\\Roaming',
      PROGRAMFILES: 'C:\\Program Files',
      AWS_SECRET_ACCESS_KEY: 'cok-gizli'
    });
    assert.strictEqual(env.HTTP_PROXY, 'http://proxy.corp:3128');
    assert.strictEqual(env.https_proxy, 'http://proxy.corp:3128');
    assert.strictEqual(env.NO_PROXY, 'localhost,127.0.0.1');
    assert.strictEqual(env.SSH_AUTH_SOCK, '/tmp/agent.sock');
    assert.strictEqual(env.GIT_AUTHOR_NAME, 'Ahi');
    assert.strictEqual(env.XDG_CONFIG_HOME, '/home/test/.config');
    assert.strictEqual(env.TZ, 'Europe/Istanbul');
    assert.strictEqual(env.USERPROFILE, 'C:\\Users\\test');
    assert.strictEqual(env.APPDATA, 'C:\\Users\\test\\AppData\\Roaming');
    assert.strictEqual(env.PROGRAMFILES, 'C:\\Program Files');
    assert.strictEqual(env.AWS_SECRET_ACCESS_KEY, undefined);
  });

  it('user explicit CI value is not overridden', () => {
    assert.strictEqual(sanitizeEnv({ PATH: '/usr/bin', CI: '0' }).CI, '0');
    assert.strictEqual(sanitizeEnv({ PATH: '/usr/bin' }).CI, '1');
  });

  it('produces Docker sandbox command with network off and workspace bound', () => {
    const invocation = buildSandboxInvocation('npm test', {
      image: 'node:20-bookworm',
      workspaceRoot: '/tmp/proje'
    });
    assert.strictEqual(invocation.file, 'docker');
    assert.ok(invocation.args.includes('--network'));
    assert.ok(invocation.args.includes('none'));
    assert.ok(invocation.args.includes('/tmp/proje:/workspace'));
    assert.deepStrictEqual(invocation.args.slice(-4), ['node:20-bookworm', 'sh', '-lc', 'npm test']);
  });

  it('baseline written to disk and loaded in new manager', async () => {
    const manager = new VerificationManager();
    await manager.attachWorkspace(tmpDir);
    const baseline = await manager.verify(tmpDir, {
      commands: [
        { kind: 'test', command: 'node -e "process.stderr.write(\'Error: kalici\\n\'); process.exit(1)"' }
      ]
    });
    manager.setBaseline(baseline);
    await new Promise((resolve) => setTimeout(resolve, 30));

    const reloaded = new VerificationManager();
    await reloaded.attachWorkspace(tmpDir);
    assert.ok(reloaded.getBaseline());
    assert.ok(reloaded.getBaseline()!.failureSignature.length > 0);
  });

  it('does not count same error as baseline as new failure', async () => {
    const manager = new VerificationManager();
    const command = 'node -e "process.stderr.write(\'Error: ayni-hata\\n\'); process.exit(1)"';
    const baseline = await manager.verify(tmpDir, {
      commands: [{ kind: 'test', command }]
    });
    manager.setBaseline(baseline);

    const after = await manager.verify(tmpDir, {
      commands: [{ kind: 'test', command }]
    });
    assert.strictEqual(manager.getNewFailures(after).length, 0);

    const different = await manager.verify(tmpDir, {
      commands: [
        { kind: 'test', command: 'node -e "process.stderr.write(\'Error: yeni-hata\\n\'); process.exit(1)"' }
      ]
    });
    assert.ok(manager.getNewFailures(different).length > 0);
  });
});
