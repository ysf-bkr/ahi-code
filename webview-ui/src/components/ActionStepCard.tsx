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
  Loader2,
  AlertTriangle,
  Bot,
  FileDiff,
  Undo2,
  HelpCircle,
  BookOpen,
  Stethoscope
} from 'lucide-react';
import { ToolCall } from '@shared/types';
import { Button, Disclosure } from './ui';
import { vscode } from '../utils/vscode';

interface ActionStepCardProps {
  toolCall: ToolCall;
  stepNumber: number;
  isPendingApproval?: boolean;
}

const text = (value: unknown, fallback = ''): string => {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return fallback;
  return String(value);
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

  const meta = (() => {
    switch (toolCall.name) {
      case 'execute_command':
      case 'run_tests':
      case 'run_linter':
        return {
          icon: <Terminal className="h-3.5 w-3.5 text-amber-400" />,
          title:
            toolCall.name === 'run_tests'
              ? 'Testler çalıştırılıyor'
              : toolCall.name === 'run_linter'
                ? 'Kod denetleyicisi çalıştırılıyor'
                : 'Terminal komutu',
          detail: text(toolCall.args.command, 'Komut otomatik seçildi')
        };
      case 'write_file':
        return {
          icon: <FileCode className="h-3.5 w-3.5 text-emerald-400" />,
          title: 'Dosya oluşturuluyor',
          detail: text(toolCall.args.path)
        };
      case 'edit_file':
        return {
          icon: <FileDiff className="h-3.5 w-3.5 text-[var(--ahi-brand-400)]" />,
          title: 'Dosya düzenleniyor',
          detail: text(toolCall.args.path)
        };
      case 'read_file':
        return {
          icon: <FileCode className="h-3.5 w-3.5 text-indigo-400" />,
          title: 'Dosya okunuyor',
          detail: text(toolCall.args.path)
        };
      case 'list_directory':
        return {
          icon: <FolderTree className="h-3.5 w-3.5 text-teal-400" />,
          title: 'Klasör taranıyor',
          detail: text(toolCall.args.path) || '.'
        };
      case 'search_files':
        return {
          icon: <Search className="h-3.5 w-3.5 text-violet-400" />,
          title: 'Kod aranıyor',
          detail: `"${text(toolCall.args.query)}"`
        };
      case 'invoke_subagent':
        return {
          icon: <Bot className="h-3.5 w-3.5 text-pink-400" />,
          title: `Alt ajan: ${text(toolCall.args.role, 'uzman')}`,
          detail: text(toolCall.args.task)
        };
      case 'ask_followup_question':
        return {
          icon: <HelpCircle className="h-3.5 w-3.5 text-[var(--ahi-brand-400)]" />,
          title: 'Kullanıcıya soru soruluyor',
          detail: text(toolCall.args.question)
        };
      case 'read_skill':
        return {
          icon: <BookOpen className="h-3.5 w-3.5 text-teal-400" />,
          title: 'Beceri okunuyor',
          detail: text(toolCall.args.skill_name)
        };
      case 'get_diagnostics':
        return {
          icon: <Stethoscope className="h-3.5 w-3.5 text-rose-400" />,
          title: 'Tanılar inceleniyor',
          detail: text(toolCall.args.path) || 'Tüm proje'
        };
      case 'git_status':
      case 'git_diff':
        return {
          icon: <GitBranch className="h-3.5 w-3.5 text-zinc-400" />,
          title: toolCall.name === 'git_diff' ? 'Git farkı alınıyor' : 'Git durumu okunuyor',
          detail: 'Çalışma ağacı'
        };
      default:
        return {
          icon: <GitBranch className="h-3.5 w-3.5 text-zinc-400" />,
          title: toolCall.name,
          detail: ''
        };
    }
  })();

  const statusChip = (() => {
    switch (toolCall.status) {
      case 'executing':
        return (
          <span className="flex items-center gap-1 text-2xs font-medium text-[var(--ahi-brand-400)]">
            <Loader2 className="h-2.5 w-2.5 animate-spin" /> çalışıyor
          </span>
        );
      case 'completed':
        return (
          <span className="flex items-center gap-1 text-2xs font-medium text-[var(--status-success-fg,#34d399)]">
            <Check className="h-2.5 w-2.5" /> tamamlandı
          </span>
        );
      case 'error':
        return (
          <span className="flex items-center gap-1 text-2xs font-medium text-[var(--vscode-errorForeground,#f87171)]">
            <AlertTriangle className="h-2.5 w-2.5" /> hata
          </span>
        );
      case 'rejected':
        return (
          <span className="flex items-center gap-1 text-2xs font-medium text-[var(--vscode-descriptionForeground)]">
            <X className="h-2.5 w-2.5" /> reddedildi
          </span>
        );
      case 'pending':
        return (
          <span className="flex items-center gap-1 text-2xs font-medium text-amber-400">
            <AlertTriangle className="h-2.5 w-2.5" /> onay bekliyor
          </span>
        );
      case 'approved':
        return (
          <span className="flex items-center gap-1 text-2xs font-medium text-[var(--status-info-fg)]">
            <Loader2 className="h-2.5 w-2.5 animate-spin" /> onaylandı, çalıştırılıyor
          </span>
        );
      default:
        return null;
    }
  })();

  return (
    <div
      className={`overflow-hidden rounded-md border bg-[var(--vscode-sideBar-background)] transition ${
        isPendingApproval
          ? 'border-amber-500/50 shadow-sm'
          : 'border-[var(--vscode-editorWidget-border)] hover:border-[var(--vscode-focusBorder)]'
      }`}
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left transition hover:bg-[var(--vscode-list-hoverBackground)]"
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--vscode-editorWidget-background)] font-mono text-2xs font-semibold text-[var(--vscode-descriptionForeground)]">
          {stepNumber}
        </span>
        <span className="shrink-0">{meta.icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-[var(--vscode-foreground)]">
            {meta.title}
          </span>
          {meta.detail && (
            <span className="block truncate font-mono text-2xs text-[var(--vscode-descriptionForeground)]">
              {meta.detail}
            </span>
          )}
        </span>
        <span className="shrink-0">{statusChip}</span>
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 opacity-60" />
        )}
      </button>

      {toolCall.explanation && !expanded && (
        <div className="border-t border-[var(--vscode-editorWidget-border)] px-2 py-1 text-2xs text-[var(--vscode-descriptionForeground)]">
          {toolCall.explanation}
        </div>
      )}

      {expanded && (
        <div className="border-t border-[var(--vscode-editorWidget-border)] bg-[var(--vscode-textCodeBlock-background)]">
          {toolCall.explanation && (
            <div className="px-2.5 pt-1.5 text-2xs leading-relaxed text-[var(--vscode-descriptionForeground)]">
              {toolCall.explanation}
            </div>
          )}

          {toolCall.result && (
            <div className="p-2">
              <div className="mb-1 text-2xs font-semibold uppercase tracking-wider text-[var(--vscode-descriptionForeground)]">
                Çıktı
              </div>
              <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded border border-[var(--vscode-editorWidget-border)] bg-[var(--vscode-input-background)] p-2 font-mono text-2xs leading-relaxed text-[var(--vscode-editor-foreground)]">
                {toolCall.result}
              </pre>
            </div>
          )}

          {toolCall.error && (
            <div className="p-2">
              <div className="mb-1 text-2xs font-semibold uppercase tracking-wider text-[var(--vscode-errorForeground,#f87171)]">
                Hata
              </div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-[var(--vscode-errorForeground,#f87171)] bg-[var(--vscode-input-background)] p-2 font-mono text-2xs leading-relaxed text-[var(--vscode-errorForeground,#f87171)]">
                {toolCall.error}
              </pre>
            </div>
          )}

          <div className="border-t border-[var(--vscode-editorWidget-border)] px-2.5 py-1.5">
            <Disclosure summary="Parametreler">
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre rounded border border-[var(--vscode-editorWidget-border)] bg-[var(--vscode-input-background)] p-2 font-mono text-2xs text-[var(--vscode-descriptionForeground)]">
                {JSON.stringify(toolCall.args, null, 2)}
              </pre>
            </Disclosure>
          </div>

          {toolCall.status === 'completed' &&
            (toolCall.name === 'execute_command' || toolCall.name === 'run_tests') && (
              <div className="flex items-center justify-between gap-2 border-t border-[var(--vscode-editorWidget-border)] px-2 py-1.5">
                <span className="text-2xs text-[var(--ahi-muted-fg)]">
                  Komut çalıştı; dosya etkileri Git kontrol noktasından geri alınabilir.
                </span>
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() =>
                    vscode.postMessage({ type: 'REVERT_COMMAND', payload: { toolCallId: toolCall.id } })
                  }
                  title="Bu komutun oluşturduğu ve değiştirdiği dosyaları geri al"
                  icon={<Undo2 className="h-2.5 w-2.5" />}
                >
                  Komut etkisini geri al
                </Button>
              </div>
            )}

          {toolCall.status === 'completed' &&
            (toolCall.name === 'write_file' || toolCall.name === 'edit_file') && (
              <div className="flex items-center justify-end gap-1 border-t border-[var(--vscode-editorWidget-border)] px-2 py-1.5">
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() =>
                    vscode.postMessage({ type: 'SHOW_TOOL_DIFF', payload: { toolCallId: toolCall.id } })
                  }
                  title="Bu adımın dosya değişikliklerini fark olarak göster"
                  icon={<FileDiff className="h-2.5 w-2.5" />}
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
                  icon={<Undo2 className="h-2.5 w-2.5" />}
                >
                  Bu adımı geri al
                </Button>
              </div>
            )}
        </div>
      )}

      {isPendingApproval && (
        <div className="flex items-center justify-between gap-2 border-t border-amber-500/30 bg-[var(--vscode-editorWidget-background)] p-2">
          <div
            className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-amber-400"
            title={toolCall.approvalReason || 'Bu işlem onayınızı bekliyor'}
          >
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span className="truncate">{toolCall.approvalReason || 'Bu işlem onayınızı bekliyor'}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
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
              icon={<Check className="h-3 w-3" />}
            >
              Onayla
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
