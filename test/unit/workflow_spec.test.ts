import { describe, it, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { SpecStore, SpecValidationError, renderSpecMarkdown, SPECS_DIR } from '../../src/core/spec/SpecStore';
import {
  MAX_INTAKE_QUESTIONS,
  canTransition,
  createWorkflowState,
  describeWorkflow,
  formatWorkflowForPrompt,
  gateForStage,
  isReadOnlyStage,
  stageAllowsCommands
} from '../../src/core/workflow/TaskWorkflow';

describe('SpecStore: validation and persistence', () => {
  let root: string;
  const roots: string[] = [];

  after(async () => {
    await Promise.all(roots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('does not save spec without goal and acceptance criteria', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-spec-'));
    roots.push(root);
    const store = new SpecStore();

    await assert.rejects(
      store.create(root, { goal: '', scope: ['x'], acceptanceCriteria: ['y'] }),
      SpecValidationError
    );
    await assert.rejects(
      store.create(root, { goal: 'Bir şey yap', scope: ['x'], acceptanceCriteria: [] }),
      SpecValidationError
    );
    await assert.rejects(
      store.create(root, { goal: 'Bir şey yap', scope: [], acceptanceCriteria: ['y'] }),
      SpecValidationError
    );
  });

  it('creates spec, writes JSON and Markdown', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-spec-'));
    roots.push(root);
    const store = new SpecStore();
    const spec = await store.create(root, {
      goal: 'Yeniden deneme yardımcısı ekle',
      scope: ['retry helper', 'unit test'],
      outOfScope: ['UI'],
      assumptions: ['Exponential backoff kullanılacak'],
      acceptanceCriteria: ['Yardımcı 3 kez dener', 'Testler geçer'],
      risk: 'low'
    });

    assert.strictEqual(spec.status, 'draft');
    assert.strictEqual(spec.risk, 'low');
    assert.strictEqual(spec.acceptanceCriteria.length, 2);
    assert.match(spec.id, /retry|yardimcisi|ekle/);

    const json = JSON.parse(await fs.readFile(path.join(root, SPECS_DIR, `${spec.id}.json`), 'utf-8'));
    assert.strictEqual(json.goal, spec.goal);
    const markdown = await fs.readFile(path.join(root, SPECS_DIR, `${spec.id}.md`), 'utf-8');
    assert.match(markdown, /## Acceptance criteria/);
    assert.match(markdown, /- \[ \] Yardımcı 3 kez dener/);
  });

  it('approves and marks the criteria', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-spec-'));
    roots.push(root);
    const store = new SpecStore();
    const spec = await store.create(root, {
      goal: 'A',
      scope: ['b'],
      acceptanceCriteria: ['birinci', 'ikinci']
    });

    assert.strictEqual(store.isComplete(spec.id), false);
    const approved = await store.approve(root, spec.id);
    assert.strictEqual(approved.status, 'approved');
    assert.strictEqual(store.getApproved()?.id, spec.id);

    const first = approved.acceptanceCriteria[0]!;
    await store.setCriterionDone(root, spec.id, first.id, true);
    assert.strictEqual(store.isComplete(spec.id), false);

    const second = approved.acceptanceCriteria[1]!;
    await store.setCriterionDone(root, spec.id, second.id, true);
    assert.strictEqual(store.isComplete(spec.id), true);
    assert.strictEqual(store.pendingCriteria(spec.id).length, 0);
  });

  it('when new spec approved old approved spec is superseded (gate bypass chain)', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-spec-'));
    roots.push(root);
    const store = new SpecStore();
    const first = await store.create(root, {
      goal: 'Görev A hedefi',
      scope: ['a'],
      acceptanceCriteria: ['görev A kriteri']
    });
    await store.approve(root, first.id);
    assert.strictEqual(store.getApproved()?.id, first.id);

    // Yeni bir görev kendi spec'ini yazar ve onaylatır.
    const second = await store.create(root, {
      goal: 'Görev B hedefi',
      scope: ['b'],
      acceptanceCriteria: ['görev B kriteri']
    });
    await store.approve(root, second.id);

    // En fazla bir onaylı spec olabilir ve o da yeni görevininki olmalı.
    assert.strictEqual(store.getApproved()?.id, second.id);
    assert.strictEqual(store.get(first.id)?.status, 'superseded');
    assert.strictEqual(store.get(second.id)?.status, 'approved');

    // Supersede kararı diskten yeniden yüklemeden sonra da korunmalı.
    const reloaded = new SpecStore();
    await reloaded.load(root);
    assert.strictEqual(reloaded.getApproved()?.id, second.id);
    assert.strictEqual(reloaded.get(first.id)?.status, 'superseded');
  });

  it('only the requested spec enters the prompt context; a call without an id returns empty', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-spec-'));
    roots.push(root);
    const store = new SpecStore();
    const approved = await store.create(root, {
      goal: 'Eski görev hedefi',
      scope: ['a'],
      acceptanceCriteria: ['eski kriter']
    });
    await store.approve(root, approved.id);

    // Bağlı spec'i olmayan yeni bir görev, sistem promptunda eski görevin
    // spec'ini devralmamalı (görevler arası kabul kriteri sızıntısı).
    assert.strictEqual(store.formatForPrompt(), '');
    assert.strictEqual(store.formatForPrompt('does-not-exist'), '');
    assert.match(store.formatForPrompt(approved.id), /Eski görev hedefi/);
  });

  it('loads from a new instance and skips a corrupted file', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-spec-'));
    roots.push(root);
    const store = new SpecStore();
    const spec = await store.create(root, { goal: 'A', scope: ['b'], acceptanceCriteria: ['c'] });
    await fs.writeFile(path.join(root, SPECS_DIR, 'broken.json'), '{not json', 'utf-8');

    const reloaded = new SpecStore();
    await reloaded.load(root);
    assert.strictEqual(reloaded.get(spec.id)?.goal, 'A');
  });

  it('writes scope and criteria into the prompt context', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-spec-'));
    roots.push(root);
    const store = new SpecStore();
    const spec = await store.create(root, {
      goal: 'A',
      scope: ['b'],
      outOfScope: ['c'],
      assumptions: ['d'],
      acceptanceCriteria: ['e']
    });
    const context = store.formatForPrompt(spec.id);
    assert.match(context, /TASK SPEC/);
    assert.match(context, /In scope: b/);
    assert.match(context, /Out of scope: c/);
    assert.match(context, /Assumptions: d/);
    assert.match(context, /- \[ \] ac-1: e/);
    assert.match(context, /do not expand beyond the stated scope/i);
  });

  it('markdown output shows status and risk', () => {
    const markdown = renderSpecMarkdown({
      id: 'x',
      goal: 'Hedef',
      scope: ['a'],
      outOfScope: [],
      assumptions: [],
      acceptanceCriteria: [{ id: 'ac-1', text: 'bitti', done: true }],
      files: ['src/a.ts'],
      risk: 'high',
      status: 'approved',
      createdAt: 1,
      updatedAt: 2
    });
    assert.match(markdown, /\*\*Status:\*\* approved/);
    assert.match(markdown, /\*\*Risk:\*\* high/);
    assert.match(markdown, /- \[x\] bitti/);
  });
});

