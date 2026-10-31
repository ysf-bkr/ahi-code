/**
 * AGENT.md / SKILL.md dosyaları için küçük YAML frontmatter ayrıştırıcısı.
 *
 * Bu dosyaların gerçekte kullandığı alt kümeyi destekler:
 * - düz skalerler: `name: my-agent`
 * - tırnaklı skalerler: `name: "my agent"` (çift ve tek tırnak)
 * - satır içi listeler: `tools: [read_file, write_file]`
 * - blok listeler:
 * tools:
 * - read_file
 * - write_file
 * - katlanmış bloklar (`>-` boşlukla birleştirir, `|` satır sonlarını korur)
 *
 * Önceki alan-başına-regex yaklaşımı blok listeleri sessizce yok sayıyor ve
 * değerlerin içinde tırnak bırakıyordu; araçlarını standart YAML listesiyle
 * tanımlayan ajanlar beklenmedik şekilde salt-okunur araç setine düşüyordu.
 */

export interface FrontmatterEntry {
  /** Tırnakları temizlenmiş skaler değer; yalnızca liste girdilerinde boş dize. */
  scalar: string;
  /** Değer liste ise öğeleri; değilse tanımsız. */
  list?: string[];
}

/** Markdown belgesini frontmatter alanlarına ayırır (varsa). */
export function parseFrontmatter(content: string): Map<string, FrontmatterEntry> {
  const result = new Map<string, FrontmatterEntry>();

  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match?.[1]) return result;

  const lines = match[1].split(/\r?\n/);
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const fieldMatch = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!fieldMatch) {
      index++;
      continue;
    }
    const key = fieldMatch[1];
    if (!key) {
      index++;
      continue;
    }
    const rawValue = (fieldMatch[2] ?? '').trim();
    index++;

    if (rawValue === '') {
      // Ardından blok liste ya da katlanmış blok gelir.
      const collected: string[] = [];
      while (index < lines.length) {
        const next = lines[index] ?? '';
        const item = next.match(/^\s+-\s*(.*)$/);
        if (item) {
          collected.push(unquote(item[1] ?? ''));
          index++;
          continue;
        }
        if (next.trim() === '' && collected.length === 0) {
          index++;
          continue;
        }
        break;
      }
      if (collected.length > 0) {
        result.set(key, { scalar: '', list: collected });
        continue;
      }
      result.set(key, { scalar: '' });
      continue;
    }

    if (['>', '>-', '|', '|-'].includes(rawValue)) {
      // Katlanmış blok: takip eden girintili satırları topla.
      const collected: string[] = [];
      while (index < lines.length) {
        const next = lines[index] ?? '';
        if (next.trim() === '') break;
        if (/^\s/.test(next) || collected.length === 0) {
          collected.push(next.trim());
          index++;
          continue;
        }
        break;
      }
      const joiner = rawValue.startsWith('>') ? ' ' : '\n';
      result.set(key, { scalar: collected.join(joiner).trim() });
      continue;
    }

    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      const list = rawValue
        .slice(1, -1)
        .split(',')
        .map((item) => unquote(item.trim()))
        .filter(Boolean);
      result.set(key, { scalar: '', list });
      continue;
    }

    result.set(key, { scalar: unquote(rawValue) });
  }

  return result;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/** Kısayol: bir alanın skaler değeri ya da geri dönüş değeri. */
export function frontmatterScalar(
  fields: Map<string, FrontmatterEntry>,
  key: string,
  fallback: string
): string {
  const value = fields.get(key)?.scalar;
  return value ? value : fallback;
}

/** Kısayol: bir alanın liste değeri ya da tanımsız. */
export function frontmatterList(fields: Map<string, FrontmatterEntry>, key: string): string[] | undefined {
  const list = fields.get(key)?.list;
  return list && list.length > 0 ? list : undefined;
}
