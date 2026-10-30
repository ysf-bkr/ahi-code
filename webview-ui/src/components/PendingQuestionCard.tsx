import React, { useState } from 'react';
import { HelpCircle, Send, X } from 'lucide-react';
import { PendingQuestion } from '@shared/types';
import { vscode } from '../utils/vscode';
import { Button, TextareaField } from './ui';

export type PendingQuestionCardProps = PendingQuestion;

/** Ajanın sorduğu engelleyici soru; bestecinin üzerinde gösterilir. */
export const PendingQuestionCard: React.FC<PendingQuestionCardProps> = ({ question, toolCallId }) => {
  const [reply, setReply] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = reply.trim();
    if (!value) return;
    vscode.postMessage({
      type: 'USER_REPLY',
      payload: { toolCallId, reply: value }
    });
    setReply('');
  };

  return (
    <div className="ahi-question-card rounded-lg border ahi-bg-raised p-2.5 ahi-shadow-sm">
      <div className="text-sm mb-1.5 flex items-center gap-1.5 font-semibold ahi-text-brand">
        <HelpCircle className="ahi-icon-sm shrink-0" />
        AhiCode bir cevap bekliyor
      </div>
      <div className="text-sm mb-2 rounded-md border ahi-border-surface ahi-bg-input px-2.5 py-2 leading-relaxed ahi-text-fg">
        {question}
      </div>
      <form onSubmit={submit} className="flex flex-col gap-1.5">
        <TextareaField
          autoFocus
          rows={2}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit(e);
            }
          }}
          placeholder="Yanıtınızı yazın... (Göndermek için Enter'a basın)"
          aria-label="Ajanın sorusuna yanıt"
        />
        <div className="flex items-center justify-end gap-1.5">
          <Button
            variant="secondary"
            size="xs"
            onClick={() => vscode.postMessage({ type: 'CANCEL_TASK' })}
            icon={<X className="ahi-icon-xs" />}
          >
            İptal
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="xs"
            disabled={!reply.trim()}
            icon={<Send className="ahi-icon-xs" />}
          >
            Yanıtla
          </Button>
        </div>
      </form>
    </div>
  );
};
