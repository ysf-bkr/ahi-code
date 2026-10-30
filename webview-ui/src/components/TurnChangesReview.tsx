import React from 'react';
import { Eye, FileDiff, FolderOpen, Undo2 } from 'lucide-react';
import { ToolCall } from '@shared/types';
import { Button } from './ui';
import { vscode } from '../utils/vscode';

export interface ModifiedFileItem {
  path: string;
  action: 'create' | 'edit';
  toolCallId: string;
  status: ToolCall['status'];
}

/**
 * Asistan mesajındaki araç çağrılarından dosya oluşturan veya değiştiren adımları toplar.
 * Aynı dosya birden fazla kez düzenlendiyse son işlem durumunu korur.
 */
export function extractModifiedFiles(toolCalls?: ToolCall[]): ModifiedFileItem[] {
  if (!toolCalls || toolCalls.length === 0) return [];

  const filesMap = new Map<string, ModifiedFileItem>();

  for (const tc of toolCalls) {
    if (tc.name !== 'write_file' && tc.name !== 'edit_file') {
      continue;
    }
    const path =
      typeof tc.args?.path === 'string'
        ? tc.args.path
        : typeof tc.args?.filePath === 'string'
          ? tc.args.filePath
          : '';
    if (!path) continue;

    filesMap.set(path, {
      path,
      action: tc.name === 'write_file' ? 'create' : 'edit',
      toolCallId: tc.id,
      status: tc.status
    });
  }

  return Array.from(filesMap.values());
}

interface TurnChangesReviewProps {
  toolCalls?: ToolCall[];
}

/**
 * Tur boyunca üretilen tüm dosya değişikliklerini Antigravity / Cursor tarzında tek bir
 * inceleme (review) kartında toplar ve kullanıcıya dosya bazlı ya da toplu fark inceleme olanağı sunar.
 */
export const TurnChangesReview: React.FC<TurnChangesReviewProps> = ({ toolCalls }) => {
  const files = extractModifiedFiles(toolCalls);

  if (files.length === 0) return null;

  const firstCompleted = files.find((f) => f.status === 'completed') ?? files[0];

  return (
    <div
      data-testid="turn-changes-review"
      className="mt-2 overflow-hidden rounded-lg border ahi-border-brand ahi-bg-surface"
    >
      <div className="flex items-center justify-between border-b ahi-border-surface ahi-bg-base px-2.5 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <FileDiff className="ahi-icon-sm shrink-0 ahi-text-brand" />
          <span className="ahi-title">Kod Değişiklikleri</span>
          <span className="rounded-full ahi-bg-brand-soft px-1.5 py-0.5 font-mono text-2xs font-medium ahi-text-brand">
            {files.length} {files.length === 1 ? 'dosya' : 'dosya'}
          </span>
        </div>

        {firstCompleted && (
          <Button
            size="xs"
            variant="primary"
            onClick={() =>
              vscode.postMessage({
                type: 'SHOW_TOOL_DIFF',
                payload: { toolCallId: firstCompleted.toolCallId }
              })
            }
            title="Değişiklikleri editörde fark (diff) görünümünde incele"
            icon={<Eye className="ahi-icon-xs" />}
          >
            İncele (Diff)
          </Button>
        )}
      </div>

      <div className="divide-y divide-[var(--ahi-surface-border)]">
        {files.map((file) => (
          <div
            key={`${file.toolCallId}-${file.path}`}
            className="flex items-center justify-between gap-2 px-2.5 py-1.5 transition-colors hover:bg-[var(--ahi-hover-bg)]"
          >
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-2xs font-medium ${
                  file.action === 'create'
                    ? 'border ahi-border-success ahi-bg-success ahi-text-success'
                    : 'border ahi-border-brand ahi-bg-brand-soft ahi-text-brand'
                }`}
              >
                {file.action === 'create' ? '+ Yeni' : '• Düzenlendi'}
              </span>
              <span className="min-w-0 truncate font-mono text-xs ahi-text-fg" title={file.path}>
                {file.path}
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  vscode.postMessage({
                    type: 'SHOW_TOOL_DIFF',
                    payload: { toolCallId: file.toolCallId }
                  })
                }
                title="Farkı editörde aç"
                aria-label="Farkı editörde aç"
                icon={<FileDiff className="ahi-icon-xs" />}
              >
                Fark
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  vscode.postMessage({
                    type: 'OPEN_FILE',
                    payload: { filePath: file.path }
                  })
                }
                title="Dosyayı aç"
                aria-label="Dosyayı aç"
                icon={<FolderOpen className="ahi-icon-xs" />}
              >
                Aç
              </Button>
              {file.status === 'completed' && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    vscode.postMessage({
                      type: 'REVERT_TOOL_SNAPSHOT',
                      payload: { toolCallId: file.toolCallId }
                    })
                  }
                  title="Bu dosyadaki değişikliği geri al"
                  aria-label="Bu dosyadaki değişikliği geri al"
                  icon={<Undo2 className="ahi-icon-xs" />}
                >
                  Geri al
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
