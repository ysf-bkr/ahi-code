/**
 * "git" grubunun araçları.
 *
 * Eski tek parça tools/index.ts'ten ayrıldı; davranış değişmedi.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ToolDefinition } from './base';
import { argString, argBoolean, toPositiveInt } from './args';
import { formatAiDiff } from '../shared/aiDiff';

// execFile: argümanlar diziyle geçer, kabuk çalışmaz; model güdümündeki
// yol adları kabuk enjeksiyonuna dönüşemez.
const execFileAsync = promisify(execFile);

export const gitStatusTool: ToolDefinition = {
  name: 'git_status',
  description: 'Shows the status of modified and untracked files in the Git repository.',
  parameters: {
    type: 'object',
    properties: {},
    required: []
  },
  execute: async (_args, context) => {
    if (!context.workspaceRoot) {
      throw new Error('Workspace not found.');
    }
    const { stdout } = await execFileAsync('git', ['status', '-s'], { cwd: context.workspaceRoot });
    return stdout || 'Working tree is clean (no changes).';
  }
};

export const gitDiffTool: ToolDefinition = {
  name: 'git_diff',
  description:
    'Shows an AI-optimized, token-efficient Git diff of working tree or staged changes. Automatically collapses noisy lockfiles and redundant headers to save context tokens. Supports path filtering, staged mode, and compact toggle.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'Optional file or folder path to limit the diff (e.g. "src/tools/git.ts"). Saves significant tokens.'
      },
      staged: {
        type: 'boolean',
        description: 'If true, shows staged/cached changes (git diff --cached). Default: false.'
      },
      compact: {
        type: 'boolean',
        description:
          'If true (default), returns an AI-optimized compact diff with collapsed lockfiles and minimal headers. Set false for raw unified diff.'
      },
      statOnly: {
        type: 'boolean',
        description: 'If true, returns only the compact file change statistics without hunk bodies.'
      },
      contextLines: {
        type: 'number',
        description: 'Number of context lines around changes (default: 1 in compact mode, 3 in raw mode).'
      }
    },
    required: []
  },
  execute: async (args, ctx) => {
    if (!ctx.workspaceRoot) {
      throw new Error('Workspace not found.');
    }
    const pathArg = args.path !== undefined ? argString(args.path).trim() : undefined;
    const staged = args.staged !== undefined ? argBoolean(args.staged) : false;
    const compact = args.compact !== undefined ? argBoolean(args.compact) : true;
    const statOnly = args.statOnly !== undefined ? argBoolean(args.statOnly) : false;
    const contextLines = args.contextLines !== undefined ? toPositiveInt(args.contextLines, 1) : undefined;

    if (ctx.gitManager) {
      return ctx.gitManager.diff(ctx.workspaceRoot, {
        path: pathArg,
        staged,
        compact,
        statOnly,
        contextLines
      });
    }

    const gitArgs = ['diff'];
    if (staged) gitArgs.push('--cached');
    gitArgs.push(`-U${contextLines ?? (compact ? 1 : 3)}`);
    if (pathArg) gitArgs.push('--', pathArg);
    const { stdout } = await execFileAsync('git', gitArgs, { cwd: ctx.workspaceRoot });
    if (!stdout.trim()) return '(No changes)';
    if (!compact) return stdout;
    return formatAiDiff(stdout, { targetPath: pathArg });
  }
};

export const gitCreateBranchTool: ToolDefinition = {
  name: 'git_create_branch',
  description: 'Creates and checks out a new Git branch. Requires user approval.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'New branch name (e.g. ahi/payment-system).' }
    },
    required: ['name']
  },
  execute: async (args, ctx) => {
    if (!ctx.gitManager || !ctx.workspaceRoot) throw new Error('Git manager is not ready.');
    return ctx.gitManager.createBranch(ctx.workspaceRoot, argString(args.name));
  }
};

export const gitCommitTool: ToolDefinition = {
  name: 'git_commit',
  description: 'Commits staged changes or all changes with the provided message. Requires user approval.',
  parameters: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Commit message.' },
      stageAll: { type: 'boolean', description: 'Stage all changes before committing (default: true).' }
    },
    required: ['message']
  },
  execute: async (args, ctx) => {
    if (!ctx.gitManager || !ctx.workspaceRoot) throw new Error('Git manager is not ready.');
    // `argBoolean` yalnızca boolean/"true" kabul eder; `!== false` karşılaştırması
    // "false" dizesini her şeyi stage'lemek olarak yorumluyordu.
    const stageAll = args.stageAll === undefined ? true : argBoolean(args.stageAll);
    if (stageAll) {
      await ctx.gitManager.stage(ctx.workspaceRoot);
    }
    return ctx.gitManager.commit(ctx.workspaceRoot, argString(args.message));
  }
};

export const preparePrTool: ToolDefinition = {
  name: 'prepare_pr',
  description:
    'Prepares a pull request description from the current branch, diff, status, and commits. Does not push or create a PR.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'PR title (optional).' },
      summary: { type: 'string', description: 'Change summary (optional).' },
      tests: { type: 'string', description: 'Test results (optional).' }
    },
    required: []
  },
  execute: async (args, ctx) => {
    if (!ctx.gitManager || !ctx.workspaceRoot) throw new Error('Git manager is not ready.');
    return ctx.gitManager.preparePrBody(ctx.workspaceRoot, {
      title: argString(args.title),
      summary: argString(args.summary),
      tests: argString(args.tests)
    });
  }
};

export const mergeWorktreeTool: ToolDefinition = {
  name: 'merge_worktree',
  description: 'Applies changes from an isolated worktree to the main workspace. Requires user approval.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Worktree path.' }
    },
    required: ['path']
  },
  execute: async () => 'Worktree merging is handled by AgentCore.'
};

export const undoChangeTool: ToolDefinition = {
  name: 'undo_change',
  description: 'Reverts the most recent file write or edit operation (Undo).',
  parameters: {
    type: 'object',
    properties: {},
    required: []
  },
  execute: async (_args, ctx) => {
    if (!ctx.snapshotManager) {
      throw new Error('Snapshot manager is not ready.');
    }
    const res = await ctx.snapshotManager.revertLast(ctx.workspaceRoot);
    return res.success ? `Succeeded: ${res.message}` : `Revert failed: ${res.message}`;
  }
};
