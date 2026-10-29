/**
 * "file" grubunun araçları.
 *
 * Eski tek parça tools/index.ts'ten ayrıldı; davranış değişmedi.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ToolDefinition } from './base';
import { argString, argBoolean, toPositiveInt } from './args';
import { resolveWorkspacePath } from './pathSafety';
import { isRecord } from '../shared/errors';
import { AHI_DIR, MAX_TOOL_OUTPUT_CHARS } from '../shared/constants';

const execFileAsync = promisify(execFile);

export const readFileTool: ToolDefinition = {
  name: 'read_file',
  description: 'Reads the contents of the specified file. Supports an optional line range (offset, limit).',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative or absolute path of the file to read.'
      },
      offset: {
        type: 'number',
        description: 'Starting line number (1-based, optional).'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of lines to read (default: 2000).'
      }
    },
    required: ['path']
  },
  execute: async (args, context) => {
    const targetPath = argString(args.path);
    const fullPath = resolveWorkspacePath(targetPath, context.workspaceRoot);
    const stat = await fs.stat(fullPath);
    if (stat.size > 10 * 1024 * 1024) {
      throw new Error(
        `File is too large (${Math.round(stat.size / 1024 / 1024)} MB). Choose a smaller file or read a specific section with the terminal tool.`
      );
    }
    const buffer = await fs.readFile(fullPath);

    // İkili dosya kontrolü
    const isBinary = buffer.slice(0, 512).some((b) => b === 0);
    if (isBinary) {
      return `[Binary file]: '${targetPath}' cannot be read directly as text because it is a binary file.`;
    }

    const content = buffer.toString('utf-8');
    const lines = content.split('\n');
    const offset = Math.max(1, toPositiveInt(args.offset, 1));
    // Bağlamı taşırmamak için bir seferde okunacak satır sayısını sınırla.
    const limit = Math.min(5000, Math.max(1, toPositiveInt(args.limit, 2000)));

    if (offset > 1 || limit < lines.length) {
      const selected = lines.slice(offset - 1, offset - 1 + limit);
      return selected.map((l, i) => `${offset + i}: ${l}`).join('\n');
    }

    return content;
  }
};

export const writeFileTool: ToolDefinition = {
  name: 'write_file',
  description: 'Creates a new file or completely replaces the contents of an existing file.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path of the file to write.'
      },
      content: {
        type: 'string',
        description: 'Full content to write to the file.'
      }
    },
    required: ['path', 'content']
  },
  execute: async (args, context) => {
    const content = args.content;
    if (typeof content !== 'string') {
      throw new Error('Content to write must be a string.');
    }
    const targetPath = argString(args.path);
    const fullPath = resolveWorkspacePath(targetPath, context.workspaceRoot);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
    return `Successfully wrote: ${targetPath}`;
  }
};

export const editFileTool: ToolDefinition = {
  name: 'edit_file',
  description: 'Safely replaces a specific code block in a file with new code.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path of the file to edit.'
      },
      targetText: {
        type: 'string',
        description: 'Exact existing text to find and replace in the file.'
      },
      replacementText: {
        type: 'string',
        description: 'New replacement text.'
      },
      allowMultiple: {
        type: 'boolean',
        description: 'Replace all occurrences if the target text appears more than once (default: false).'
      }
    },
    required: ['path', 'targetText', 'replacementText']
  },
  execute: async (args, context) => {
    const targetText = args.targetText;
    const replacementText = args.replacementText;
    if (typeof targetText !== 'string' || targetText.length === 0) {
      throw new Error('Target text to search for cannot be empty.');
    }
    if (typeof replacementText !== 'string') {
      throw new Error('Replacement text must be a string.');
    }
    const targetPath = argString(args.path);
    const fullPath = resolveWorkspacePath(targetPath, context.workspaceRoot);
    const content = await fs.readFile(fullPath, 'utf-8');

    // Windows/autocrlf kullanan dosyalarda \r\n, model çıktısında \n olabilir.
    const normalizedContent = content.replace(/\r\n/g, '\n');
    const normalizedTarget = targetText.replace(/\r\n/g, '\n');
    const normalizedReplacement = replacementText.replace(/\r\n/g, '\n');
    const crlfCount = (content.match(/\r\n/g) || []).length;
    const lfCount = (content.match(/(?<!\r)\n/g) || []).length;
    const eol = crlfCount > lfCount ? '\r\n' : '\n';

    if (!normalizedContent.includes(normalizedTarget)) {
      throw new Error(`Target text was not found in file: ${targetPath}`);
    }

    const occurrences = normalizedContent.split(normalizedTarget).length - 1;
    if (occurrences > 1 && !argBoolean(args.allowMultiple)) {
      throw new Error(
        `Target text appears ${occurrences} times in the file. Include surrounding lines to make it more specific and avoid changing the wrong location.`
      );
    }

    // Değiştirme dizesi yerine fonksiyon kullan; böylece $& ve $1 gibi diziler
    // düzenli ifade grup referansı olarak yorumlanmaz.
    const updatedNormalized = argBoolean(args.allowMultiple)
      ? normalizedContent.split(normalizedTarget).join(normalizedReplacement)
      : normalizedContent.replace(normalizedTarget, () => normalizedReplacement);
    const updated = eol === '\r\n' ? updatedNormalized.replace(/\n/g, '\r\n') : updatedNormalized;

    await fs.writeFile(fullPath, updated, 'utf-8');
    return `Successfully edited: ${targetPath}`;
  }
};

export const listDirectoryTool: ToolDefinition = {
  name: 'list_directory',
  description: 'Lists files and subdirectories in the specified directory.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory path to list. Defaults to the workspace root.'
      }
    },
    required: []
  },
  execute: async (args, context) => {
    const dirPath = resolveWorkspacePath(argString(args.path, '.'), context.workspaceRoot);
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const noisyEntries = new Set(['node_modules', '.git', 'dist', 'out', 'build', 'coverage']);
    const formatted = entries
      .filter((e) => !noisyEntries.has(e.name))
      .map((e) => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`)
      .join('\n');
    return formatted || '(Directory is empty)';
  }
};

export const searchFilesTool: ToolDefinition = {
  name: 'search_files',
  description: 'Searches project files for text (protected against command injection).',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Text or word to search for.'
      },
      caseSensitive: {
        type: 'boolean',
        description: 'Whether the search is case-sensitive.'
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results (default: 50).'
      }
    },
    required: ['query']
  },
  execute: async (args, context) => {
    if (!context.workspaceRoot) {
      throw new Error('Workspace not found.');
    }

    const query = String(args.query || '').trim();
    if (!query) {
      return 'Search query cannot be empty.';
    }

    const maxResults = Math.min(100, Math.max(1, toPositiveInt(args.maxResults, 50)));
    const caseSensitive = argBoolean(args.caseSensitive);
    // `read_file` ile aynı okuma izni: deny kuralları ve hassas dosyalar arama
    // sonuçlarında da filtrelenir; aksi hâlde arama bu kuralları aşardı (F04).
    const isReadDenied = (relPath: string): boolean =>
      Boolean(context.permissionManager?.isToolBlocked('read_file', { path: relPath }).blocked);
    const rgArgs = [
      '--line-number',
      '--no-heading',
      '--no-messages',
      '--color',
      'never',
      '--fixed-strings',
      ...(caseSensitive ? [] : ['--ignore-case']),
      '--glob',
      '!node_modules/**',
      '--glob',
      '!dist/**',
      '--glob',
      '!.git/**',
      '--glob',
      '!.ahi/**',
      '--iglob',
      '!.env*',
      '--iglob',
      '!*.pem',
      '--iglob',
      '!*.key',
      // ripgrep yolunu Node yedeğiyle tutarlı tut: SSH anahtarlarını, gizli
      // klasörleri ve 1 MB'tan büyük dosyaları asla tarama.
      '--iglob',
      '!id_rsa*',
      '--glob',
      '!.ssh/**',
      '--glob',
      '!.aws/**',
      '--max-filesize',
      '1M',
      '--max-count',
      String(maxResults),
      '--',
      query,
      '.'
    ];

    try {
      const { stdout } = await execFileAsync('rg', rgArgs, {
        cwd: context.workspaceRoot,
        maxBuffer: 1024 * 1024 * 5
      });
      // ripgrep çıktı satırları `yol:satırNo:metin` biçimindedir; izin
      // kapısından geçemeyen yolların satırları sonuçlara giremez.
      const allowed = stdout
        .split('\n')
        .filter((line) => {
          if (!line) return false;
          const match = /^(.*):(\d+):(.*)$/.exec(line);
          if (!match) return true;
          const relPath = (match[1] || '').replace(/^\.\//, '');
          return !isReadDenied(relPath);
        })
        .join('\n');
      return allowed.slice(0, MAX_TOOL_OUTPUT_CHARS) || 'No results found.';
    } catch (err) {
      const stdout = isRecord(err) && typeof err.stdout === 'string' ? err.stdout : '';
      if (stdout) {
        const allowed = stdout
          .split('\n')
          .filter((line) => {
            if (!line) return false;
            const match = /^(.*):(\d+):(.*)$/.exec(line);
            if (!match) return true;
            const relPath = (match[1] || '').replace(/^\.\//, '');
            return !isReadDenied(relPath);
          })
          .join('\n');
        return allowed.slice(0, MAX_TOOL_OUTPUT_CHARS);
      }
      // ripgrep sonuç bulamadığında 1 koduyla çıkar; bu başarılı boş sonuçtur,
      // hata değil. Yalnızca gerçek arıza (rg yok, bozuk argüman -> kod 2,
      // spawn ENOENT) Node taramasına düşer; o çok daha yavaştır.
      const exitCode = isRecord(err) && typeof err.code === 'number' ? err.code : undefined;
      if (exitCode === 1) {
        return 'No results found.';
      }
      return searchFilesFallback(context.workspaceRoot, query, caseSensitive, maxResults, isReadDenied);
    }
  }
};

export async function searchFilesFallback(
  root: string,
  query: string,
  caseSensitive: boolean,
  maxResults: number,
  isReadDenied?: (relPath: string) => boolean
): Promise<string> {
  const ignoredDirs = new Set([
    'node_modules',
    '.git',
    'dist',
    'out',
    'build',
    AHI_DIR,
    '.next',
    'coverage',
    '.ssh',
    '.aws',
    '.gnupg'
  ]);
  const needle = caseSensitive ? query : query.toLowerCase();
  const results: string[] = [];

  const walk = async (dir: string): Promise<void> => {
    if (results.length >= maxResults) return;

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      // Yedek taramada okunamayan klasör: atla.
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxResults) break;
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) {
          await walk(fullPath);
        }
        continue;
      }

      if (!entry.isFile()) continue;
      if (/^(\.env(\..*)?|.*\.(pem|key)|id_rsa(\..*)?)$/i.test(entry.name)) continue;

      const rel = path.relative(root, fullPath);
      // Dolaylı okuma da izin kapısından geçer: deny kapsamındaki dosya
      // aranabilir ama içeriği sonuçlara giremez (F04).
      if (isReadDenied?.(rel.replace(/\\/g, '/'))) continue;

      try {
        const stat = await fs.stat(fullPath);
        if (stat.size > 1024 * 1024) continue; // 1 MB'tan büyük dosyaları atla.

        const content = await fs.readFile(fullPath, 'utf-8');
        if (content.includes('\0')) continue; // İkili (binary) dosya.

        const lines = content.split('\n');
        for (let i = 0; i < lines.length && results.length < maxResults; i++) {
          const line = lines[i];
          if (!line) continue;
          const haystack = caseSensitive ? line : line.toLowerCase();
          if (haystack.includes(needle)) {
            results.push(`${rel}:${i + 1}:${line.trim().slice(0, 300)}`);
          }
        }
      } catch {
        // Okunamayan dosyaları atla.
      }
    }
  };

  await walk(root);
  return results.length > 0 ? results.join('\n').slice(0, 15000) : 'No matching results found.';
}

export const readNotebookTool: ToolDefinition = {
  name: 'read_notebook',
  description: 'Reads the cells and source code of a Jupyter (.ipynb) notebook. Does not execute cells.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the notebook file.' }
    },
    required: ['path']
  },
  execute: async (args, ctx) => {
    if (!ctx.workspaceRoot) throw new Error('Workspace not found.');
    const target = resolveWorkspacePath(argString(args.path), ctx.workspaceRoot);
    const stat = await fs.stat(target);
    if (stat.size > 5 * 1024 * 1024) throw new Error('Notebook file is too large.');
    const raw: unknown = JSON.parse(await fs.readFile(target, 'utf-8'));
    if (!isRecord(raw) || !Array.isArray(raw.cells)) {
      return 'Invalid notebook structure.';
    }
    const lines = raw.cells.slice(0, 100).map((cell, index) => {
      if (!isRecord(cell)) return `${index + 1}. [invalid cell]`;
      const type = typeof cell.cell_type === 'string' ? cell.cell_type : 'unknown';
      const source = Array.isArray(cell.source)
        ? cell.source.filter((item): item is string => typeof item === 'string').join('')
        : typeof cell.source === 'string'
          ? cell.source
          : '';
      return `### Cell ${index + 1} (${type})\n${source.slice(0, 4_000)}`;
    });
    const body = lines.join('\n\n');
    const limited =
      body.length > MAX_TOOL_OUTPUT_CHARS
        ? `${body.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n... [${body.length - MAX_TOOL_OUTPUT_CHARS} notebook output characters truncated]`
        : body;
    return `Notebook: ${argString(args.path)} (${raw.cells.length} cells)\n\n${limited}`;
  }
};
