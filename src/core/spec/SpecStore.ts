import * as path from 'path';
import * as fs from 'fs/promises';
import { isRecord } from '../../shared/errors';
import { AHI_DIR, AHI_SUBDIRS } from '../../shared/constants';

/**
 * Spec'ler bir görevin sözleşmesidir: ne yapılacak, ne yapılmayacak, hangi
 * varsayımlar kabul edildi ve tamamlanma nasıl ölçülecek.
 *
 * Ajan tam olarak geri okuyabilsin diye `.ahi/specs/` altında JSON, insanlar
 * için ayrıca Markdown olarak saklanır.
 */

export const SPECS_DIR = path.join(AHI_DIR, AHI_SUBDIRS.specs);

export type SpecStatus = 'draft' | 'approved' | 'superseded';

export interface AcceptanceCriterion {
  id: string;
  text: string;
  done: boolean;
}

export interface TaskSpec {
  id: string;
  goal: string;
  scope: string[];
  outOfScope: string[];
  assumptions: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  /** Planın dokunmayı beklediği dosyalar; planlama sırasında doldurulur. */
  files: string[];
  risk: 'low' | 'medium' | 'high';
  status: SpecStatus;
  createdAt: number;
  updatedAt: number;
}

export interface SpecInput {
  goal?: string;
  scope?: string[];
  outOfScope?: string[];
  assumptions?: string[];
  acceptanceCriteria?: Array<string | { text: string; done?: boolean; id?: string }>;
  files?: string[];
  risk?: string;
}

export class SpecValidationError extends Error {}

function slugify(value: string): string {
  const ascii = String(value || '')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u')
    .replace(/Ç/g, 'c')
    .replace(/Ğ/g, 'g')
    .replace(/İ/g, 'i')
    .replace(/Ö/g, 'o')
    .replace(/Ş/g, 's')
    .replace(/Ü/g, 'u')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return ascii || 'spec';
}

function cleanList(value: unknown, maxItems = 50): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeCriteria(value: unknown): AcceptanceCriterion[] {
  if (!Array.isArray(value)) return [];
  const result: AcceptanceCriterion[] = [];
  value.forEach((item, index) => {
    if (typeof item === 'string') {
      const text = item.trim();
      if (text) result.push({ id: `ac-${index + 1}`, text, done: false });
      return;
    }
    if (!isRecord(item)) return;
    const text = typeof item.text === 'string' ? item.text.trim() : '';
    if (!text) return;
    result.push({
      id: typeof item.id === 'string' && item.id ? item.id : `ac-${index + 1}`,
      text,
      done: item.done === true
    });
  });
  return result.slice(0, 40);
}

export function validateSpec(input: TaskSpec): void {
  if (!input.goal.trim()) {
    throw new SpecValidationError('A spec must have a goal.');
  }
  if (input.acceptanceCriteria.length === 0) {
    throw new SpecValidationError('A spec must have at least one acceptance criterion.');
  }
  if (input.scope.length === 0) {
    throw new SpecValidationError('A spec must list at least one in-scope item.');
  }
}

export function renderSpecMarkdown(spec: TaskSpec): string {
  const lines: string[] = [
    `# ${spec.goal}`,
    '',
    `- **Spec:** \`${spec.id}\``,
    `- **Status:** ${spec.status}`,
    `- **Risk:** ${spec.risk}`,
    `- **Updated:** ${new Date(spec.updatedAt).toISOString()}`,
    ''
  ];

  if (spec.scope.length > 0) {
    lines.push('## In scope', '', ...spec.scope.map((item) => `- ${item}`), '');
  }
  if (spec.outOfScope.length > 0) {
    lines.push('## Out of scope', '', ...spec.outOfScope.map((item) => `- ${item}`), '');
  }
  if (spec.assumptions.length > 0) {
    lines.push('## Assumptions', '', ...spec.assumptions.map((item) => `- ${item}`), '');
  }
  if (spec.files.length > 0) {
    lines.push('## Files', '', ...spec.files.map((item) => `- \`${item}\``), '');
  }
  if (spec.acceptanceCriteria.length > 0) {
    lines.push(
      '## Acceptance criteria',
      '',
      ...spec.acceptanceCriteria.map((item) => `- [${item.done ? 'x' : ' '}] ${item.text}`),
      ''
    );
  }
  return lines.join('\n');
}

/**
 * Diskteki spec kaydını doğrular. Zorunlu alanlar (id, goal) yoksa `undefined`
 * döner ve çağıran kaydı atlar; eksik opsiyonel alanlar varsayılana düşer.
 */
