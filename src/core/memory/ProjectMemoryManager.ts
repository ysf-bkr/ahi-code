import * as path from 'path';
import { AHI_DIR } from '../../shared/constants';
import * as fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logWarning } from '../../shared/logging';
import { isRecord } from '../../shared/errors';

const execFileAsync = promisify(execFile);

export type ProjectMemoryStatus = 'completed' | 'failed' | 'cancelled' | 'paused';

export interface ProjectMemoryInput {
  taskId: string;
  mode: 'code' | 'plan';
  status: ProjectMemoryStatus;
  prompt: string;
  files: string[];
  summary?: string;
}

export interface ProjectMemorySnapshot {
  path: string;
  content: string;
  entryCount: number;
  updatedAt?: number;
}

export interface ProjectMemoryEntry {
  taskId: string;
  timestamp: number;
  mode: 'code' | 'plan';
  status: ProjectMemoryStatus;
  prompt: string;
  files: string[];
  summary?: string;
  commit?: string;
}

const FILE_NAME = 'memory.md';
const ENTRY_FILE_NAME = 'memory.jsonl';
const MEMORY_DIR = AHI_DIR;
const MAX_ENTRIES = 80;
const MAX_CHARS = 64000;
const HEADER = `# AhiCode — Project Memory

> This file is automatically created and updated by AhiCode.
> It helps the agent remember what it did in previous sessions.
> You can also edit it manually, but future tasks will append automatic records.

`;

