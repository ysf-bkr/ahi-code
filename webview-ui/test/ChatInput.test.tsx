import './setupDom';
import { afterEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TaskState, UserSettings } from '@shared/types';
import { vscode } from '../src/utils/vscode';
import { ChatInput } from '../src/components/ChatInput';
import { TaskHeader } from '../src/components/TaskHeader';

const originalPostMessage = vscode.postMessage;

afterEach(() => {
  cleanup();
  vscode.postMessage = originalPostMessage;
});

function createTaskState(overrides: Partial<TaskState> = {}): TaskState {
  return {
    id: 'task-1',
    prompt: '',
    mode: 'code',
    status: 'idle',
    messages: [],
    stats: {
      totalTokens: 0,
      stepsCount: 0,
      filesModified: []
    },
    ...overrides
  };
}

const settings: UserSettings = {
  selectedProvider: 'ollama',
  selectedModel: 'llama3.1',
  apiKeys: {},
  autoApprove: {
    readFiles: true,
    writeFiles: false,
    executeCommands: false
  }
};

describe('ChatInput', () => {
  it('trims and sends a message when submitted', () => {
    const sentMessages: string[] = [];
    render(
      <ChatInput
        state={createTaskState()}
        onSend={(text) => sentMessages.push(text)}
        onModeChange={() => {}}
      />
    );

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  Fix the build  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mesajı gönder' }));

    assert.deepEqual(sentMessages, ['Fix the build']);
    assert.equal((screen.getByRole('textbox') as HTMLTextAreaElement).value, '');
  });

  it('preserves Shift+Enter and submits with Enter', () => {
    const sentMessages: string[] = [];
    render(
      <ChatInput
        state={createTaskState()}
        onSend={(text) => sentMessages.push(text)}
        onModeChange={() => {}}
      />
    );
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'A message' } });

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    assert.deepEqual(sentMessages, []);
    assert.equal((input as HTMLTextAreaElement).value, 'A message');

    fireEvent.keyDown(input, { key: 'Enter' });
    assert.deepEqual(sentMessages, ['A message']);
  });

  it('asks the agent a question instead of cancelling while waiting for input', () => {
    const messages: unknown[] = [];
    const sentMessages: string[] = [];
    vscode.postMessage = (message) => messages.push(message);
    render(
      <ChatInput
        state={createTaskState({
          status: 'waiting_user_input',
          pendingQuestion: { toolCallId: 'q1', question: 'Hangi veritabanı?' }
        })}
        onSend={(text) => sentMessages.push(text)}
        onModeChange={() => {}}
      />
    );

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'PostgreSQL' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    assert.deepEqual(sentMessages, ['PostgreSQL'], 'cevap mesaj olarak gönderilmeli');
    assert.deepEqual(messages, [], 'görev iptal edilmemeli');
  });

  it('does not cancel while a tool approval is pending', () => {
    const messages: unknown[] = [];
    vscode.postMessage = (message) => messages.push(message);
    render(
      <ChatInput
        state={createTaskState({
          status: 'waiting_approval',
          pendingToolCall: {
            id: 'tc1',
            name: 'write_file',
            args: { path: 'a.ts' },
            requiresApproval: true,
            status: 'pending'
          }
        })}
        onSend={() => assert.fail('Onay beklerken mesaj gönderilmemeli')}
        onModeChange={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Önce onay kartını yanıtlayın' }));
    assert.deepEqual(messages, [], 'araç onayı beklerken iptal edilmemeli');
  });

  it('disables mode switching and cancels the active task', () => {
    const messages: unknown[] = [];
    const onModeChange = () => assert.fail('Mode changes should be disabled while a task is running');
    vscode.postMessage = (message) => messages.push(message);
    render(
      <ChatInput
        state={createTaskState({ status: 'running' })}
        onSend={() => assert.fail('A running task should not submit a new message')}
        onModeChange={onModeChange}
      />
    );

    assert.equal(
      (screen.getByRole('button', { name: 'Görev modu: Kodlama' }) as HTMLButtonElement).disabled,
      true
    );
    fireEvent.click(screen.getByRole('button', { name: 'Görevi durdur' }));

    assert.deepEqual(messages, [{ type: 'CANCEL_TASK' }]);
  });

  it('ayarlar yapılandırılmamışsa giriş alanını devre dışı bırakır ve uyarı verir', () => {
    let settingsOpened = false;
    render(
      <ChatInput
        state={createTaskState()}
        onSend={() => assert.fail('Ayar yapılmadan mesaj gönderilmemeli')}
        onModeChange={() => {}}
        isConfigured={false}
        onOpenSettings={() => {
          settingsOpened = true;
        }}
      />
    );

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    assert.equal(textarea.disabled, true, 'metin alanı devre dışı olmalı');
    assert.match(textarea.placeholder, /Ayarlar/);

    const button = screen.getByRole('button', { name: 'Önce ayarları yapılandırın' }) as HTMLButtonElement;
    assert.equal(button.disabled, true, 'gönder düğmesi devre dışı olmalı');

    fireEvent.click(screen.getByRole('button', { name: 'Ayarları Yapılandır' }));
    assert.equal(settingsOpened, true, 'ayarları yapılandır düğmesi çalışmalı');
  });

  it('otonomi seçicisini gösterir ve değişimi geri bildirir', () => {
    const changes: string[] = [];
    render(
      <ChatInput
        state={createTaskState()}
        onSend={() => {}}
        onModeChange={() => {}}
        autonomy="manual"
        onAutonomyChange={(level) => changes.push(level)}
      />
    );

    // Kapalı seçici yalnızca ikonu gösterir: seçenek etiketleri çizilmez.
    assert.equal(screen.queryByText('Yönlendir'), null, 'etiketler menü açıkken görünmeli');
    const trigger = screen.getByRole('button', { name: 'Otonomi seviyesi: Elle' });
    assert.ok(trigger, 'seçili seviye erişilebilir adta taşınmalı');

    fireEvent.click(trigger);
    assert.ok(screen.getByRole('listbox', { name: 'Otonomi seviyesi' }), 'etiketli menü açılmalı');
    fireEvent.click(screen.getByRole('option', { name: /Otonom/ }));
    assert.deepEqual(changes, ['auto'], 'seviye değişimi bildirilmeli');
    assert.equal(screen.queryByRole('listbox'), null, 'seçim sonrası menü kapanmalı');
  });

  it('mod seçicisi kapalıyken etiket göstermez, tıklayınca açılır', () => {
    const modes: string[] = [];
    render(<ChatInput state={createTaskState()} onSend={() => {}} onModeChange={(m) => modes.push(m)} />);

    assert.equal(screen.queryByText('Planlama'), null, 'kapalı çubukta mod etiketi çizilmemeli');
    fireEvent.click(screen.getByRole('button', { name: 'Görev modu: Kodlama' }));
    fireEvent.click(screen.getByRole('option', { name: 'Planlama' }));
    assert.deepEqual(modes, ['plan']);
  });
});

