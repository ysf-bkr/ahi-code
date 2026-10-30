import * as path from 'path';

/**
 * Dosya uzantılarını VS Code standart Language ID'lerine eşler.
 * VS Code `openTextDocument({ language })` çağrısında `ts` veya `js` yerine
 * `typescript` veya `javascript` bekler; aksi halde söz dizimi renklendirmesi çalışmaz.
 */
const EXT_TO_LANGUAGE_ID: Record<string, string> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascriptreact',
  '.json': 'json',
  '.jsonc': 'jsonc',
  '.py': 'python',
  '.pyw': 'python',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hh': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
  '.sh': 'shellscript',
  '.bash': 'shellscript',
  '.zsh': 'shellscript',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.sql': 'sql',
  '.xml': 'xml',
  '.svg': 'xml',
  '.dart': 'dart',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.toml': 'toml',
  '.ini': 'ini',
  '.diff': 'diff',
  '.patch': 'diff'
};

const BASENAME_TO_LANGUAGE_ID: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  cmakelists: 'cmake'
};

export function getLanguageIdForFile(filePath: string): string {
  const base = path.basename(filePath).toLowerCase();
  if (BASENAME_TO_LANGUAGE_ID[base]) {
    return BASENAME_TO_LANGUAGE_ID[base];
  }
  const ext = path.extname(filePath).toLowerCase();
  return EXT_TO_LANGUAGE_ID[ext] || ext.replace('.', '') || 'plaintext';
}
