/**
 * "agent" grubunun araçları.
 *
 * Eski tek parça tools/index.ts'ten ayrıldı; davranış değişmedi.
 */
import { ToolDefinition } from './base';

export const invokeSubagentTool: ToolDefinition = {
  name: 'invoke_subagent',
  description:
    'Delegates a focused unit of work to a specialist subagent. Use the step ownerRole as the role (@backend, @frontend, @security, ...). Use role "manager" when several specialists must be coordinated; parallel independent work can run with run_parallel_tasks.',
  parameters: {
    type: 'object',
    properties: {
      role: {
        type: 'string',
        description:
          'Subagent role: manager, analyst, architect, backend, frontend, mobile, native, database, devops, explorer, git, quality, security.'
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
    'Breaks the approved module map into concrete steps with dependencies, module ownership and acceptance criteria, and updates plan status. Call this after update_module_plan. When updating, resend every step in the current plan, including id and status.',
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
            moduleId: {
              type: 'string',
              description:
                'Id of the module from update_module_plan this step belongs to. Steps may only touch files inside that module.'
            },
            criteria: {
              type: 'array',
              items: { type: 'string' },
              description: 'Acceptance criteria ids this step satisfies (for example "ac-1").'
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

export const updateModulePlanTool: ToolDefinition = {
  name: 'update_module_plan',
  description:
    'Splits the project into layered modules before planning any code: which layer each module belongs to, which paths it owns, its single responsibility, dependencies and owning specialist. Required after the spec is approved and before update_plan. ' +
    'Layers: shared, domain, infrastructure, application, interface, test, docs. Dependencies must point toward the domain (interface -> application -> domain; infrastructure and shared sit below).',
  parameters: {
    type: 'object',
    properties: {
      goal: { type: 'string', description: 'The task goal in one sentence.' },
      modules: {
        type: 'array',
        description:
          'Modules: { id?, name, layer, paths, responsibility, dependsOn?, ownerRole?, criteria? }',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Stable module id (optional, derived from the name).' },
            name: { type: 'string', description: 'Human readable module name.' },
            layer: {
              type: 'string',
              enum: ['shared', 'domain', 'infrastructure', 'application', 'interface', 'test', 'docs'],
              description: 'Architectural layer of the module.'
            },
            paths: {
              type: 'array',
              items: { type: 'string' },
              description: 'Workspace-relative files or directories this module owns.'
            },
            responsibility: {
              type: 'string',
              description: 'One line describing what this module is responsible for.'
            },
            dependsOn: {
              type: 'array',
              items: { type: 'string' },
              description: 'Ids of modules this module uses. Lower layers only.'
            },
            ownerRole: {
              type: 'string',
              description:
                'Specialist role that writes this module: manager, analyst, architect, backend, frontend, mobile, native, database, devops, explorer, git, quality, security.'
            },
            criteria: {
              type: 'array',
              items: { type: 'string' },
              description: 'Acceptance criteria ids this module satisfies (for example "ac-1").'
            }
          },
          required: ['name', 'layer', 'paths', 'responsibility']
        }
      }
    },
    required: ['modules']
  },
  execute: async () => 'The module plan is updated by AgentCore.'
};

export const runParallelTasksTool: ToolDefinition = {
  name: 'run_parallel_tasks',
  description:
    'Runs multiple subagent tasks in isolated Git worktrees in parallel; returns results and diff reports. ' +
    'A task starts only when every task listed in its dependsOn has completed successfully; ' +
    'tasks with no dependencies between them run concurrently. Give each task a stable id and list dependsOn ids.',
  parameters: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        description: 'Tasks: { id?, role, task, context?, dependsOn? }',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Stable task id (for example "t1"); used by dependsOn.' },
            role: { type: 'string', description: 'Subagent role.' },
            task: { type: 'string', description: 'Task description.' },
            context: { type: 'string', description: 'Additional context.' },
            dependsOn: {
              type: 'array',
              items: { type: 'string' },
              description: 'Ids of tasks that must complete successfully before this task starts.'
            }
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
