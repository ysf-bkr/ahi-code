import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { frontmatterList, frontmatterScalar, parseFrontmatter } from '@ahicode/core/shared/frontmatter';
import { SkillManager } from '@ahicode/core/core/skills/SkillManager';

describe('frontmatter: AGENT.md / SKILL.md parsing', () => {
  it('reads plain and quoted scalar values', () => {
    const fields = parseFrontmatter(
      '---\nname: my-agent\nrole: "DevOps Engineer"\ndesc: \'tek satır\'\n---\nbody'
    );
    assert.strictEqual(frontmatterScalar(fields, 'name', 'x'), 'my-agent');
    assert.strictEqual(frontmatterScalar(fields, 'role', 'x'), 'DevOps Engineer');
    assert.strictEqual(frontmatterScalar(fields, 'desc', 'x'), 'tek satır');
    assert.strictEqual(frontmatterScalar(fields, 'missing', 'fallback'), 'fallback');
  });

  it('reads inline list', () => {
    const fields = parseFrontmatter('---\ntools: [read_file, "write_file", edit_file]\n---\n');
    assert.deepStrictEqual(frontmatterList(fields, 'tools'), ['read_file', 'write_file', 'edit_file']);
  });

  it('reads multi-line YAML block list', () => {
    // Standart YAML listeleriyle yazılan agentlar daha önce hiç araç alamıyor
    // ve sessizce salt-okunur araç setine düşüyordu.
    const fields = parseFrontmatter('---\ntools:\n  - read_file\n  - write_file\n  - execute_command\n---\n');
    assert.deepStrictEqual(frontmatterList(fields, 'tools'), ['read_file', 'write_file', 'execute_command']);
  });

  it('merges folded description blocks', () => {
    const folded = parseFrontmatter('---\ndescription: >-\n  Uzun bir açıklamanın\n  ikinci satırı\n---\n');
    assert.strictEqual(frontmatterScalar(folded, 'description', ''), 'Uzun bir açıklamanın ikinci satırı');

    const literal = parseFrontmatter('---\ndescription: |\n  satır bir\n  satır iki\n---\n');
    assert.strictEqual(frontmatterScalar(literal, 'description', ''), 'satır bir\nsatır iki');
  });

  it('returns empty map when no frontmatter', () => {
    assert.strictEqual(parseFrontmatter('sadece gövde').size, 0);
  });
});