function readSpecRecord(raw: Record<string, unknown>): TaskSpec | undefined {
  if (typeof raw.id !== 'string' || typeof raw.goal !== 'string') return undefined;
  if (!raw.id.trim() || !raw.goal.trim()) return undefined;

  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

  return {
    id: raw.id,
    goal: raw.goal,
    scope: strings(raw.scope),
    outOfScope: strings(raw.outOfScope),
    assumptions: strings(raw.assumptions),
    // Mevcut kimlikleri ve tamamlanma durumunu koru: normalizeCriteria hem
    // düz metin hem nesne biçimini kabul eder.
    acceptanceCriteria: normalizeCriteria(raw.acceptanceCriteria),
    files: strings(raw.files),
    risk: raw.risk === 'medium' || raw.risk === 'high' ? raw.risk : 'low',
    status: raw.status === 'approved' ? 'approved' : raw.status === 'superseded' ? 'superseded' : 'draft',
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now()
  };
}

export class SpecStore {
  private specs = new Map<string, TaskSpec>();

  private dir(workspaceRoot: string): string {
    return path.join(workspaceRoot, SPECS_DIR);
  }

  private fileFor(workspaceRoot: string, id: string): string {
    return path.join(this.dir(workspaceRoot), `${id}.json`);
  }

  public get(id: string): TaskSpec | undefined {
    return this.specs.get(id);
  }

