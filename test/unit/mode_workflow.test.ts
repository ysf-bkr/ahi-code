import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  INTAKE_MODE_TOOLS,
  filterToolsForMode,
  isToolAllowed,
  isToolAllowedInMode
} from '@ahicode/core/core/agent/modeTools';
import { ALL_TOOLS } from '@ahicode/core/tools';
import { ToolName } from '@ahicode/core/shared/types';

describe('modeTools: plan mode lock', () => {
  it('plan mode blocks write and command tools', () => {
    for (const tool of [
      'write_file',
      'edit_file',
      'execute_command',
      'run_tests',
      'run_linter'
    ] as ToolName[]) {
      assert.strictEqual(isToolAllowedInMode(tool, 'plan'), false, tool);
    }
  });

  it('plan mode allows read tools', () => {
    for (const tool of ['read_file', 'search_files', 'git_status', 'get_project_knowledge'] as ToolName[]) {
      assert.strictEqual(isToolAllowedInMode(tool, 'plan'), true, tool);
    }
  });
});

describe('modeTools: workflow lock', () => {
  it('before spec approval only opens read and spec tools', () => {
    const allowed = Object.values(ALL_TOOLS).filter((tool) =>
      isToolAllowed(tool.name, 'code', { workflowReadOnly: true, allowCommands: false })
    );
    const names = allowed.map((tool) => tool.name);

    assert.ok(names.includes('write_spec'), 'write_spec intake aşamasında açık olmalı');
    assert.ok(names.includes('get_project_knowledge'));
    assert.ok(names.includes('read_file'));
    assert.ok(!names.includes('write_file'), 'write_file must be disabled during the intake stage');
    assert.ok(!names.includes('execute_command'));
    assert.ok(!names.includes('git_commit'));
  });

  it('INTAKE_MODE_TOOLS does not contain mutating tools', () => {
    // Komut çalıştırabilen veya rastgele dosyaları değiştirebilen araçlar;
    // plan onaylanana kadar kilitli kalmalı.
    const mutating: ToolName[] = [
      'write_file',
      'edit_file',
      'undo_change',
      'git_create_branch',
      'git_commit',
      'merge_worktree',
      'run_parallel_tasks',
      'run_tests',
      'run_linter',
      'run_verification',
      'execute_command'
    ];
    for (const tool of mutating) {
      assert.strictEqual(INTAKE_MODE_TOOLS.has(tool), false, tool);
    }
  });

  it('removes command tools when command permission off', () => {
    const names = filterToolsForMode(Object.values(ALL_TOOLS), 'code', {
      workflowReadOnly: false,
      allowCommands: false
    }).map((tool) => tool.name);

    assert.ok(!names.includes('execute_command'));
    assert.ok(!names.includes('run_verification'));
    assert.ok(names.includes('write_file'));
  });

  it('all tools open in build stage', () => {
    const names = filterToolsForMode(Object.values(ALL_TOOLS), 'code', {
      workflowReadOnly: false,
      allowCommands: true
    }).map((tool) => tool.name);
    assert.ok(names.includes('write_file'));
    assert.ok(names.includes('execute_command'));
  });

  it('plan mode restricts independently of workflow lock', () => {
    const names = filterToolsForMode(Object.values(ALL_TOOLS), 'plan', {
      workflowReadOnly: false,
      allowCommands: true
    }).map((tool) => tool.name);
    assert.ok(!names.includes('write_file'));
    assert.ok(!names.includes('execute_command'));
    // Spec çıktıları ve bilgi notlarına izin verilir; proje kaynağına hiç dokunmazlar.
    assert.ok(names.includes('write_spec'));
  });
});
