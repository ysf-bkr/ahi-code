import { readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const mode = process.argv.includes('--all') ? 'all' : process.argv.includes('--cache') ? 'cache' : 'build';

const remove = (relative) => {
  rmSync(resolve(root, relative), { recursive: true, force: true });
};

/** Removes every packaged extension artifact, regardless of version. */
const removePackages = () => {
  /** @type {string[]} */
  let entries = [];
  try {
    entries = readdirSync(root);
  } catch {
    // Nothing to clean.
  }
  for (const entry of entries) {
    if (/^ahi-code-.+\.vsix$/.test(entry)) {
      remove(entry);
    }
  }
};

if (mode === 'build' || mode === 'all') {
  remove('dist');
  remove('webview-ui/dist');
  remove('out');
  removePackages();
}

if (mode === 'cache' || mode === 'all') {
  remove('.ahi/checkpoints');
  remove('.ahi/snapshots');
  remove('.ahi/worktrees');
  remove('.ahi/verification-baseline.json');
  remove('.ahi/audit.log');
  remove('.ahi/callgraph.json');
  remove('.ahi/callgraph.json.tmp');
  remove('.ahi/specs');
  remove('.ahi/memory.jsonl');
  remove('.ahi/memory.md');

  // Yalnızca üretilen bilgi tabanı indeksi; project.md, conventions.md,
  // decisions.md ve notes.md kullanıcıya aittir ve önbellek temizliğinden sağ çıkmalıdır.
  remove('.ahi/knowledge/map.jsonl');
  remove('.ahi/knowledge/symbols.jsonl');
  remove('.ahi/knowledge/index-state.json');
  remove('.ahi/knowledge/embeddings.jsonl');
  remove('.ahi/knowledge/modules');
}

if (mode === 'all') {
  // Entegrasyon testlerinin kullandığı indirilmiş VS Code build'leri (büyük, yeniden indirilebilir).
  remove('.vscode-test');
}

process.stdout.write(`Clean finished (${mode}).\n`);
