/**
 * Markdown'ı React düğümlerine çeviren saf yardımcılar.
 *
 * `dangerouslySetInnerHTML` kullanılmaz; her şey React elemanı olarak üretilir.
 * Bu modül `Markdown` bileşeninden ayrıdır: çıktı doğrudan test edilebilir.
 */
import React from 'react';
import { Check, Copy, Info, Lightbulb, AlertTriangle, AlertCircle, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { vscode } from '../utils/vscode';

export function isSafeLink(url: string): boolean {
  try {
    const parsed = new URL(url, 'https://ahi.invalid');
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:';
  } catch {
    return false;
  }
}

interface CodeBlockProps {
  code: string;
  language?: string;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ code, language }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard
      .writeText(code)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  return (
    <div className="my-2 overflow-hidden rounded-md border border-[var(--vscode-editorWidget-border)] bg-[var(--vscode-textCodeBlock-background)] shadow-xs">
      <div className="flex items-center justify-between border-b border-[var(--vscode-editorWidget-border)] bg-[var(--vscode-sideBarSectionHeader-background,transparent)] px-2.5 py-1">
        <span className="font-mono text-xs uppercase tracking-wider text-[var(--vscode-descriptionForeground)]">
          {language || 'kod'}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-[var(--vscode-descriptionForeground)] transition hover:bg-[var(--vscode-toolbar-hoverBackground)] hover:text-[var(--vscode-foreground)]"
          title="Kodu kopyala"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          <span>{copied ? 'Kopyalandı' : 'Kopyala'}</span>
        </button>
      </div>
      <pre className="max-h-[420px] overflow-auto p-3 font-mono text-sm leading-relaxed text-[var(--vscode-editor-foreground)]">
        <code className="whitespace-pre">{code}</code>
      </pre>
    </div>
  );
};

/** Safe inline Markdown and HTML formatter that produces React elements only. */
export function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  if (!text) return [];

  const tokenRegex =
    /(`[^`]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|~~[^~\n]+~~|\[[^\]]+\]\([^)]+\)|<kbd>[^<]+<\/kbd>|<mark>[^<]+<\/mark>|<b>[^<]+<\/b>|<i>[^<]+<\/i>|<br\s*\/?>)/g;
  const parts = text.split(tokenRegex);
  const nodes: React.ReactNode[] = [];

  parts.forEach((part, index) => {
    if (!part) return;
    const key = `${keyPrefix}-${index}`;

    if (part.startsWith('`') && part.endsWith('`')) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-[var(--vscode-textCodeBlock-background)] px-1 py-0.5 font-mono text-sm text-[var(--vscode-textPreformat-foreground,var(--vscode-foreground))] border border-[var(--vscode-editorWidget-border)]"
        >
          {part.slice(1, -1)}
        </code>
      );
      return;
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      nodes.push(
        <strong key={key} className="font-semibold text-[var(--vscode-foreground)]">
          {part.slice(2, -2)}
        </strong>
      );
      return;
    }
    if (part.startsWith('~~') && part.endsWith('~~')) {
      nodes.push(
        <s key={key} className="opacity-70">
          {part.slice(2, -2)}
        </s>
      );
      return;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      nodes.push(<em key={key}>{part.slice(1, -1)}</em>);
      return;
    }

    // Inline HTML tags rendered as styled VS Code elements instead of raw text.
    const kbdMatch = part.match(/^<kbd>([^<]+)<\/kbd>$/i);
    if (kbdMatch) {
      nodes.push(
        <kbd
          key={key}
          className="rounded border border-[var(--vscode-editorWidget-border)] bg-[var(--vscode-editor-background)] px-1.5 py-0.5 font-mono text-xs text-[var(--vscode-foreground)] shadow-xs"
        >
          {kbdMatch[1]}
        </kbd>
      );
      return;
    }
    const markMatch = part.match(/^<mark>([^<]+)<\/mark>$/i);
    if (markMatch) {
      nodes.push(
        <mark key={key} className="rounded bg-amber-400/20 px-1 py-0.5 text-[var(--vscode-foreground)]">
          {markMatch[1]}
        </mark>
      );
      return;
    }
    const bMatch = part.match(/^<b>([^<]+)<\/b>$/i);
    if (bMatch) {
      nodes.push(
        <strong key={key} className="font-semibold text-[var(--vscode-foreground)]">
          {bMatch[1]}
        </strong>
      );
      return;
    }
    const iMatch = part.match(/^<i>([^<]+)<\/i>$/i);
    if (iMatch) {
      nodes.push(<em key={key}>{iMatch[1]}</em>);
      return;
    }
    if (/^<br\s*\/?>$/i.test(part)) {
      nodes.push(<br key={key} />);
      return;
    }

    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const safe = isSafeLink(link[2]);
      nodes.push(
        safe ? (
          <button
            key={key}
            type="button"
            onClick={() => vscode.postMessage({ type: 'OPEN_EXTERNAL', payload: { url: link[2] } })}
            className="inline cursor-pointer text-left text-[var(--ahi-brand-400)] underline decoration-[var(--ahi-brand-400)] underline-offset-2 hover:text-[var(--ahi-brand-300)] transition"
            title={link[2]}
          >
            {link[1]}
          </button>
        ) : (
          <span key={key} title={link[2]} className="text-[var(--vscode-descriptionForeground)]">
            {link[1]}
          </span>
        )
      );
      return;
    }
    nodes.push(<React.Fragment key={key}>{part}</React.Fragment>);
  });

  return nodes;
}

