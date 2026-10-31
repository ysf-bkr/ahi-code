import React, { useEffect, useState } from 'react';
import {
  Terminal,
  FileCode,
  FolderTree,
  Search,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Globe,
  ListChecks,
  Loader2,
  AlertTriangle,
  Bot,
  FileDiff,
  Undo2,
  HelpCircle,
  BookOpen,
  Stethoscope,
  Wrench
} from 'lucide-react';
import { ToolCall, ToolName } from '@shared/types';
import { Button, Disclosure } from './ui';
import { TOOL_TITLES, subagentRoleName, toolStepDetail } from '../utils/toolLabels';
import { vscode } from '../utils/vscode';

interface ActionStepCardProps {
  toolCall: ToolCall;
  stepNumber: number;
  isPendingApproval?: boolean;
}

/** Adım simgesi: aracın kategorisini taşır; renk tonları durum jetonlarındandır. */
const toolStepIcon = (name: ToolName): React.ReactElement => {
  switch (name) {
    case 'execute_command':
    case 'run_tests':
    case 'run_linter':
    case 'run_verification':
    case 'run_parallel_tasks':
    case 'merge_worktree':
      return <Terminal className="ahi-icon-sm ahi-text-warning" />;
    case 'write_file':
      return <FileCode className="ahi-icon-sm ahi-text-success" />;
    case 'edit_file':
      return <FileDiff className="ahi-icon-sm ahi-text-brand" />;
    case 'read_file':
      return <FileCode className="ahi-icon-sm ahi-text-brand" />;
    case 'read_notebook':
      return <BookOpen className="ahi-icon-sm ahi-text-brand" />;
    case 'list_directory':
      return <FolderTree className="ahi-icon-sm ahi-text-info" />;
    case 'web_fetch':
      return <Globe className="ahi-icon-sm ahi-text-info" />;
    case 'invoke_subagent':
      return <Bot className="ahi-icon-sm ahi-text-warning" />;
    case 'ask_followup_question':
      return <HelpCircle className="ahi-icon-sm ahi-text-brand" />;
    case 'get_diagnostics':
      return <Stethoscope className="ahi-icon-sm ahi-text-error" />;
    case 'update_plan':
    case 'update_module_plan':
    case 'update_acceptance_criteria':
      return <ListChecks className="ahi-icon-sm ahi-text-brand" />;
    case 'write_spec':
    case 'read_skill':
    case 'write_knowledge_file':
    case 'add_knowledge_note':
      return <BookOpen className="ahi-icon-sm ahi-text-info" />;
    default:
      break;
  }
  if (name.startsWith('git_') || name === 'prepare_pr') {
    return <GitBranch className="ahi-icon-sm ahi-text-muted" />;
  }
  if (
    name.startsWith('get_') ||
    name.startsWith('call_graph') ||
    [
      'search_files',
      'web_search',
      'search_memory',
      'find_symbol',
      'find_related_code',
      'analyze_impact',
      'index_workspace'
    ].includes(name)
  ) {
    return <Search className="ahi-icon-sm ahi-text-brand" />;
  }
  return <Wrench className="ahi-icon-sm ahi-text-muted" />;
};