describe('TaskHeader menu', () => {
  it('shows the active mode and leaves model selection to the composer bar', () => {
    const { rerender } = render(
      <TaskHeader state={createTaskState({ mode: 'code' })} changedFileCount={0} onSelectMenu={() => {}} />
    );

    assert.ok(screen.getByLabelText('Görev modu: Kodlama'));
    // Model seçimi sohbet altındaki çubuğa taşındı; üstbilgide yalnızca mod kalır.
    assert.equal(screen.queryByText(settings.selectedModel), null);

    rerender(
      <TaskHeader state={createTaskState({ mode: 'plan' })} changedFileCount={0} onSelectMenu={() => {}} />
    );

    assert.ok(screen.getByLabelText('Görev modu: Planlama'));
    assert.equal(screen.queryByText(settings.selectedModel), null);
  });

  it('opens the menu and closes it after a destination is selected', () => {
    const selections: string[] = [];
    render(
      <TaskHeader
        state={createTaskState()}
        changedFileCount={2}
        onSelectMenu={(destination) => selections.push(destination)}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Menüyü aç' }));
    assert.ok(screen.getByRole('menu'));
    assert.ok(screen.getByText('2'));

    fireEvent.click(screen.getByRole('menuitem', { name: /Ayarlar/ }));
    assert.deepEqual(selections, ['settings']);
    assert.equal(screen.queryByRole('menu'), null);
  });

  it('closes the menu when Escape is pressed', () => {
    render(<TaskHeader state={createTaskState()} changedFileCount={0} onSelectMenu={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Menüyü aç' }));
    fireEvent.keyDown(document, { key: 'Escape' });

    assert.equal(screen.queryByRole('menu'), null);
  });
});
