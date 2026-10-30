import React from 'react';
import { CodeBlock, renderMarkdownBlocks } from './markdownRender';

interface MarkdownProps {
  content: string;
  isStreaming?: boolean;
}

export const Markdown: React.FC<MarkdownProps> = ({ content, isStreaming }) => {
  if (!content) {
    return isStreaming ? (
      <span className="inline-block h-3.5 w-1.5 animate-pulse rounded-sm ahi-bg-focus" />
    ) : null;
  }

  // Kod bloklarını ayır; kapanmamış olanlar dahil.
  const fenceRegex = /```([a-zA-Z0-9_+#.-]*)\s*\n?([\s\S]*?)(```|$)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let partKey = 0;

  while ((match = fenceRegex.exec(content)) !== null) {
    const before = content.slice(lastIndex, match.index);
    if (before) {
      parts.push(<React.Fragment key={`text-${partKey++}`}>{renderMarkdownBlocks(before)}</React.Fragment>);
    }

    const language = match[1]?.trim();
    const code = match[2] ?? '';
    parts.push(<CodeBlock key={`code-${partKey++}`} code={code.replace(/\n$/, '')} language={language} />);
    lastIndex = match.index + match[0].length;
  }

  const rest = content.slice(lastIndex);
  if (rest) {
    parts.push(<React.Fragment key={`text-${partKey++}`}>{renderMarkdownBlocks(rest)}</React.Fragment>);
  }

  return (
    <div className="ahi-prose">
      {parts}
      {isStreaming && (
        <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm ahi-bg-focus" />
      )}
    </div>
  );
};