  public list(): TaskSpec[] {
    return [...this.specs.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  public getApproved(): TaskSpec | undefined {
    return this.list().find((spec) => spec.status === 'approved');
  }

  public async load(workspaceRoot: string): Promise<void> {
    this.specs.clear();
    try {
      const files = await fs.readdir(this.dir(workspaceRoot));
      for (const file of files.filter((name) => name.endsWith('.json'))) {
        try {
          const raw: unknown = JSON.parse(
            await fs.readFile(path.join(this.dir(workspaceRoot), file), 'utf-8')
          );
          if (!isRecord(raw)) continue;
          // Diskteki JSON güvenilmez veridir: alanları tek tek okuyup
          // doğruluyoruz, cast etmiyoruz.
          const spec = readSpecRecord(raw);
          if (spec) {
            this.specs.set(spec.id, {
              ...spec,
              scope: cleanList(spec.scope),
              outOfScope: cleanList(spec.outOfScope),
              assumptions: cleanList(spec.assumptions),
              files: cleanList(spec.files),
              acceptanceCriteria: normalizeCriteria(spec.acceptanceCriteria)
            });
          }
        } catch {
          // Tek bozuk spec diğerlerini gizlememeli.
        }
      }
    } catch {
      // Henüz spec yok.
    }
  }

  public async save(workspaceRoot: string, spec: TaskSpec): Promise<TaskSpec> {
    const normalized: TaskSpec = {
      ...spec,
      goal: spec.goal.trim(),
      scope: cleanList(spec.scope),
      outOfScope: cleanList(spec.outOfScope),
      assumptions: cleanList(spec.assumptions),
      files: cleanList(spec.files),
      acceptanceCriteria: normalizeCriteria(spec.acceptanceCriteria),
      updatedAt: Date.now()
    };
    validateSpec(normalized);

    this.specs.set(normalized.id, normalized);
    const dir = this.dir(workspaceRoot);
    await fs.mkdir(dir, { recursive: true });
    await Promise.all([
      fs.writeFile(this.fileFor(workspaceRoot, normalized.id), JSON.stringify(normalized, null, 2), {
        encoding: 'utf-8',
        mode: 0o600
      }),
      fs.writeFile(path.join(dir, `${normalized.id}.md`), renderSpecMarkdown(normalized), {
        encoding: 'utf-8',
        mode: 0o600
      })
    ]);
    return normalized;
  }

  /** Model girdisinden yeni bir taslak spec oluşturur. */
  public async create(workspaceRoot: string, input: SpecInput): Promise<TaskSpec> {
    const goal = String(input.goal || '').trim();
    const baseId = `${slugify(goal)}-${new Date().toISOString().slice(0, 10)}`;
    let id = baseId;
    let suffix = 2;
    while (this.specs.has(id)) {
      id = `${baseId}-${suffix++}`;
    }

    const risk = input.risk === 'low' || input.risk === 'high' ? input.risk : 'medium';
    return this.save(workspaceRoot, {
      id,
      goal,
      scope: cleanList(input.scope),
      outOfScope: cleanList(input.outOfScope),
      assumptions: cleanList(input.assumptions),
      acceptanceCriteria: normalizeCriteria(input.acceptanceCriteria),
      files: cleanList(input.files),
      risk,
      status: 'draft',
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  }

  public async approve(workspaceRoot: string, id: string): Promise<TaskSpec> {
    const spec = this.specs.get(id);
    if (!spec) throw new SpecValidationError(`Spec not found: ${id}`);
    // Önce diğer tüm onaylı spec'leri geçersiz kıl: aynı anda en fazla bir
    // spec onaylı olabilir; böylece önceki görevin onaylı spec'i ilgisiz yeni
    // bir görevde `getApproved()` sonucunu karşılayamaz (kapı atlatma zinciri).
    for (const other of this.list()) {
      if (other.id !== id && other.status === 'approved') {
        await this.save(workspaceRoot, { ...other, status: 'superseded' });
      }
    }
    return this.save(workspaceRoot, { ...spec, status: 'approved' });
  }

  /** Doğrulamadan sonra bir kriteri karşılanmış (ya da değil) olarak işaretler. */
  public async setCriterionDone(
    workspaceRoot: string,
    id: string,
    criterionId: string,
    done: boolean
  ): Promise<TaskSpec> {
    const spec = this.specs.get(id);
    if (!spec) throw new SpecValidationError(`Spec not found: ${id}`);
    const criteria = spec.acceptanceCriteria.map((criterion) =>
      criterion.id === criterionId ? { ...criterion, done } : criterion
    );
    return this.save(workspaceRoot, { ...spec, acceptanceCriteria: criteria });
  }

  public isComplete(id: string): boolean {
    const spec = this.specs.get(id);
    if (!spec) return false;
    return spec.acceptanceCriteria.length > 0 && spec.acceptanceCriteria.every((item) => item.done);
  }

  public pendingCriteria(id: string): AcceptanceCriterion[] {
    const spec = this.specs.get(id);
    if (!spec) return [];
    return spec.acceptanceCriteria.filter((item) => !item.done);
  }

  /**
   * Onay kartı gösterimi: iş başlamadan önce kullanıcının kabul etmesi gerekenler.
   */
  public formatForDisplay(id: string): string {
    const spec = this.specs.get(id);
    if (!spec) return '';
    const lines = [
      `Hedef: ${spec.goal}`,
      `Risk: ${spec.risk}`,
      '',
      'Kapsam:',
      ...spec.scope.map((item) => `• ${item}`)
    ];
    if (spec.outOfScope.length > 0) {
      lines.push('', 'Kapsam dışı:', ...spec.outOfScope.map((item) => `• ${item}`));
    }
    if (spec.assumptions.length > 0) {
      lines.push('', 'Varsayımlar:', ...spec.assumptions.map((item) => `• ${item}`));
    }
    if (spec.files.length > 0) {
      lines.push('', 'Dosyalar:', ...spec.files.map((item) => `• ${item}`));
    }
    lines.push('', 'Kabul kriterleri:', ...spec.acceptanceCriteria.map((criterion) => `☐ ${criterion.text}`));
    return lines.join('\n');
  }

  /**
   * Spec'i sistem istemi için biçimlendirir. Yalnızca mevcut iş akışına açıkça
   * bağlı spec dahil edilir; kimlik yoksa hiçbir şey enjekte edilmez, böylece
   * eski bir görevin kabul kriterleri yeni göreve sızamaz.
   */
  public formatForPrompt(id?: string): string {
    const spec = id ? this.specs.get(id) : undefined;
    if (!spec) return '';

    const lines = [
      '=== TASK SPEC ===',
      `Spec: ${spec.id} (${spec.status})`,
      `Goal: ${spec.goal}`,
      `Risk: ${spec.risk}`
    ];
    if (spec.scope.length > 0) lines.push(`In scope: ${spec.scope.join('; ')}`);
    if (spec.outOfScope.length > 0) lines.push(`Out of scope: ${spec.outOfScope.join('; ')}`);
    if (spec.assumptions.length > 0) lines.push(`Assumptions: ${spec.assumptions.join('; ')}`);
    if (spec.files.length > 0) lines.push(`Files: ${spec.files.join(', ')}`);
    lines.push('Acceptance criteria:');
    for (const criterion of spec.acceptanceCriteria) {
      lines.push(`- [${criterion.done ? 'x' : ' '}] ${criterion.id}: ${criterion.text}`);
    }
    lines.push(
      'Rules: do not expand beyond the stated scope without asking. Do not claim completion before the criteria are met.',
      '=== END OF SPEC ==='
    );
    return `\n\n${lines.join('\n')}`;
  }
}
