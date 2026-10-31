/**
 * Tek bir araç çağrısını ana bilgisayardan bağımsız yürütür.
 *
 * VS Code olmadan çalışan yüzeyler (CLI, testler) için kapı zinciri burada
 * tek yerde tutulur: ad → yetki → argüman → engel → onay → snapshot → çalıştır.
 * Böylece CLI kendi kopyasını taşımaz ve iki yüzey aynı kuralları uygular.
 *
 * Not: Bu, `AgentCore`'un onay akışının yerine geçmez. CLI'de kullanıcıya
 * soran bir geri çağrı vardır; eklentide onay kartı `ToolPipelineController`
 * tarafından yönetilir.
 */
import { ToolCall, ToolName } from '../shared/types';
import { errorMessage } from '../shared/errors';
import { ALL_TOOLS } from '../tools';
import {
  coerceToolArguments,
  validateToolArguments,
  ToolDefinition,
  ToolExecutionContext
} from '../tools/base';
import { PermissionManager } from './permission/PermissionManager';
import { SnapshotManager } from './snapshot/SnapshotManager';
import { TaskPlanner } from './plan/TaskPlanner';
import { parsePlanUpdateInput } from '../tools/parsers';

export interface ToolRunnerOptions {
  workspaceRoot: string;
  permissionManager: PermissionManager;
  snapshotManager: SnapshotManager;
  planner?: TaskPlanner;
  context: ToolExecutionContext;
  /** İzin verilen araçlar; boşsa tüm kayıt defteri açıktır. */
  allowedTools?: ReadonlySet<ToolName>;
  /** Kullanıcıya soran onay geri çağrısı; yoksa onay gereken çağrı reddedilir. */
  approve?: (explanation: string) => Promise<boolean>;
}

/** Yürütme sonucu; `ok` yalnızca araç gerçekten çalıştıysa doğrudur. */
export interface ToolRunResult {
  ok: boolean;
  output: string;
  /** Kapı zincirinde durduysa nedeni (teşhis ve testler için). */
  stoppedAt?: 'unknown-tool' | 'disallowed' | 'arguments' | 'blocked' | 'rejected' | 'error';
}

function asToolName(name: string): ToolName {
  return name as ToolName;
}

/**
 * Bir araç çağrısını çalıştırır. Hata fırlatmaz: her durum `ToolRunResult`
 * olarak döner, böylece çağıran model mesajını her koşulda tamamlayabilir
 * (API her araç çağrısına bir yanıt bekler).
 */
export async function runToolCall(tc: ToolCall, options: ToolRunnerOptions): Promise<ToolRunResult> {
  const toolName = asToolName(tc.name);
  const tool: ToolDefinition | undefined = ALL_TOOLS[toolName];

  if (!tool)
    return { ok: false, output: `[Error]: No tool named '${tc.name}' was found.`, stoppedAt: 'unknown-tool' };
  if (options.allowedTools && !options.allowedTools.has(toolName)) {
    return {
      ok: false,
      output: `[Error]: Tool '${tc.name}' is not available here.`,
      stoppedAt: 'disallowed'
    };
  }

  const args = coerceToolArguments(tool, tc.args);
  const argError = validateToolArguments(tool, args);
  if (argError) return { ok: false, output: `[Argument Error]: ${argError}`, stoppedAt: 'arguments' };

  const blocked = options.permissionManager.isToolBlocked(toolName, args);
  if (blocked.blocked) {
    return { ok: false, output: `[Permission Error]: ${blocked.reason}`, stoppedAt: 'blocked' };
  }

  if (options.permissionManager.requiresApproval(toolName, args)) {
    const explanation = options.permissionManager.getToolExplanation(toolName, args);
    if (!options.approve || !(await options.approve(explanation))) {
      return { ok: false, output: '[Rejected]: The operation was not approved.', stoppedAt: 'rejected' };
    }
  }

  // Plan güncellemesi ajan durumuna yazılır, dosyaya değil.
  if (toolName === 'update_plan' && options.planner) {
    options.planner.update(parsePlanUpdateInput(args));
    return { ok: true, output: options.planner.formatForTool() };
  }

  // Yazma öncesi snapshot: değişiklik geri alınabilir kalmalı.
  if ((toolName === 'write_file' || toolName === 'edit_file') && typeof args.path === 'string') {
    try {
      await options.snapshotManager.createSnapshot(args.path, options.workspaceRoot, tc.id);
    } catch {
      // Snapshot alınamazsa araç kendi yol güvenliği kontrolleriyle devam eder.
    }
  }

  try {
    const output = await tool.execute(args, options.context);
    return { ok: true, output };
  } catch (err) {
    return { ok: false, output: `[Error]: ${errorMessage(err)}`, stoppedAt: 'error' };
  }
}
