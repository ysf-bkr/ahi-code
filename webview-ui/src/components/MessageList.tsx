import React, { useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  Terminal,
  FileSearch,
  Bug,
  Copy,
  Check,
  Layers,
  ShieldCheck,
  Plug,
  Bot,
  Pencil,
  Undo2
} from 'lucide-react';
import { ChatMessage, CheckpointSummary, ToolCall } from '@shared/types';
import { Button, Disclosure, ListButton } from './ui';
import { vscode } from '../utils/vscode';
import { ActionStepCard } from './ActionStepCard';
import { Logo } from './Logo';
import { Markdown } from './Markdown';
import { MessageError, MessageStatus } from './MessageStatus';

interface MessageListProps {
  messages: ChatMessage[];
  pendingToolCall?: ToolCall;
  checkpoints?: CheckpointSummary[];
  onEditMessage?: (content: string) => void;
  onSuggestionClick?: (prompt: string) => void;
}

const formatTime = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

const QUICK_ACTIONS = [
  {
    icon: <FileSearch className="h-4 w-4 text-[var(--ahi-brand-400)]" />,
    title: 'Projeyi analiz et',
    desc: 'Mimariyi ve dosya yapısını incele',
    prompt:
      'Projenin mimarisini, klasör yapısını ve bağımlılıklarını incele; eksik veya riskli alanları bildir.'
  },
  {
    icon: <Bug className="h-4 w-4 text-amber-400" />,
    title: 'Hataları bul ve düzelt',
    desc: 'Derleme, test ve tip hatalarını gider',
    prompt: 'Projede derleme, test ve tip hatalarını bul; nedenlerini analiz edip düzelt.'
  },
  {
    icon: <ShieldCheck className="h-4 w-4 text-emerald-400" />,
    title: 'Güvenlik incelemesi',
    desc: 'Riskli kodu ve izinleri denetle',
    prompt:
      'Kod tabanını güvenlik sorunları açısından incele; riskli örüntüleri ve izin sorunlarını bildir, mümkün olanları düzelt.'
  },
  {
    icon: <Terminal className="h-4 w-4 text-violet-400" />,
    title: 'Testleri çalıştır',
    desc: 'Testleri çalıştır ve hataları gider',
    prompt: 'Proje testlerini çalıştır; başarısız testleri ve hata mesajlarını analiz edip düzelt.'
  }
];

const CAPABILITIES = [
  { icon: <Sparkles className="h-3 w-3" />, label: 'Otonom ReAct' },
  { icon: <Plug className="h-3 w-3" />, label: 'MCP' },
  { icon: <Layers className="h-3 w-3" />, label: 'LSP' },
  { icon: <Bot className="h-3 w-3" />, label: 'Alt ajanlar' }
];

const CopyMessageButton: React.FC<{ content: string }> = ({ content }) => {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      variant="ghost"
      size="xs"
      onClick={() => {
        navigator.clipboard
          .writeText(content)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => {});
      }}
      aria-label={copied ? 'Yanıt kopyalandı' : 'Yanıtı kopyala'}
      title={copied ? 'Yanıt kopyalandı' : 'Yanıtı kopyala'}
      icon={
        copied ? (
          <Check className="h-3 w-3 text-emerald-400" />
        ) : (
          <Copy className="h-3 w-3" aria-hidden="true" />
        )
      }
    >
      <span>{copied ? 'Kopyalandı' : 'Kopyala'}</span>
    </Button>
  );
};