describe('TaskWorkflow: stage gates', () => {
  const base = {
    state: createWorkflowState({ stage: 'intake' }),
    hasApprovedSpec: false,
    hasPlan: false,
    hasModules: false,
    criteriaMet: false,
    verificationPassed: false
  };

  it('does not move to plan stage without spec approval', () => {
    const gate = gateForStage('plan', base);
    assert.strictEqual(gate.allowed, false);
    assert.match(gate.reason || '', /approve a spec/i);
  });

  it('does not move to build stage without module map, spec and plan approval', () => {
    assert.strictEqual(gateForStage('build', base).allowed, false);
    assert.strictEqual(
      gateForStage('build', { ...base, hasApprovedSpec: true, hasPlan: true }).allowed,
      false
    );
    // Modül haritası olmadan kod yazılmaz: plan modülden türetilir.
    assert.match(
      gateForStage('build', { ...base, hasApprovedSpec: true, hasPlan: true }).reason || '',
      /module map/i
    );
    assert.match(gateForStage('plan', { ...base, hasApprovedSpec: true }).reason || '', /layered modules/i);
    const approvedState = createWorkflowState({ stage: 'plan', planApproved: true });
    assert.strictEqual(
      gateForStage('build', {
        ...base,
        state: approvedState,
        hasApprovedSpec: true,
        hasPlan: true,
        hasModules: true
      }).allowed,
      true
    );
  });

  it('does not move to done stage without criteria and verification', () => {
    assert.strictEqual(
      gateForStage('done', { ...base, criteriaMet: false, verificationPassed: true }).allowed,
      false
    );
    assert.strictEqual(
      gateForStage('done', { ...base, criteriaMet: true, verificationPassed: false }).allowed,
      false
    );
    assert.strictEqual(
      gateForStage('done', { ...base, criteriaMet: true, verificationPassed: true }).allowed,
      true
    );
  });

  it('allows one step forward and back to intake', () => {
    assert.strictEqual(canTransition('intake', 'spec').allowed, true);
    assert.strictEqual(canTransition('build', 'done').allowed, false);
    assert.strictEqual(canTransition('build', 'intake').allowed, true);
    assert.strictEqual(canTransition('onboard', 'build').allowed, false);
  });

  it('applies read and command restrictions per stage', () => {
    assert.strictEqual(isReadOnlyStage('intake'), true);
    assert.strictEqual(isReadOnlyStage('build'), false);
    assert.strictEqual(stageAllowsCommands('spec'), false);
    assert.strictEqual(stageAllowsCommands('build'), true);
  });

  it('reports question budget and next stages', () => {
    const state = createWorkflowState({ stage: 'intake', questionsAsked: MAX_INTAKE_QUESTIONS });
    const snapshot = describeWorkflow(state);
    assert.strictEqual(snapshot.questionsRemaining, 0);
    assert.ok(snapshot.next.includes('spec'));

    const prompt = formatWorkflowForPrompt(state);
    assert.match(prompt, /question budget is exhausted/i);
    assert.match(prompt, /read-only/i);
  });
});