export function renderMarkdownBlocks(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;
  let quoteLines: string[] = [];
  let tableLines: string[] = [];
  let key = 0;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(
      <p
        key={`p-${key++}`}
        className="my-1.5 whitespace-pre-wrap break-words leading-relaxed first:mt-0 last:mb-0"
      >
        {renderInline(paragraph.join('\n'), `p-${key}`)}
      </p>
    );
    paragraph = [];
  };

  const flushList = () => {
    if (listItems.length === 0) return;
    const items = listItems.map((item, index) => {
      const taskMatch = item.match(/^\[([ xX])\]\s+(.*)$/);
      if (taskMatch) {
        const isChecked = taskMatch[1].toLowerCase() === 'x';
        return (
          <li key={`li-${key}-${index}`} className="my-1 flex items-start gap-2 list-none -ml-4">
            <input
              type="checkbox"
              checked={isChecked}
              readOnly
              className="mt-0.5 h-3.5 w-3.5 rounded border-[var(--vscode-checkbox-border)] bg-[var(--vscode-checkbox-background)] text-[var(--vscode-checkbox-foreground)]"
            />
            <span className={isChecked ? 'line-through opacity-75' : ''}>
              {renderInline(taskMatch[2], `li-${key}-${index}`)}
            </span>
          </li>
        );
      }
      return (
        <li key={`li-${key}-${index}`} className="my-0.5 pl-0.5">
          {renderInline(item, `li-${key}-${index}`)}
        </li>
      );
    });
    blocks.push(
      listOrdered ? (
        <ol key={`ol-${key++}`} className="my-1.5 list-decimal space-y-0.5 pl-5">
          {items}
        </ol>
      ) : (
        <ul key={`ul-${key++}`} className="my-1.5 list-disc space-y-0.5 pl-5">
          {items}
        </ul>
      )
    );
    listItems = [];
  };

  const flushQuote = () => {
    if (quoteLines.length === 0) return;
    const firstLine = quoteLines[0].trim();
    const alertMatch = firstLine.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i);
    if (alertMatch) {
      const type = alertMatch[1].toUpperCase();
      const firstLineContent = firstLine.replace(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i, '');
      const restLines = [...(firstLineContent ? [firstLineContent] : []), ...quoteLines.slice(1)].filter(
        Boolean
      );

      const alertConfigs: Record<
        string,
        { border: string; bg: string; title: string; color: string; icon: React.ReactNode }
      > = {
        NOTE: {
          border: 'border-[var(--ahi-brand-500)]',
          bg: 'bg-[var(--ahi-brand-soft)]',
          title: 'Not',
          color: 'text-[var(--ahi-brand-400)]',
          icon: <Info className="h-3.5 w-3.5 shrink-0" />
        },
        TIP: {
          border: 'border-emerald-500',
          bg: 'bg-emerald-500/10',
          title: 'Tip',
          color: 'text-emerald-400',
          icon: <Lightbulb className="h-3.5 w-3.5 shrink-0" />
        },
        IMPORTANT: {
          border: 'border-purple-500',
          bg: 'bg-purple-500/10',
          title: 'Important',
          color: 'text-purple-400',
          icon: <AlertCircle className="h-3.5 w-3.5 shrink-0" />
        },
        WARNING: {
          border: 'border-amber-500',
          bg: 'bg-amber-500/10',
          title: 'Warning',
          color: 'text-amber-400',
          icon: <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        },
        CAUTION: {
          border: 'border-rose-500',
          bg: 'bg-rose-500/10',
          title: 'Dikkat',
          color: 'text-rose-400',
          icon: <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
        }
      };

      const cfg = alertConfigs[type] || alertConfigs.NOTE;
      blocks.push(
        <div
          key={`alert-${key++}`}
          className={`my-2 rounded-md border-l-4 ${cfg.border} ${cfg.bg} p-2.5 text-xs shadow-xs`}
        >
          <div className={`mb-1 flex items-center gap-1.5 font-semibold ${cfg.color}`}>
            {cfg.icon}
            <span>{cfg.title}</span>
          </div>
          <div className="space-y-1 text-[var(--vscode-foreground)] leading-relaxed">
            {renderInline(restLines.join('\n'), `alert-${key}`)}
          </div>
        </div>
      );
      quoteLines = [];
      return;
    }

    blocks.push(
      <blockquote
        key={`q-${key++}`}
        className="my-2 border-l-2 border-[var(--ahi-brand-400)] bg-[var(--vscode-textBlockQuote-background,transparent)] px-2.5 py-1 text-[var(--vscode-descriptionForeground)]"
      >
        {renderInline(quoteLines.join('\n'), `q-${key}`)}
      </blockquote>
    );
    quoteLines = [];
  };

  const flushTable = () => {
    if (tableLines.length < 2) {
      if (tableLines.length === 1) {
        paragraph.push(tableLines[0]);
      }
      tableLines = [];
      return;
    }

    const parseRow = (line: string): string[] => {
      const trimmed = line.trim();
      const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '');
      return inner.split('|').map((s) => s.trim());
    };

    const headerRow = parseRow(tableLines[0]);
    const delimiterRow = parseRow(tableLines[1]);

    const isDelimiter = delimiterRow.length > 0 && delimiterRow.every((c) => /^:?-+:?$/.test(c));
    if (!isDelimiter) {
      paragraph.push(...tableLines);
      tableLines = [];
      return;
    }

    const alignments = delimiterRow.map((cell) => {
      if (cell.startsWith(':') && cell.endsWith(':')) return 'center';
      if (cell.endsWith(':')) return 'right';
      return 'left';
    });

    const dataRows = tableLines.slice(2).map(parseRow);

    blocks.push(
      <div
        key={`table-wrapper-${key++}`}
        className="my-2 overflow-x-auto rounded border border-[var(--vscode-editorWidget-border)] shadow-xs"
      >
        <table className="w-full border-collapse text-left text-sm">
          <thead className="border-b border-[var(--vscode-editorWidget-border)] bg-[var(--vscode-sideBarSectionHeader-background,transparent)]">
            <tr>
              {headerRow.map((col, idx) => (
                <th
                  key={`th-${idx}`}
                  style={{ textAlign: (alignments[idx] as React.CSSProperties['textAlign']) || 'left' }}
                  className="px-2.5 py-1.5 font-semibold text-[var(--vscode-foreground)]"
                >
                  {renderInline(col, `th-${key}-${idx}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--vscode-editorWidget-border)]">
            {dataRows.map((row, rIdx) => (
              <tr
                key={`tr-${rIdx}`}
                className="hover:bg-[var(--vscode-list-hoverBackground,transparent)] transition"
              >
                {headerRow.map((_, cIdx) => (
                  <td
                    key={`td-${rIdx}-${cIdx}`}
                    style={{ textAlign: (alignments[cIdx] as React.CSSProperties['textAlign']) || 'left' }}
                    className="px-2.5 py-1 text-[var(--vscode-foreground)]"
                  >
                    {renderInline(row[cIdx] || '', `td-${key}-${rIdx}-${cIdx}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    tableLines = [];
  };

  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
    flushTable();
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Detect collapsible details/summary blocks.
    if (/^\s*<details>/i.test(line)) {
      flushAll();
      let summaryText = 'Detaylar';
      const bodyLines: string[] = [];
      i++;
      while (i < lines.length && !/<\/details>/i.test(lines[i])) {
        const sumMatch = lines[i].match(/<summary>(.*?)<\/summary>/i);
        if (sumMatch) {
          summaryText = sumMatch[1];
        } else {
          bodyLines.push(lines[i]);
        }
        i++;
      }
      blocks.push(
        <details
          key={`details-${key++}`}
          className="my-2 rounded-md border border-[var(--vscode-editorWidget-border)] bg-[var(--vscode-sideBar-background)] p-2 shadow-xs group"
        >
          <summary className="cursor-pointer font-medium text-[var(--vscode-foreground)] select-none text-xs flex items-center gap-1.5 transition hover:text-[var(--ahi-brand-400)]">
            <ChevronDown className="h-3 w-3 shrink-0 transition-transform group-open:rotate-180" />
            <span>{renderInline(summaryText, `summary-${key}`)}</span>
          </summary>
          <div className="mt-2 border-t border-[var(--vscode-editorWidget-border)] pt-2 space-y-1">
            {renderMarkdownBlocks(bodyLines.join('\n'))}
          </div>
        </details>
      );
      i++;
      continue;
    }

    // Detect Markdown table rows (lines that start with or contain |).
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushParagraph();
      flushList();
      flushQuote();
      tableLines.push(line);
      i++;
      continue;
    } else if (tableLines.length > 0) {
      flushTable();
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushAll();
      const level = Math.min(6, Math.max(1, heading[1].length));
      // Visual weight decreases with depth, matching the semantic level.
      const sizeClass =
        level === 1
          ? 'text-base font-semibold mt-3 mb-1.5'
          : level === 2
            ? 'text-sm font-semibold mt-3 mb-1.5'
            : level === 3
              ? 'text-xs font-semibold mt-2.5 mb-1'
              : 'text-xs font-semibold mt-2 mb-1';
      const HeadingTag = `h${level}` as keyof React.JSX.IntrinsicElements;
      blocks.push(
        <HeadingTag key={`h-${key++}`} className={`${sizeClass} text-[var(--vscode-foreground)]`}>
          {renderInline(heading[2], `h-${key}`)}
        </HeadingTag>
      );
      i++;
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flushAll();
      blocks.push(<hr key={`hr-${key++}`} className="my-2.5 border-[var(--vscode-editorWidget-border)]" />);
      i++;
      continue;
    }

    const unordered = line.match(/^\s*[-*+]\s+(.*)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (unordered || ordered) {
      flushParagraph();
      flushQuote();
      const isOrdered = Boolean(ordered);
      if (listItems.length > 0 && listOrdered !== isOrdered) {
        flushList();
      }
      listOrdered = isOrdered;
      listItems.push((unordered || ordered)![1]);
      i++;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flushParagraph();
      flushList();
      quoteLines.push(line.replace(/^\s*>\s?/, ''));
      i++;
      continue;
    }

    if (!line.trim()) {
      flushAll();
      i++;
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(line);
    i++;
  }

  flushAll();
  return blocks;
}
