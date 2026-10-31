/**
 * Araç kayıt defteri.
 *
 * Araç uygulamaları alan bazlı modüllerde (file, shell, git, lsp, knowledge,
 * agent); bu dosya yalnızca ajan döngüsünün kullandığı kaydı bir araya getirir.
 */
import {
  editFileTool,
  listDirectoryTool,
  readFileTool,
  readNotebookTool,
  searchFilesTool,
  writeFileTool
} from './file';
import { executeCommandTool, runLinterTool, runTestsTool } from './shell';
import {
  gitCommitTool,
  gitCreateBranchTool,
  gitDiffTool,
  gitStatusTool,
  mergeWorktreeTool,
  preparePrTool,
  undoChangeTool
} from './git';
import {
  getDefinitionTool,
  getDiagnosticsTool,
  getHoverTool,
  getReferencesTool,
  getWorkspaceSymbolsTool
} from './lsp';
import {
  readSkillTool,
  updateAcceptanceCriteriaTool,
  addKnowledgeNoteTool,
  analyzeImpactTool,
  findSymbolTool,
  getProjectKnowledgeTool,
  indexWorkspaceTool,
  searchMemoryTool,
  writeKnowledgeFileTool,
  writeSpecTool
} from './knowledge';
import {
  askFollowupQuestionTool,
  invokeSubagentTool,
  runParallelTasksTool,
  runVerificationTool,
  updateModulePlanTool,
  updatePlanTool
} from './agent';
import { webFetchTool, webSearchTool } from './web';
import {
  callGraphStatusTool,
  callGraphImpactTool,
  findRelatedTool,
  getCalleesTool,
  getCallersTool
} from './callgraph';
import { ToolDefinition } from './base';
import { ToolName } from '../shared/types';

export { argString, argBoolean, toPositiveInt } from './args';
export { readFileTool, writeFileTool, editFileTool, listDirectoryTool, searchFilesTool } from './file';
export { executeCommandTool, runShellCommand, detectTestCommand, detectLintCommand } from './shell';
export { gitStatusTool } from './git';
export { readSkillTool, updateAcceptanceCriteriaTool } from './knowledge';

const ALL_TOOL_OBJECTS: Record<ToolName, ToolDefinition> = {
  read_file: readFileTool,
  write_file: writeFileTool,
  edit_file: editFileTool,
  list_directory: listDirectoryTool,
  search_files: searchFilesTool,
  execute_command: executeCommandTool,
  run_tests: runTestsTool,
  run_linter: runLinterTool,
  git_diff: gitDiffTool,
  git_status: gitStatusTool,
  invoke_subagent: invokeSubagentTool,
  ask_followup_question: askFollowupQuestionTool,
  read_skill: readSkillTool,
  get_diagnostics: getDiagnosticsTool,
  get_definition: getDefinitionTool,
  get_hover: getHoverTool,
  update_plan: updatePlanTool,
  update_module_plan: updateModulePlanTool,
  run_verification: runVerificationTool,
  get_references: getReferencesTool,
  get_workspace_symbols: getWorkspaceSymbolsTool,
  index_workspace: indexWorkspaceTool,
  find_symbol: findSymbolTool,
  analyze_impact: analyzeImpactTool,
  git_create_branch: gitCreateBranchTool,
  git_commit: gitCommitTool,
  prepare_pr: preparePrTool,
  search_memory: searchMemoryTool,
  get_project_knowledge: getProjectKnowledgeTool,
  add_knowledge_note: addKnowledgeNoteTool,
  write_knowledge_file: writeKnowledgeFileTool,
  write_spec: writeSpecTool,
  update_acceptance_criteria: updateAcceptanceCriteriaTool,
  read_notebook: readNotebookTool,
  run_parallel_tasks: runParallelTasksTool,
  merge_worktree: mergeWorktreeTool,
  web_fetch: webFetchTool,
  web_search: webSearchTool,
  undo_change: undoChangeTool,
  get_callers: getCallersTool,
  get_callees: getCalleesTool,
  call_graph_impact: callGraphImpactTool,
  find_related_code: findRelatedTool,
  call_graph_status: callGraphStatusTool
};

export const ALL_TOOLS = ALL_TOOL_OBJECTS;
