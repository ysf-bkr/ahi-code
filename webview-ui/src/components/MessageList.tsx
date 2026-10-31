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
  Settings,
  Undo2,
  ChevronRight
} from 'lucide-react';
import { ChatMessage, CheckpointSummary, ToolCall } from '@shared/types';
import { stripInjectedContext } from '@shared/editorContext';
import { Button, Disclosure, ListButton } from './ui';
import { vscode } from '../utils/vscode';
import { ActionStepCard } from './ActionStepCard';
import { Logo } from './Logo';
import { Markdown } from './Markdown';
import { MessageError, MessageStatus } from './MessageStatus';
import { TurnChangesReview } from './TurnChangesReview';

interface MessageListProps {
  messages: ChatMessage[];
  pendingToolCall?: ToolCall;
  checkpoints?: CheckpointSummary[];
  /** Mesaj içeriği ve kimliği; düzenleme o turdan sonrasını yeniden çalıştırır. */
  onEditMessage?: (content: string, messageId: string) => void;
  onSuggestionClick?: (prompt: string) => void;
  isConfigured?: boolean;
  onOpenSettings?: () => void;
}

const formatTime = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

const QUICK_ACTIONS = [
  {
    icon: <FileSearch className="ahi-icon-md ahi-text-brand" />,
    title: 'Projeyi analiz et',
    desc: 'Mimariyi ve dosya yapısını incele',
    prompt:
      'Projenin mimarisini, klasör yapısını ve bağımlılıklarını incele; eksik veya riskli alanları bildir.'
  },
  {
    icon: <Bug className="ahi-icon-md ahi-text-warning" />,
    title: 'Hataları bul ve düzelt',
    desc: 'Derleme, test ve tip hatalarını gider',
    prompt: 'Projede derleme, test ve tip hatalarını bul; nedenlerini analiz edip düzelt.'
  },
  {
    icon: <ShieldCheck className="ahi-icon-md ahi-text-success" />,
    title: 'Güvenlik incelemesi',
    desc: 'Riskli kodu ve izinleri denetle',
    prompt:
      'Kod tabanını güvenlik sorunları açısından incele; riskli örüntüleri ve izin sorunlarını bildir, mümkün olanları düzelt.'
  },
  {
    icon: <Terminal className="ahi-icon-md ahi-text-brand" />,
    title: 'Testleri çalıştır',
    desc: 'Testleri çalıştır ve hataları gider',
    prompt: 'Proje testlerini çalıştır; başarısız testleri ve hata mesajlarını analiz edip düzelt.'
  }
];

const CAPABILITIES = [
  { icon: <Sparkles className="ahi-icon-xs" />, label: 'Otonom ReAct' },
  { icon: <Plug className="ahi-icon-xs" />, label: 'MCP' },
  { icon: <Layers className="ahi-icon-xs" />, label: 'LSP' },
  { icon: <Bot className="ahi-icon-xs" />, label: 'Alt ajanlar' }
];

const CopyMessageButton: React.FC<{ content: string; label?: string }> = ({
  content,
  label = 'Yanıtı kopyala'
}) => {
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
      aria-label={copied ? 'Yanıt kopyalandı' : label}
      title={copied ? 'Yanıt kopyalandı' : label}
      icon={
        copied ? (
          <Check className="ahi-icon-xs ahi-text-success" />
        ) : (
          <Copy className="ahi-icon-xs" aria-hidden="true" />
        )
      }
    >
      <span>{copied ? 'Kopyalandı' : 'Kopyala'}</span>
    </Button>
  );
};