export const ActionStepCard: React.FC<ActionStepCardProps> = ({
  toolCall,
  stepNumber,
  isPendingApproval
}) => {
  const [expanded, setExpanded] = useState(toolCall.status === 'error' || Boolean(isPendingApproval));

  useEffect(() => {
    if (isPendingApproval || toolCall.status === 'error') {
      setExpanded(true);
    }
  }, [isPendingApproval, toolCall.status]);

  // Başlık ve ayrıntı artık tüm araçları kapsayan Türkçe etiket haritasından
  // gelir; ikon yalnızca aracın kategorisini taşır. Böylece hiçbir adım ham
  // İngilizce kimlikle (`update_plan` gibi) ve boş açıklamayla çizilmez.
  const meta = (() => {
    const name = toolCall.name;
    const title =
      name === 'invoke_subagent'
        ? `Alt ajan: ${subagentRoleName(toolCall.args.role)}`
        : (TOOL_TITLES[name] ?? name);
    return { icon: toolStepIcon(name), title, detail: toolStepDetail(toolCall) };
  })();

  const statusChip = (() => {
    switch (toolCall.status) {
      case 'executing':
        return (
          <span className="flex items-center gap-1 text-2xs font-medium ahi-text-brand">
            <Loader2 className="ahi-icon-xs animate-spin" /> çalışıyor
          </span>
        );
      case 'completed':
        return (
          <span className="flex items-center gap-1 text-2xs font-medium ahi-text-success">
            <Check className="ahi-icon-xs" /> tamamlandı
          </span>
        );
      case 'error':
        return (
          <span className="flex items-center gap-1 text-2xs font-medium ahi-text-error">
            <AlertTriangle className="ahi-icon-xs" /> hata
          </span>
        );
      case 'rejected':
        return (
          <span className="flex items-center gap-1 text-2xs font-medium ahi-text-muted">
            <X className="ahi-icon-xs" /> reddedildi
          </span>
        );
      case 'pending':
        return (
          <span className="flex items-center gap-1 text-2xs font-medium ahi-text-warning">
            <AlertTriangle className="ahi-icon-xs" /> onay bekliyor
          </span>
        );
      case 'approved':
        return (
          <span className="flex items-center gap-1 text-2xs font-medium ahi-text-info">
            <Loader2 className="ahi-icon-xs animate-spin" /> onaylandı, çalıştırılıyor
          </span>
        );
      default:
        return null;
    }
  })();

  return (
    <div
      className={`overflow-hidden rounded-md border ahi-bg-base transition ${
        isPendingApproval
          ? 'ahi-border-warning ahi-shadow-sm'
          : 'ahi-border-surface hover:border-[var(--ahi-focus)]'
      }`}
    >
      {/* Başlık düğmesi ve Diff kısayolu yan yana: düğme içinde düğme geçersiz HTML. */}
      <div className="flex w-full items-center">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left transition hover:bg-[var(--ahi-hover-bg)]"
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full ahi-bg-raised font-mono text-2xs font-semibold ahi-text-muted">
            {stepNumber}
          </span>
          <span className="shrink-0">{meta.icon}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium ahi-text-fg">{meta.title}</span>
            {meta.detail && (
              <span className="block truncate font-mono text-2xs ahi-text-muted">{meta.detail}</span>
            )}
          </span>
          <span className="shrink-0">{statusChip}</span>
        </button>
        {toolCall.status === 'completed' &&
          (toolCall.name === 'write_file' || toolCall.name === 'edit_file') && (
            <button
              type="button"
              onClick={() =>
                vscode.postMessage({ type: 'SHOW_TOOL_DIFF', payload: { toolCallId: toolCall.id } })
              }
              className="mr-2 flex shrink-0 items-center gap-1 rounded border ahi-border-brand ahi-bg-brand-soft px-1.5 py-0.5 font-mono text-2xs font-medium ahi-text-brand transition hover:bg-[var(--ahi-brand-soft)] hover:text-[var(--ahi-fg)]"
              title="Değişiklikleri fark (diff) görünümünde incele ve düzenle"
            >
              <FileDiff className="ahi-icon-xs" />
              Diff
            </button>
          )}
        <span className="shrink-0 pr-2">
          {expanded ? (
            <ChevronDown className="ahi-icon-xs shrink-0 opacity-60" />
          ) : (
            <ChevronRight className="ahi-icon-xs shrink-0 opacity-60" />
          )}
        </span>
      </div>

      {toolCall.explanation && !expanded && (
        <div className="border-t ahi-border-surface px-2 py-1 text-2xs ahi-text-muted">
          {toolCall.explanation}
        </div>
      )}

      {expanded && (
        <div className="border-t ahi-border-surface ahi-bg-code">
          {toolCall.explanation && (
            <div className="px-2.5 pt-1.5 text-2xs leading-relaxed ahi-text-muted">
              {toolCall.explanation}
            </div>
          )}

          {toolCall.result && (
            <div className="p-2">
              <div className="mb-1 ahi-overline ahi-text-muted">Çıktı</div>
              <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded border ahi-border-surface ahi-bg-input p-2 font-mono text-2xs leading-relaxed ahi-text-fg">
                {toolCall.result}
              </pre>
            </div>
          )}

          {toolCall.error && (
            <div className="p-2">
              <div className="mb-1 ahi-overline ahi-text-error">Hata</div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border ahi-border-error ahi-bg-input p-2 font-mono text-2xs leading-relaxed ahi-text-error">
                {toolCall.error}
              </pre>
            </div>
          )}

          <div className="border-t ahi-border-surface px-2.5 py-1.5">
            <Disclosure summary="Parametreler">
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre rounded border ahi-border-surface ahi-bg-input p-2 font-mono text-2xs ahi-text-muted">
                {JSON.stringify(toolCall.args, null, 2)}
              </pre>
            </Disclosure>
          </div>

          {toolCall.status === 'completed' &&
            (toolCall.name === 'execute_command' || toolCall.name === 'run_tests') && (
              <div className="flex items-center justify-between gap-2 border-t ahi-border-surface px-2 py-1.5">
                <span className="text-2xs ahi-text-muted">
                  Komut çalıştı; dosya etkileri Git kontrol noktasından geri alınabilir.
                </span>
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() =>
                    vscode.postMessage({ type: 'REVERT_COMMAND', payload: { toolCallId: toolCall.id } })
                  }
                  title="Bu komutun oluşturduğu ve değiştirdiği dosyaları geri al"
                  icon={<Undo2 className="ahi-icon-xs" />}
                >
                  Komut etkisini geri al
                </Button>
              </div>
            )}

          {toolCall.status === 'completed' &&
            (toolCall.name === 'write_file' || toolCall.name === 'edit_file') && (
              <div className="flex items-center justify-end gap-1 border-t ahi-border-surface px-2 py-1.5">
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() =>
                    vscode.postMessage({ type: 'SHOW_TOOL_DIFF', payload: { toolCallId: toolCall.id } })
                  }
                  title="Bu adımın dosya değişikliklerini fark olarak göster"
                  icon={<FileDiff className="ahi-icon-xs" />}
                >
                  Diff
                </Button>
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() =>
                    vscode.postMessage({ type: 'REVERT_TOOL_SNAPSHOT', payload: { toolCallId: toolCall.id } })
                  }
                  title="Bu dosya değişikliğini geri al"
                  icon={<Undo2 className="ahi-icon-xs" />}
                >
                  Bu adımı geri al
                </Button>
              </div>
            )}
        </div>
      )}

      {isPendingApproval && (
        <div className="flex items-center justify-between gap-2 border-t ahi-border-warning ahi-bg-raised p-2">
          <div
            className="flex min-w-0 items-center gap-1.5 text-xs font-medium ahi-text-warning"
            title={toolCall.approvalReason || 'Bu işlem onayınızı bekliyor'}
          >
            <AlertTriangle className="ahi-icon-xs shrink-0" />
            <span className="truncate">{toolCall.approvalReason || 'Bu işlem onayınızı bekliyor'}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {(toolCall.name === 'write_file' || toolCall.name === 'edit_file') && (
              <Button
                size="xs"
                variant="secondary"
                onClick={() =>
                  vscode.postMessage({ type: 'PREVIEW_TOOL_DIFF', payload: { toolCallId: toolCall.id } })
                }
                icon={<FileDiff className="ahi-icon-xs" />}
                title="Önerilen değişikliği fark (diff) görünümünde incele"
              >
                Farkı Gör
              </Button>
            )}
            <Button
              size="xs"
              variant="secondary"
              onClick={() =>
                vscode.postMessage({ type: 'REJECT_TOOL', payload: { toolCallId: toolCall.id } })
              }
            >
              Reddet
            </Button>
            <Button
              size="xs"
              variant="primary"
              onClick={() =>
                vscode.postMessage({ type: 'APPROVE_TOOL', payload: { toolCallId: toolCall.id } })
              }
              icon={<Check className="ahi-icon-xs" />}
            >
              Onayla
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