describe('SkillManager: custom agent and skill discovery', () => {
  let root: string;

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-skills-'));

    const agentsDir = path.join(root, '.agents', 'agents', 'reviewer-agent');
    await fs.mkdir(agentsDir, { recursive: true });
    await fs.writeFile(
      path.join(agentsDir, 'AGENT.md'),
      [
        '---',
        'name: "Güvenlik İncelemecisi"',
        'role: reviewer',
        'description: Kod kalitesi ve güvenlik incelemesi yapar',
        'tools:',
        '  - read_file',
        '  - git_diff',
        '  - search_files',
        '---',
        '',
        'You review code for security issues.'
      ].join('\n'),
      'utf-8'
    );

    const skillsDir = path.join(root, '.agents', 'skills', 'release-checklist');
    await fs.mkdir(skillsDir, { recursive: true });
    await fs.writeFile(
      path.join(skillsDir, 'SKILL.md'),
      [
        '---',
        'name: release-checklist',
        'description: "Sürüm öncesi kontrol listesi"',
        '---',
        '',
        'Check the items.'
      ].join('\n'),
      'utf-8'
    );
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('reads tools defined as block list', async () => {
    const manager = new SkillManager();
    await manager.loadWorkspaceCustomizations(root);

    const agents = manager.getCustomAgents();
    assert.strictEqual(agents.length, 1);
    const agent = agents[0];
    assert.ok(agent, 'custom agent not found');
    assert.strictEqual(agent.name, 'Güvenlik İncelemecisi');
    assert.strictEqual(agent.role, 'reviewer');
    // Bu daha önce undefined'dı ve agent sessizce salt-okunur oluyordu.
    assert.deepStrictEqual(agent.allowedTools, ['read_file', 'git_diff', 'search_files']);
  });

  it('reads skill name and unquoted description', async () => {
    const manager = new SkillManager();
    await manager.loadWorkspaceCustomizations(root);

    const skills = manager.getSkills();
    assert.strictEqual(skills.length, 1);
    const skill = skills[0];
    assert.ok(skill, 'skill not found');
    assert.strictEqual(skill.name, 'release-checklist');
    assert.strictEqual(skill.description, 'Sürüm öncesi kontrol listesi');
  });

  it('discovers flat .agents/agents/*.md and .agents/skills/*.md without separate subdirectories', async () => {
    const flatRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-flat-'));
    try {
      const agentsDir = path.join(flatRoot, '.agents', 'agents');
      const skillsDir = path.join(flatRoot, '.agents', 'skills');
      await fs.mkdir(agentsDir, { recursive: true });
      await fs.mkdir(skillsDir, { recursive: true });

      // Direct flat files
      await fs.writeFile(
        path.join(agentsDir, 'backend-expert.md'),
        [
          '---',
          'name: backend-expert',
          'role: backend',
          'description: "API ve servis uzmanı"',
          '---',
          'Instructions'
        ].join('\n'),
        'utf-8'
      );
      await fs.writeFile(
        path.join(skillsDir, 'api-standards.md'),
        ['---', 'name: api-standards', 'description: "RESTful API kuralları"', '---', 'Instructions'].join(
          '\n'
        ),
        'utf-8'
      );

      const manager = new SkillManager();
      await manager.loadWorkspaceCustomizations(flatRoot);

      const agents = manager.getCustomAgents();
      assert.strictEqual(agents.length, 1);
      assert.strictEqual(agents[0]?.name, 'backend-expert');
      assert.strictEqual(agents[0]?.role, 'backend');
      assert.strictEqual(agents[0]?.path, path.join(agentsDir, 'backend-expert.md'));

      const skills = manager.getSkills();
      assert.strictEqual(skills.length, 1);
      assert.strictEqual(skills[0]?.name, 'api-standards');
      assert.strictEqual(skills[0]?.path, path.join(skillsDir, 'api-standards.md'));
    } finally {
      await fs.rm(flatRoot, { recursive: true, force: true });
    }
  });

  it('customizes and resets built-in agent as flat .md file', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ahi-customize-'));
    try {
      const manager = new SkillManager();
      const createdPath = await manager.customizeBuiltinAgent(tempRoot, {
        name: 'architect',
        role: 'architect',
        displayName: 'Mimar',
        description: 'Sistem mimarı',
        capability: 9,
        tier: 'core',
        tags: ['core', 'design'],
        tools: ['read_file', 'search_files'],
        instructions: {
          identity: 'Architect',
          mission: 'Design robust systems',
          chainOfThought: 'Analyze first',
          rules: ['Rule 1']
        }
      });

      assert.strictEqual(createdPath, path.join(tempRoot, '.agents', 'agents', 'architect.md'));
      const exists = await fs
        .access(createdPath)
        .then(() => true)
        .catch(() => false);
      assert.strictEqual(exists, true);

      // Verify discovery
      await manager.loadWorkspaceCustomizations(tempRoot);
      const customAgents = manager.getCustomAgents();
      assert.strictEqual(customAgents.length, 1);
      assert.strictEqual(customAgents[0]?.name, 'architect');

      // Reset
      const reset = await manager.resetBuiltinAgent(tempRoot, 'architect');
      assert.strictEqual(reset, true);
      const existsAfter = await fs
        .access(createdPath)
        .then(() => true)
        .catch(() => false);
      assert.strictEqual(existsAfter, false);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