const EmptyState: React.FC<{
  onSuggestionClick?: (prompt: string) => void;
  isConfigured?: boolean;
  onOpenSettings?: () => void;
}> = ({ onSuggestionClick, isConfigured = true, onOpenSettings }) => (
  <div className="flex h-full flex-col justify-between gap-4 p-3">
    <div className="space-y-5 pt-2">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="ahi-avatar ahi-avatar-soft ahi-avatar--lg ahi-text-brand">
          <Logo className="ahi-icon-lg" colored />
        </div>
        <div>
          <h1 className="text-sm font-semibold tracking-tight ahi-text-fg">AhiCode</h1>
          <p className="mt-0.5 max-w-[260px] text-sm leading-relaxed ahi-text-muted">
            Ahilik zanaat disiplini ve mühendislik titizliğiyle projenizi inceleyen, kod yazan, testleri
            çalıştıran ve hataları düzelten yazılım ajanı.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-1">
          {CAPABILITIES.map((cap) => (
            <span
              key={cap.label}
              className="flex items-center gap-1 rounded-full border ahi-border-surface ahi-bg-raised px-2 py-0.5 text-2xs ahi-text-muted"
            >
              {cap.icon}
              {cap.label}
            </span>
          ))}
        </div>
      </div>

      {!isConfigured ? (
        <div className="rounded-lg border ahi-border-warning ahi-bg-warning p-4 text-center space-y-3">
          <div className="ahi-avatar ahi-avatar--lg ahi-bg-badge mx-auto">
            <Settings className="ahi-icon-lg" />
          </div>
          <div className="space-y-1">
            <h2 className="ahi-title">Model Ayarları Yapılandırılmadı</h2>
            <p className="text-xs ahi-text-muted leading-relaxed">
              AhiCode ile sohbete başlayabilmek için lütfen bir model sağlayıcısı (Yerel Ollama, EVREN LLM,
              OpenRouter vb.) seçip yapılandırın.
            </p>
          </div>
          {onOpenSettings && (
            <Button
              variant="primary"
              className="w-full justify-center"
              onClick={onOpenSettings}
              icon={<Settings className="ahi-icon-sm" />}
            >
              Ayarları Yapılandır
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="px-1 ahi-overline">Hızlı başlangıç</div>
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
      )}
    </div>

    <div className="flex items-center gap-2 rounded-md border ahi-border-surface ahi-bg-raised px-2.5 py-2 text-xs ahi-text-muted">
      <Terminal className="ahi-icon-xs ahi-text-success" />
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
  onEdit?: (content: string, messageId: string) => void;
}

const UserMessage: React.FC<UserMessageProps> = ({ message, checkpoints, onEdit }) => {
  const [copied, setCopied] = useState(false);
  // İki adımlı satır içi onay. VS Code webview'leri `allow-modals` olmadan
  // korumalı alanda çalışır; bu yüzden `window.confirm()` hiçbir iletişim
  // kutusu göstermez ve her zaman false döner — düğme ölü görünüyordu.
  const [confirmRewind, setConfirmRewind] = useState(false);
  const checkpoint = findCheckpointForMessage(message, checkpoints);
  // Kullanıcı balonunda ajanın eklediği editör bağlamı görünmez; kopyalama da
  // kullanıcının kendi sözlerini alır.
  const visibleContent = stripInjectedContext(message.content);

  const copy = () => {
    navigator.clipboard
      .writeText(visibleContent)
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
    <div className="group/message flex flex-col items-end">
      <div className="ahi-bubble ahi-bubble--user">
        <div className="ahi-overline mb-1 justify-end">
          <span>Sen</span>
        </div>
        <div className="whitespace-pre-wrap break-words ahi-text-fg">{visibleContent}</div>
      </div>

      {/* Zaman ve mesaj başına eylemler balonun altında; görünene kadar
          soluk durur, böylece sohbetin gürültüsünü artırmez. */}
      <div className="text-2xs mt-1 flex items-center gap-1 pr-0.5 opacity-60 ahi-text-muted transition-opacity group-hover/message:opacity-100 focus-within:opacity-100">
        <span className="font-mono opacity-70">{formatTime(message.timestamp)}</span>
        <Button
          variant="ghost"
          size="xs"
          onClick={copy}
          aria-label={copied ? 'Mesaj kopyalandı' : 'Mesajı kopyala'}
          title={copied ? 'Mesaj kopyalandı' : 'Mesajı kopyala'}
          icon={
            copied ? (
              <Check className="ahi-icon-xs ahi-text-success" />
            ) : (
              <Copy className="ahi-icon-xs" aria-hidden="true" />
            )
          }
        >
          {copied ? 'Kopyalandı' : 'Kopyala'}
        </Button>
        {onEdit && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => onEdit(visibleContent, message.id)}
            aria-label="Mesajı düzenle ve yeniden gönder"
            title="Mesajı düzenle ve yeniden gönder"
            icon={<Pencil className="ahi-icon-xs" aria-hidden="true" />}
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
            className={confirmRewind ? 'ahi-text-error' : ''}
            icon={<Undo2 className="ahi-icon-xs" aria-hidden="true" />}
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
    className="ahi-soft-card rounded-md border border-dashed ahi-border-surface px-2.5 py-1.5"
  >
    <div className="mt-1.5 border-t ahi-border-surface pt-1.5 opacity-90">
      <Markdown content={message.content} />
    </div>
  </Disclosure>
);

/** Sohbetin tek bir turu: bir kullanıcı istemi ve ona ait tüm asistan adımları. */
export interface ChatTurn {
  id: string;
  user?: ChatMessage;
  assistant: ChatMessage[];
}

/**
 * Mesajları turlara böler.
 *
 * Bir tur, kullanıcı istemiyle başlar ve sonraki kullanıcı istemine kadar
 * süren tüm asistan/sistem mesajlarını kapsar. Yeni kayıtlarda `turnId`
 * doğrudan kullanılır; eski kayıtlarda kullanıcı mesajı sınır kabul edilir.
 */
export function groupMessages(messages: ChatMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];

  for (const message of messages) {
    const current = turns[turns.length - 1];
    const startsTurn =
      message.role === 'user' || !current || (message.turnId !== undefined && current.id !== message.turnId);

    if (startsTurn) {
      turns.push({
        id: message.turnId ?? message.id,
        user: message.role === 'user' ? message : undefined,
        assistant: message.role === 'user' ? [] : [message]
      });
      continue;
    }

    current.assistant.push(message);
  }

  return turns;
}

/** Markdown işaretlerini sıyırıp akordeon başlığı için tek satırlık özet üretir. */
export function summarizeTurn(turn: ChatTurn): string {
  const withContent = [...turn.assistant].reverse().find((message) => message.content.trim());
  if (withContent) {
    const line = withContent.content
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[#>*_`~|-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (line) return line.length > 110 ? `${line.slice(0, 110)}…` : line;
  }

  const toolCount = turn.assistant.reduce((total, message) => total + (message.toolCalls?.length ?? 0), 0);
  if (toolCount > 0) return `${toolCount} araç adımı çalıştırıldı`;
  return 'Yanıt';
}

const ToolSteps: React.FC<{ toolCalls: ToolCall[]; pendingToolCall?: ToolCall }> = ({
  toolCalls,
  pendingToolCall
}) => (
  <div className="ml-1 space-y-1 border-l ahi-border-surface pl-2">
    <div className="flex items-center gap-1.5 px-0.5 ahi-overline">
      <Layers className="ahi-icon-xs ahi-text-brand" />
      Araç adımları
      <span className="ahi-badge-soft rounded-full px-1.5 py-0.5 font-mono text-2xs ahi-text-muted">
        {toolCalls.length}
      </span>
    </div>
    {toolCalls.map((toolCall, index) => (
      <ActionStepCard
        key={toolCall.id}
        toolCall={toolCall}
        stepNumber={index + 1}
        isPendingApproval={pendingToolCall?.id === toolCall.id}
      />
    ))}
  </div>
);

interface TurnBlockProps {
  turn: ChatTurn;
  /** Tur şu anda çalışıyorsa akordeon açık kalır. */
  active: boolean;
  pendingToolCall?: ToolCall;
}

/**
 * Asistan yanıtlarını tek akordeonda toplar.
 *
 * Her tur ayrı bir "AhiCode" balonu gibi görünmek yerine tek bir başlık altında
 * katlanır; çalışırken açık, bittiğinde kendiliğinden kapanır ve başlıkta
 * yanıtın kısa özetini gösterir.
 */
const TurnBlock: React.FC<TurnBlockProps> = ({ turn, active, pendingToolCall }) => {
  const [open, setOpen] = useState(active);
  const wasActive = useRef(active);
  const last = turn.assistant[turn.assistant.length - 1];
  const toolCalls = turn.assistant.flatMap((message) => message.toolCalls ?? []);
  const content = turn.assistant
    .map((message) => message.content)
    .filter(Boolean)
    .join('\n\n');

  useEffect(() => {
    // Çalışma bitince akordeonu kendiliğinden kapat; kullanıcı sonradan açarsa
    // bir daha zorla kapatma.
    if (active) {
      setOpen(true);
    } else if (wasActive.current) {
      setOpen(false);
    }
    wasActive.current = active;
  }, [active]);

  if (turn.assistant.length === 0) return null;

  return (
    <div className="ahi-turn-card rounded-lg border ahi-border-surface ahi-bg-surface">
      <div className="ahi-turn-card__header flex items-center gap-2 px-2.5 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={`turn-${turn.id}`}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          title={open ? 'Yanıtı daralt' : 'Yanıtı genişlet'}
        >
          <ChevronRight
            className={`ahi-icon-xs shrink-0 ahi-text-muted transition-transform ${open ? 'rotate-90' : ''}`}
          />
          <span className="ahi-avatar ahi-avatar-soft ahi-avatar--sm ahi-text-brand">
            <Logo className="ahi-icon-xs" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="text-xs font-semibold ahi-text-fg">AhiCode</span>
              {last && <MessageStatus message={last} />}
              <span className="font-mono text-2xs ahi-text-muted opacity-70">
                {formatTime(turn.assistant[0].timestamp)}
              </span>
              {!open && (
                <span className="min-w-0 flex-1 truncate text-2xs ahi-text-muted">{summarizeTurn(turn)}</span>
              )}
            </span>
          </span>
        </button>
        {content && <CopyMessageButton content={content} />}
      </div>

      <div
        id={`turn-${turn.id}`}
        hidden={!open}
        className="space-y-2 border-t ahi-border-surface px-2.5 py-2"
      >
        {turn.assistant.map((message) => (
          <div key={message.id} className="ahi-turn-msg space-y-1.5">
            {(message.content || message.isStreaming) && (
              <div className="ahi-bubble ahi-bubble--flush">
                <Markdown content={message.content} isStreaming={message.isStreaming} />
              </div>
            )}
            {message.error && <MessageError error={message.error} />}
          </div>
        ))}

        {turn.assistant.some((message) => message.toolCalls?.length) && (
          <TurnChangesReview toolCalls={toolCalls} />
        )}

        {toolCalls.length > 0 && <ToolSteps toolCalls={toolCalls} pendingToolCall={pendingToolCall} />}
      </div>
    </div>
  );
};

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  pendingToolCall,
  checkpoints,
  onEditMessage,
  onSuggestionClick,
  isConfigured = true,
  onOpenSettings
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
        <EmptyState
          onSuggestionClick={onSuggestionClick}
          isConfigured={isConfigured}
          onOpenSettings={onOpenSettings}
        />
      </div>
    );
  }

  const turns = groupMessages(messages);
  const lastTurn = turns[turns.length - 1];
  const activeTurnId =
    lastTurn && (lastTurn.assistant.some((message) => message.isStreaming) || Boolean(pendingToolCall))
      ? lastTurn.id
      : undefined;

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
      role="log"
      aria-live="polite"
      aria-label="Sohbet akışı"
    >
      <div className="space-y-3">
        {turns.map((turn) => (
          <div key={turn.id} className="ahi-message space-y-1.5">
            {turn.user && (
              <UserMessage message={turn.user} checkpoints={checkpoints} onEdit={onEditMessage} />
            )}
            {turn.assistant.some((message) => message.role === 'system') && (
              <div className="space-y-1.5">
                {turn.assistant
                  .filter((message) => message.role === 'system')
                  .map((message) => (
                    <SystemMessage key={message.id} message={message} />
                  ))}
              </div>
            )}
            <TurnBlock
              turn={{ ...turn, assistant: turn.assistant.filter((message) => message.role !== 'system') }}
              active={turn.id === activeTurnId}
              pendingToolCall={pendingToolCall}
            />
          </div>
        ))}

        <div ref={bottomRef} className="h-1" />
      </div>
    </div>
  );
};