function cleanText(value: string | undefined, maxLength: number): string {
  return String(value || '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export class ProjectMemoryManager {
  public getMemoryPath(workspaceRoot?: string): string | undefined {
    if (!workspaceRoot) return undefined;
    return path.join(workspaceRoot, MEMORY_DIR, FILE_NAME);
  }

  private getEntryPath(workspaceRoot?: string): string | undefined {
    if (!workspaceRoot) return undefined;
    return path.join(workspaceRoot, MEMORY_DIR, ENTRY_FILE_NAME);
  }

  private async getCommit(workspaceRoot: string): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd: workspaceRoot });
      return stdout.trim() || undefined;
    } catch {
      // No Git repository: memory entries are stored without a commit hash.
      return undefined;
    }
  }

  public async loadEntries(workspaceRoot?: string): Promise<ProjectMemoryEntry[]> {
    const entryPath = this.getEntryPath(workspaceRoot);
    if (!entryPath) return [];
    try {
      const raw = await fs.readFile(entryPath, 'utf-8');
      const entries: ProjectMemoryEntry[] = [];
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          const parsed: unknown = JSON.parse(line);
          if (!isRecord(parsed) || typeof parsed.taskId !== 'string' || typeof parsed.prompt !== 'string') {
            continue;
          }
          entries.push({
            taskId: parsed.taskId,
            timestamp: typeof parsed.timestamp === 'number' ? parsed.timestamp : Date.now(),
            mode: parsed.mode === 'plan' ? 'plan' : 'code',
            status:
              parsed.status === 'failed' || parsed.status === 'cancelled' || parsed.status === 'paused'
                ? parsed.status
                : 'completed',
            prompt: parsed.prompt,
            files: Array.isArray(parsed.files)
              ? parsed.files.filter((file): file is string => typeof file === 'string')
              : [],
            summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
            commit: typeof parsed.commit === 'string' ? parsed.commit : undefined
          });
        } catch {
          // Bozuk satırları atla.
        }
      }
      return entries.slice(-500);
    } catch {
      // Missing or unreadable memory file: there are no past tasks to search.
      return [];
    }
  }

  public async search(workspaceRoot: string, query: string, limit = 10): Promise<string> {
    const needle = query.trim().toLowerCase();
    const entries = await this.loadEntries(workspaceRoot);
    if (!needle) return 'Search query cannot be empty.';
    if (entries.length === 0) return 'No records found in project memory.';

    const matches = entries
      .map((entry) => {
        const haystack = [entry.prompt, entry.summary || '', entry.files.join(' '), entry.commit || '']
          .join(' ')
          .toLowerCase();
        const score = haystack.includes(needle)
          ? 1
          : entry.prompt
              .toLowerCase()
              .split(/\s+/)
              .filter((word) => word.includes(needle)).length;
        return { entry, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.entry.timestamp - a.entry.timestamp)
      .slice(0, Math.max(1, Math.min(limit, 50)));

    if (matches.length === 0) return `No memory records matched "${query}".`;
    return matches
      .map(({ entry }, index) =>
        [
          `${index + 1}. ${new Date(entry.timestamp).toLocaleString('tr-TR')} · ${entry.status} · ${entry.mode}`,
          `   Task: ${entry.prompt.slice(0, 300)}`,
          entry.summary ? `   Result: ${entry.summary.slice(0, 300)}` : '',
          entry.files.length ? `   Files: ${entry.files.slice(0, 10).join(', ')}` : '',
          entry.commit ? `   Commit: ${entry.commit}` : ''
        ]
          .filter(Boolean)
          .join('\n')
      )
      .join('\n\n');
  }

  public async load(workspaceRoot?: string): Promise<ProjectMemorySnapshot> {
    const memoryPath = this.getMemoryPath(workspaceRoot);
    if (!memoryPath) {
      return { path: '', content: '', entryCount: 0 };
    }

    try {
      const content = await fs.readFile(memoryPath, 'utf-8');
      const stat = await fs.stat(memoryPath);
      const entryCount = (content.match(/^##\s+/gm) || []).length;
      return { path: memoryPath, content, entryCount, updatedAt: stat.mtimeMs };
    } catch {
      // Memory has not been written yet: report empty content instead of throwing.
      return { path: memoryPath, content: '', entryCount: 0 };
    }
  }

  public async append(workspaceRoot: string | undefined, input: ProjectMemoryInput): Promise<void> {
    const memoryPath = this.getMemoryPath(workspaceRoot);
    if (!memoryPath) return;

    try {
      await fs.mkdir(path.dirname(memoryPath), { recursive: true });

      let existing = '';
      try {
        existing = await fs.readFile(memoryPath, 'utf-8');
      } catch {
        // First entry: start from the header template.
        existing = HEADER;
      }

      if (!existing.trim()) {
        existing = HEADER;
      }

      // Aynı görevi birden fazla kez kaydetme.
      if (existing.includes(`<!-- task:${input.taskId} -->`)) {
        return;
      }

      const files = input.files.filter(Boolean).slice(0, 12);
      const lines: string[] = [
        `## ${new Date().toISOString()} · ${input.mode === 'plan' ? 'Planning' : 'Coding'} · ${input.status}`,
        `<!-- task:${input.taskId} -->`,
        `- **Task:** ${cleanText(input.prompt, 320) || '(empty task)'}`
      ];

      if (files.length > 0) {
        lines.push(`- **Changed files:** ${files.map((f) => `\`${cleanText(f, 180)}\``).join(', ')}`);
      }
      if (input.summary) {
        lines.push(`- **Result:** ${cleanText(input.summary, 420)}`);
      } else if (input.status !== 'completed') {
        lines.push(
          `- **Result:** Task ${input.status === 'cancelled' ? 'was cancelled by the user' : input.status === 'failed' ? 'failed' : 'was paused'}.`
        );
      }

      let updated = `${existing.trimEnd()}\n\n${lines.join('\n')}\n`;

      // Boyut ve kayıt sayısı sınırlarını en eski kayıtları düşürerek uygula.
      const chunks = updated.split(/\n(?=##\s)/);
      const firstChunk = chunks[0] ?? '';
      const header = firstChunk.startsWith('# AhiCode') ? firstChunk : HEADER;
      const entries = chunks.filter((chunk) => chunk.startsWith('## '));
      if (entries.length > MAX_ENTRIES) {
        updated = `${header.trimEnd()}\n\n${entries.slice(-MAX_ENTRIES).join('\n\n')}\n`;
      }
      if (updated.length > MAX_CHARS) {
        updated = `${HEADER}... [Older records truncated to fit the size limit] ...\n\n${updated.slice(-MAX_CHARS / 2)}`;
      }

      await fs.writeFile(memoryPath, updated, 'utf-8');

      const entryPath = this.getEntryPath(workspaceRoot);
      if (entryPath) {
        const entry: ProjectMemoryEntry = {
          taskId: input.taskId,
          timestamp: Date.now(),
          mode: input.mode,
          status: input.status,
          prompt: cleanText(input.prompt, 500),
          files,
          summary: input.summary ? cleanText(input.summary, 800) : undefined,
          commit: await this.getCommit(workspaceRoot!)
        };
        await fs.appendFile(entryPath, `${JSON.stringify(entry)}\n`, { encoding: 'utf-8', mode: 0o600 });
      }
    } catch (err) {
      // Bellek yazımı ana görev akışını engellememeli.
      logWarning('Could not write project memory', err);
    }
  }

  public async formatForPrompt(workspaceRoot?: string, maxChars = 6000): Promise<string> {
    const snapshot = await this.load(workspaceRoot);
    if (!snapshot.content.trim()) return '';

    const chunks = snapshot.content.split(/\n(?=##\s)/);
    const recent: string[] = [];
    let total = 0;

    for (let i = chunks.length - 1; i >= 0; i--) {
      const chunk = chunks[i];
      if (!chunk || !chunk.startsWith('## ')) continue;
      if (total + chunk.length > maxChars && recent.length > 0) break;
      recent.unshift(chunk);
      total += chunk.length;
    }

    return `\n\n=== PROJECT MEMORY (.ahi/memory.md) ===
The following records summarize previous tasks in this project. Consider them before starting a new task;
avoid repeating work unnecessarily, do not contradict previous decisions, and preserve the current state.

${recent.join('\n\n')}
=== END OF PROJECT MEMORY ===`;
  }

  public async clear(workspaceRoot?: string): Promise<boolean> {
    const memoryPath = this.getMemoryPath(workspaceRoot);
    if (!memoryPath) return false;
    try {
      await fs.rm(memoryPath, { force: true });
      const entryPath = this.getEntryPath(workspaceRoot);
      if (entryPath) await fs.rm(entryPath, { force: true });
      return true;
    } catch {
      // Cleanup is best-effort; a partial delete is reported as failure.
      return false;
    }
  }
}
