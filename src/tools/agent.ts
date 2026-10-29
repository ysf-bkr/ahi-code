/**
 * "agent" grubunun araçları.
 *
 * Eski tek parça tools/index.ts'ten ayrıldı; davranış değişmedi.
 */
import { ToolDefinition } from './base';

export const invokeSubagentTool: ToolDefinition = {
  name: 'invoke_subagent',
  description:
    'Delegates the whole task to the @manager subagent. Only "manager" can be targeted at the top level; the manager picks and runs the specialists (backend, frontend, security, ...) itself.',
  parameters: {
    type: 'object',
    properties: {
      role: {
        type: 'string',
        description:
          'Subagent role to handle the task. Top level accepts only "manager"; specialists are chosen by the manager.'
      },
      task: {
        type: 'string',
        description: 'Specific task for the subagent.'
      },
      context: {
        type: 'string',
        description: 'Additional context or file paths the subagent needs to know.'
      },
      isolate: {
        type: 'boolean',
        description:
          'If true, the subagent runs in a separate Git worktree; changes are not automatically applied to the main branch.'
      }
    },
    required: ['role', 'task']
  },
  execute: async () => 'This tool is routed to the subagent orchestrator by AgentCore.'
};

export const askFollowupQuestionTool: ToolDefinition = {
  name: 'ask_followup_question',
  description: 'Asks the user a clarifying question.',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'Question to ask the user.' }
    },
    required: ['question']
  },
  execute: async (args) => `Asked the user: ${args.question}`
};

export const updatePlanTool: ToolDefinition = {
  name: 'update_plan',
  description:
    'Breaks large tasks into steps with dependencies and completion criteria, and updates plan status. Call this first for multi-step tasks and update each step as it is completed. When updating, resend every step in the current plan, including id and status.',
  parameters: {
    type: 'object',
    properties: {
      goal: {
        type: 'string',
        description: 'The task goal in one sentence.'
      },
      steps: {
        type: 'array',
        description:
          'List of steps. Each step: { id?, title, description?, status?, dependsOn?, completionCriteria?, files? }',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Unique step identifier (optional).' },
            title: { type: 'string', description: 'Step title.' },
            description: { type: 'string', description: 'Step details.' },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed', 'blocked'],
              description: 'Step status.'
            },
            dependsOn: {
              type: 'array',
              items: { type: 'string' },
              description: 'IDs of steps that must be completed before this step.'
            },
            completionCriteria: { type: 'string', description: 'Step completion criteria.' },
            files: {
              type: 'array',
              items: { type: 'string' },
              description: 'Related files.'
            },
            ownerRole: {
              type: 'string',
              description:
                'Uzman rol: manager, analyst, architect, backend, frontend, mobile, native, database, devops, explorer, git, quality, security. Boş bırakılırsa dosya ve metne göre atanır.'
            }
          },
          required: ['title']
        }
      }
    },
    required: ['steps']
  },
  execute: async () => 'The plan is updated by AgentCore.'
};

export const runParallelTasksTool: ToolDefinition = {
  name: 'run_parallel_tasks',
  description:
    'Runs multiple subagent tasks in isolated Git worktrees in parallel; returns results and diff reports.',
  parameters: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        description: 'Tasks: { role, task, context? }',
        items: {
          type: 'object',
          properties: {
            role: { type: 'string', description: 'Subagent role.' },
            task: { type: 'string', description: 'Task description.' },
            context: { type: 'string', description: 'Additional context.' }
          },
          required: ['role', 'task']
        }
      }
    },
    required: ['tasks']
  },
  execute: async () => 'Parallel tasks are run by AgentCore.'
};

export const runVerificationTool: ToolDefinition = {
  name: 'run_verification',
  description:
    'Runs project tests, lint, and type checks; reports failed steps and their output. Use to verify changes after code edits.',
  parameters: {
    type: 'object',
    properties: {},
    required: []
  },
  execute: async (_args, context) => {
    if (!context.verificationManager) {
      throw new Error('Verification manager is not ready.');
    }
    const result = await context.verificationManager.verify(context.workspaceRoot, {
      signal: context.signal
    });
    return context.verificationManager.formatForPrompt(result);
  }
};
