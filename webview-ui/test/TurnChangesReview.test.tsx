import './setupDom';
import { afterEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TurnChangesReview, extractModifiedFiles } from '../src/components/TurnChangesReview';
import { vscode } from '../src/utils/vscode';
import type { ToolCall } from '@shared/types';

const originalPostMessage = vscode.postMessage;

afterEach(() => {
  cleanup();
  vscode.postMessage = originalPostMessage;
});

const sampleToolCalls: ToolCall[] = [
  {
    id: 'tc-1',
    name: 'read_file',
    args: { path: 'src/index.ts' },
    status: 'completed',
    requiresApproval: false
  },
  {
    id: 'tc-2',
    name: 'write_file',
    args: { path: 'src/newFile.ts' },
    status: 'completed',
    requiresApproval: true
  },
  {
    id: 'tc-3',
    name: 'edit_file',
    args: { path: 'src/existing.ts' },
    status: 'completed',
    requiresApproval: true
  }
];

describe('TurnChangesReview: dosya değişikliklerini toplama ve inceleme', () => {
  it('yalnızca dosya yazma ve düzenleme araçlarını çıkarır', () => {
    const files = extractModifiedFiles(sampleToolCalls);
    assert.equal(files.length, 2);
    assert.deepEqual(
      files.map((f) => f.path),
      ['src/newFile.ts', 'src/existing.ts']
    );
    assert.equal(files[0].action, 'create');
    assert.equal(files[1].action, 'edit');
  });

  it('dosya değişikliği yoksa hiçbir şey çizmez', () => {
    const { container } = render(
      <TurnChangesReview
        toolCalls={[
          {
            id: '1',
            name: 'read_file',
            args: { path: 'test.ts' },
            status: 'completed',
            requiresApproval: false
          }
        ]}
      />
    );
    assert.equal(container.firstChild, null);
  });

  it('değiştirilen dosyaları ve incele butonunu çizer', () => {
    render(<TurnChangesReview toolCalls={sampleToolCalls} />);

    assert.ok(screen.getByTestId('turn-changes-review'));
    assert.ok(screen.getByText('Kod Değişiklikleri'));
    assert.ok(screen.getByText('2 dosya'));
    assert.ok(screen.getByText('+ Yeni'));
    assert.ok(screen.getByText('• Düzenlendi'));
    assert.ok(screen.getByText('src/newFile.ts'));
    assert.ok(screen.getByText('src/existing.ts'));
  });

  it('İncele butonuna tıklayınca SHOW_TOOL_DIFF mesajı gönderir', () => {
    const messages: Array<{ type: string; payload?: unknown }> = [];
    vscode.postMessage = (msg: unknown) => {
      messages.push(msg as { type: string; payload?: unknown });
    };

    render(<TurnChangesReview toolCalls={sampleToolCalls} />);

    const reviewBtn = screen.getByRole('button', { name: /İncele \(Diff\)/ });
    fireEvent.click(reviewBtn);

    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0], {
      type: 'SHOW_TOOL_DIFF',
      payload: { toolCallId: 'tc-2' }
    });
  });

  it('Aç butonuna tıklayınca OPEN_FILE mesajı gönderir', () => {
    const messages: Array<{ type: string; payload?: unknown }> = [];
    vscode.postMessage = (msg: unknown) => {
      messages.push(msg as { type: string; payload?: unknown });
    };

    render(<TurnChangesReview toolCalls={sampleToolCalls} />);

    const openButtons = screen.getAllByRole('button', { name: 'Dosyayı aç' });
    fireEvent.click(openButtons[0]);

    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0], {
      type: 'OPEN_FILE',
      payload: { filePath: 'src/newFile.ts' }
    });
  });
});