const EmptyState: React.FC<{ onSuggestionClick?: (prompt: string) => void }> = ({ onSuggestionClick }) => (
  <div className="flex h-full flex-col justify-between gap-4 p-3">
    <div className="space-y-5 pt-2">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="ahi-avatar-soft flex h-10 w-10 items-center justify-center rounded-full border text-[var(--ahi-brand-400)]">
          <Logo className="h-5 w-5" colored />
        </div>
        <div>
          <h1 className="text-sm font-semibold tracking-tight text-[var(--vscode-foreground)]">AhiCode</h1>
          <p className="mt-0.5 max-w-[260px] text-sm leading-relaxed text-[var(--vscode-descriptionForeground)]">
            Ahilik zanaat disiplini ve mühendislik titizliğiyle projenizi inceleyen, kod yazan, testleri
            çalıştıran ve hataları düzelten yazılım ajanı.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-1">
          {CAPABILITIES.map((cap) => (
            <span
              key={cap.label}
              className="flex items-center gap-1 rounded-full border border-[var(--vscode-editorWidget-border)] bg-[var(--vscode-editorWidget-background)] px-2 py-0.5 text-2xs text-[var(--vscode-descriptionForeground)]"
            >
              {cap.icon}
              {cap.label}
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="px-1 text-2xs font-semibold uppercase tracking-[0.14em] text-[var(--vscode-descriptionForeground)]">
          Hızlı başlangıç
        </div>
        <div className="grid grid-cols-1 gap-1.5">
          {QUICK_ACTIONS.map((item) => (
            <ListButton
              key={item.title}
              onClick={() => onSuggestionClick?.(item.prompt)}
              icon={item.icon}
              title={item.title}
              description={item.desc}
            />
          ))}
        </div>
      </div>
    </div>

    <div className="flex items-center gap-2 rounded-md border border-[var(--vscode-editorWidget-border)] bg-[var(--vscode-editorWidget-background)] px-2.5 py-2 text-xs text-[var(--vscode-descriptionForeground)]">
      <Terminal className="h-3 w-3 shrink-0 text-emerald-400" />
      <span>Dosya, terminal ve LSP araçlarını kullanabilir. Değişiklikler onayınıza sunulur.</span>
    </div>
  </div>
);

/**
 * Bu mesajın başladığı turda alınan checkpoint.
 *
 * Checkpoint önizlemesi kullanıcı mesajının ilk 40 karakteridir; bu yüzden
 * önizlemesi eşleşen en eski checkpoint bu mesaja aittir. Oraya geri sarmak,
 * mesaj gönderildikten sonra ajanın yaptığı her şeyi geri alır.
 */
function findCheckpointForMessage(
  message: ChatMessage,
  checkpoints?: CheckpointSummary[]
): CheckpointSummary | undefined {
  if (!checkpoints || checkpoints.length === 0) return undefined;
  const preview = message.content.slice(0, 40);
  if (!preview.trim()) return undefined;
  return checkpoints
    .filter(
      (checkpoint) => checkpoint.preview === preview && checkpoint.timestamp >= message.timestamp - 1000
    )
    .sort((a, b) => a.timestamp - b.timestamp)[0];
}

interface UserMessageProps {
  message: ChatMessage;
  checkpoints?: CheckpointSummary[];
  onEdit?: (content: string) => void;
}

const UserMessage: React.FC<UserMessageProps> = ({ message, checkpoints, onEdit }) => {
  const [copied, setCopied] = useState(false);
  // İki adımlı satır içi onay. VS Code webview'leri `allow-modals` olmadan
  // korumalı alanda çalışır; bu yüzden `window.confirm()` hiçbir iletişim
  // kutusu göstermez ve her zaman false döner — düğme ölü görünüyordu.
  const [confirmRewind, setConfirmRewind] = useState(false);
  const checkpoint = findCheckpointForMessage(message, checkpoints);

  const copy = () => {
    navigator.clipboard
      .writeText(message.content)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  const requestRewind = () => {
    if (!checkpoint) return;
    if (!confirmRewind) {
      setConfirmRewind(true);
      setTimeout(() => setConfirmRewind(false), 3000);
      return;
    }
    setConfirmRewind(false);
    vscode.postMessage({
      type: 'REWIND_TO_CHECKPOINT',
      payload: { checkpointId: checkpoint.id }
    });
  };

  return (
    <div className="group/user flex flex-col items-end">
      <div className="ahi-user-bubble max-w-[94%] rounded-lg rounded-tr-sm border px-3 py-2">
        <div className="mb-1 flex items-center justify-end gap-2 text-2xs font-medium uppercase tracking-wider text-[var(--vscode-descriptionForeground)]">
          <span>Sen</span>
        </div>
        <div className="whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--vscode-foreground)]">
          {message.content}
        </div>
      </div>

      {/* Zaman ve mesaj başına eylemler balonun altında durur; böylece sohbet
          okunabilir kalır. Üzerine gelince görünür ve Tab ile erişilebilir. */}
      <div className="text-2xs mt-0.5 flex items-center gap-1 pr-0.5 text-[var(--vscode-descriptionForeground)] opacity-0 transition group-hover/user:opacity-100 focus-within:opacity-100">
        <span className="font-mono">{formatTime(message.timestamp)}</span>
        <Button
          variant="ghost"
          size="xs"
          onClick={copy}
          aria-label={copied ? 'Mesaj kopyalandı' : 'Mesajı kopyala'}
          title={copied ? 'Mesaj kopyalandı' : 'Mesajı kopyala'}
          icon={
            copied ? (
              <Check className="h-2.5 w-2.5 text-emerald-400" />
            ) : (
              <Copy className="h-2.5 w-2.5" aria-hidden="true" />
            )
          }
        >
          {copied ? 'Kopyalandı' : 'Kopyala'}
        </Button>
        {onEdit && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => onEdit(message.content)}
            aria-label="Mesajı düzenle ve yeniden gönder"
            title="Mesajı düzenle ve yeniden gönder"
            icon={<Pencil className="h-2.5 w-2.5" aria-hidden="true" />}
          >
            Düzenle
          </Button>
        )}
        {checkpoint && (
          <Button
            variant="ghost"
            size="xs"
            onClick={requestRewind}
            aria-label="Bu mesajdan sonraki değişiklikleri geri al"
            title="Bu mesajdan sonraki değişiklikleri geri al"
            className={confirmRewind ? 'text-rose-400' : ''}
            icon={<Undo2 className="h-2.5 w-2.5" aria-hidden="true" />}
          >
            {confirmRewind ? 'Emin misin?' : 'Geri al'}
          </Button>
        )}
      </div>
    </div>
  );
};

const SystemMessage: React.FC<{ message: ChatMessage }> = ({ message }) => (
  <Disclosure
    summary="Bağlam özeti"
    className="ahi-soft-card rounded-md border border-dashed border-[var(--vscode-editorWidget-border)] px-2.5 py-1.5"
  >
    <div className="mt-1.5 border-t border-[var(--vscode-editorWidget-border)] pt-1.5 opacity-90">
      <Markdown content={message.content} />
    </div>
  </Disclosure>
);

const AssistantMessage: React.FC<{
  message: ChatMessage;
  pendingToolCall?: ToolCall;
}> = ({ message, pendingToolCall }) => {
  const hasBody = Boolean(message.content) || Boolean(message.isStreaming);
  const hasTools = Boolean(message.toolCalls?.length);

  return (
    <div className="group/msg flex items-start gap-2">
      <div className="ahi-avatar-soft mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[var(--ahi-brand-400)]">
        <Logo
          className={`h-3.5 w-3.5 ${message.isStreaming ? 'animate-spin [animation-duration:2.5s]' : ''}`}
        />
      </div>

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[var(--vscode-foreground)]">AhiCode</span>
          <span className="font-mono text-2xs text-[var(--vscode-descriptionForeground)] opacity-70">
            {formatTime(message.timestamp)}
          </span>
          <MessageStatus message={message} />
          <span className="ml-auto">
            {message.content && <CopyMessageButton content={message.content} />}
          </span>
        </div>

        {hasBody && (
          <div className="rounded-lg rounded-tl-sm border border-[var(--vscode-editorWidget-border)] bg-[var(--vscode-editorWidget-background)] px-3 py-2">
            <Markdown content={message.content} isStreaming={message.isStreaming} />
          </div>
        )}

        {message.error && <MessageError error={message.error} />}

        {hasTools && (
          <div className="ml-1 space-y-1 border-l border-[var(--vscode-editorWidget-border)] pl-2">
            <div className="flex items-center gap-1.5 px-0.5 text-2xs font-semibold uppercase tracking-wider text-[var(--vscode-descriptionForeground)]">
              <Layers className="h-2.5 w-2.5 text-[var(--ahi-brand-400)]" />
              Araç adımları
              <span className="ahi-badge-soft rounded-full px-1.5 py-0.5 font-mono text-2xs text-[var(--vscode-descriptionForeground)]">
                {message.toolCalls!.length}
              </span>
            </div>
            {message.toolCalls!.map((tc, index) => (
              <ActionStepCard
                key={tc.id}
                toolCall={tc}
                stepNumber={index + 1}
                isPendingApproval={pendingToolCall?.id === tc.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  pendingToolCall,
  checkpoints,
  onEditMessage,
  onSuggestionClick
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Yeni çıktı yalnızca kullanıcı zaten en alta yakınken takip edilsin. Önceki
  // bir yanıtı okumak için yukarı kaydırmak, her akış parçasında geri alınmamalı.
  const stickToBottom = useRef(true);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onScroll = () => {
      stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (stickToBottom.current) {
      bottomRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [messages, pendingToolCall]);

  if (messages.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EmptyState onSuggestionClick={onSuggestionClick} />
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3">
      <div className="space-y-3">
        {messages.map((msg) => (
          <div key={msg.id} className="ahi-message">
            {msg.role === 'user' ? (
              <UserMessage message={msg} checkpoints={checkpoints} onEdit={onEditMessage} />
            ) : msg.role === 'system' ? (
              <SystemMessage message={msg} />
            ) : (
              <AssistantMessage message={msg} pendingToolCall={pendingToolCall} />
            )}
          </div>
        ))}

        <div ref={bottomRef} className="h-1" />
      </div>
    </div>
  );
};
