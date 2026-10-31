import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  assignPlanRoles,
  normalizeRole,
  roleForPath,
  roleForStep,
  roleForText,
  rolesForStep,
  rolesForChangedFiles
} from '@ahicode/core/shared/agents/routing';
import { PlanStep } from '@ahicode/core/shared/types';

/**
 * Rol yönlendirmesi: "kim neyi yapacak" kararı.
 *
 * Bu testler kararın deterministik olduğunu ve modelin rol adı uydurmasına
 * gerek kalmadığını doğrular.
 */
describe('Agent routing: path based roles', () => {
  it('maps UI files to frontend', () => {
    assert.strictEqual(roleForPath('webview-ui/src/components/Button.tsx'), 'frontend');
    assert.strictEqual(roleForPath('src/styles/main.css'), 'frontend');
  });

  it('maps backend and core files to backend', () => {
    assert.strictEqual(roleForPath('src/core/agent/AgentCore.ts'), 'backend');
    assert.strictEqual(roleForPath('src/providers/openai.ts'), 'backend');
  });

  it('maps tests and lint config to quality', () => {
    assert.strictEqual(roleForPath('test/unit/routing.test.ts'), 'quality');
    assert.strictEqual(roleForPath('src/foo.spec.ts'), 'quality');
    assert.strictEqual(roleForPath('eslint.config.mjs'), 'quality');
  });

  it('maps database, devops and security paths', () => {
    assert.strictEqual(roleForPath('db/migrations/001_init.sql'), 'database');
    assert.strictEqual(roleForPath('Dockerfile'), 'devops');
    assert.strictEqual(roleForPath('.github/workflows/ci.yml'), 'devops');
    assert.strictEqual(roleForPath('src/security/session.ts'), 'security');
  });

  it('maps native and mobile paths', () => {
    assert.strictEqual(roleForPath('native/lib.rs'), 'native');
    assert.strictEqual(roleForPath('android/MainActivity.kt'), 'mobile');
  });

  it('returns undefined for unrelated paths', () => {
    assert.strictEqual(roleForPath('LICENSE'), undefined);
    assert.strictEqual(roleForPath(''), undefined);
  });
});

describe('Agent routing: text based roles', () => {
  it('detects database work in Turkish and English', () => {
    assert.strictEqual(roleForText('Veritabanı şemasını güncelle'), 'database');
    assert.strictEqual(roleForText('Add a SQL migration'), 'database');
  });

  it('detects security, devops and quality work', () => {
    assert.strictEqual(roleForText('Kimlik doğrulama güvenlik açığını kapat'), 'security');
    assert.strictEqual(roleForText('CI/CD pipeline ekle'), 'devops');
    assert.strictEqual(roleForText('Test kapsamını artır'), 'quality');
  });

  it('falls back to undefined when nothing matches', () => {
    assert.strictEqual(roleForText('merhaba'), undefined);
  });
});

describe('Agent routing: step assignment', () => {
  it('prefers the role declared by the model', () => {
    assert.strictEqual(
      roleForStep({ title: 'UI ekranı', files: ['src/a.ts'], ownerRole: 'mobile' }),
      'mobile'
    );
  });

  it('resolves aliases', () => {
    assert.strictEqual(normalizeRole('coder'), 'backend');
    assert.strictEqual(normalizeRole('tester'), 'quality');
    assert.strictEqual(normalizeRole('nope'), undefined);
  });

  it('prefers files over text', () => {
    // Metin "docker" diyor ama dosyalar UI: dosya kazanır.
    assert.strictEqual(
      roleForStep({ title: 'Docker imajını güncelle', files: ['webview-ui/src/App.tsx'] }),
      'frontend'
    );
  });

  it('falls back to text, then to backend', () => {
    assert.strictEqual(roleForStep({ title: 'Migration yaz' }), 'database');
    assert.strictEqual(roleForStep({ title: 'Bir şey yap' }), 'backend');
  });

  it('assigns every step and reports the reason', () => {
    const steps: PlanStep[] = [
      {
        id: 's1',
        title: 'Schema',
        status: 'pending',
        dependsOn: [],
        files: ['db/migrations/001.sql']
      },
      { id: 's2', title: 'Ekranı yaz', status: 'pending', dependsOn: ['s1'], files: ['src/App.tsx'] },
      { id: 's3', title: 'UI', status: 'pending', dependsOn: ['s2'], ownerRole: 'mobile' }
    ];

    const assignments = assignPlanRoles(steps);
    assert.strictEqual(assignments.length, 3);
    assert.strictEqual(assignments[0]?.role, 'database');
    assert.strictEqual(assignments[1]?.role, 'frontend');
    assert.strictEqual(assignments[2]?.role, 'mobile');
    assert.strictEqual(assignments[2]?.reason, 'model tarafından atandı');
  });

  it('is deterministic for equal inputs', () => {
    const steps: PlanStep[] = [{ id: 's1', title: 'API', status: 'pending', dependsOn: [] }];
    assert.deepStrictEqual(assignPlanRoles(steps), assignPlanRoles(steps));
  });
});

describe('Agent routing: collaborators (independent review)', () => {
  it('adds quality as an independent reviewer of any writer role', () => {
    const { primary, collaborators } = rolesForStep({
      title: 'Servis katmanını düzenle',
      files: ['src/services/user.ts']
    });
    assert.strictEqual(primary, 'backend');
    assert.ok(collaborators.includes('quality'), 'yazan rolün işi @quality tarafından incelenmeli');
  });

  it('adds security when a .ts file carries security semantics', () => {
    const { primary, collaborators } = rolesForStep({
      title: 'Token doğrulamasını güçlendir',
      files: ['src/services/tokenService.ts']
    });
    assert.strictEqual(primary, 'backend');
    assert.ok(collaborators.includes('security'), 'güvenlik mantığında @security katılmalı');
    assert.ok(collaborators.includes('quality'));
  });

  it('adds quality as reviewer when security role writes code', () => {
    const { primary, collaborators } = rolesForStep({
      title: 'Güvenlik açığını kapat',
      files: ['src/security/session.ts']
    });
    assert.strictEqual(primary, 'security');
    assert.ok(collaborators.includes('quality'));
  });

  it('adds architect when a step spans three or more domains', () => {
    const { collaborators } = rolesForStep({
      title: 'Uçtan uca özellik',
      files: ['src/services/a.ts', 'webview-ui/src/App.tsx', 'db/migrations/001.sql']
    });
    assert.ok(collaborators.includes('architect'));
  });

  it('never keeps the primary role or manager as a collaborator', () => {
    const { primary, collaborators } = rolesForStep({ ownerRole: 'backend', title: 'x', files: [] });
    assert.strictEqual(primary, 'backend');
    assert.ok(!collaborators.includes(primary));
    assert.ok(!collaborators.includes('manager'));
  });

  it('detects security-sensitive changed files for the review stage', () => {
    assert.ok(rolesForChangedFiles(['src/payment/charge.ts']).includes('security'));
    assert.ok(rolesForChangedFiles(['src/utils/text.ts']).includes('quality'));
    assert.ok(!rolesForChangedFiles(['src/utils/text.ts']).includes('security'));
  });

  it('assignPlanRoles reports collaborators for each step', () => {
    const steps: PlanStep[] = [
      { id: 's1', title: 'Ödeme', status: 'pending', dependsOn: [], files: ['src/billing/checkout.ts'] }
    ];
    const [assignment] = assignPlanRoles(steps);
    assert.strictEqual(assignment?.role, 'backend');
    assert.ok(assignment?.collaborators.includes('security'));
  });
});
