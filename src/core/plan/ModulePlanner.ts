import { ModuleLayer, ModulePlan, ProjectModule } from '../../shared/types';

/**
 * Endüstriyel modül haritası.
 *
 * Ajan kod yazmadan önce projeyi katmanlı modüllere ayırır: hangi modül, hangi
 * katmanda, hangi dosyaları sahipleniyor, neyden bağımsız ve onu hangi uzman
 * yazacak. Plan adımları bu haritaya `moduleId` ile bağlanır; böylece "hangi
 * sırayla yazılacak" sorusu modelin sezgisine kalmaz.
 *
 * Katman kuralı bilinçli olarak katıdır: bağımlılık yönü arayüzden alana
 * doğrudur. Alan katmanı arayüze ya da altyapıya bağlanamaz; bu, döngüsel
 * bağımlılıkların mimariye sızmasını daha plan aşamasında engeller.
 */

/** Katmanların bağımlı olabileceği katmanlar. */
const ALLOWED_DEPENDENCIES: Record<ModuleLayer, ReadonlySet<ModuleLayer>> = {
  // Arayüz her katmanı kullanabilir.
  interface: new Set<ModuleLayer>(['interface', 'application', 'domain', 'infrastructure', 'shared']),
  // Uygulama katmanı alanı ve altyapıyı kullanır, arayüze uzanmaz.
  application: new Set<ModuleLayer>(['application', 'domain', 'infrastructure', 'shared']),
  // Alan katmanı yalnızca kendi katmanına ve paylaşılan yardımcılara bağlıdır.
  domain: new Set<ModuleLayer>(['domain', 'shared']),
  // Altyapı kendi katmanına ve paylaşılan yardımcılara bağlıdır.
  infrastructure: new Set<ModuleLayer>(['infrastructure', 'shared']),
  shared: new Set<ModuleLayer>(['shared']),
  // Test ve dokümantasyon her şeye bağlanabilir; üretim kodunun bağımlı
  // olmadığı için katman yönü ihlali sayılmaz.
  test: new Set<ModuleLayer>([
    'test',
    'docs',
    'interface',
    'application',
    'domain',
    'infrastructure',
    'shared'
  ]),
  docs: new Set<ModuleLayer>(['docs', 'test'])
};

export const MODULE_LAYERS: ModuleLayer[] = [
  'shared',
  'domain',
  'infrastructure',
  'application',
  'interface',
  'test',
  'docs'
];

/** Katmanların yazılma sırası: alttaki katmanlar önce gelir. */
const LAYER_ORDER: Record<ModuleLayer, number> = {
  shared: 0,
  domain: 1,
  infrastructure: 2,
  application: 3,
  interface: 4,
  test: 5,
  docs: 6
};

export interface ModuleInput {
  id?: string;
  name?: string;
  layer?: string;
  paths?: string[];
  responsibility?: string;
  dependsOn?: string[];
  ownerRole?: string;
  criteria?: string[];
}

export interface ModulePlanInput {
  goal?: string;
  modules?: ModuleInput[];
}

export class ModulePlanValidationError extends Error {}

function toSlug(value: string, fallback: string): string {
  const ascii = value
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
    .slice(0, 40);
  return ascii || fallback;
}

function cleanList(value: unknown, max = 60): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max);
}

export class ModulePlanner {
  private plan?: ModulePlan;

  public getPlan(): ModulePlan | undefined {
    return this.plan ? JSON.parse(JSON.stringify(this.plan)) : undefined;
  }

  public hasPlan(): boolean {
    return Boolean(this.plan && this.plan.modules.length > 0);
  }

  public clear(): void {
    this.plan = undefined;
  }

  public hydrate(plan?: ModulePlan): void {
    if (!plan || !Array.isArray(plan.modules) || plan.modules.length === 0) {
      this.plan = undefined;
      return;
    }
    this.plan = {
      goal: plan.goal || '',
      modules: plan.modules.map((module) => ({
        id: module.id,
        name: module.name,
        layer: MODULE_LAYERS.includes(module.layer) ? module.layer : 'application',
        paths: Array.isArray(module.paths) ? module.paths : [],
        responsibility: module.responsibility || '',
        dependsOn: Array.isArray(module.dependsOn) ? module.dependsOn : [],
        ownerRole: module.ownerRole || 'coder',
        criteria: Array.isArray(module.criteria) ? module.criteria : []
      })),
      updatedAt: plan.updatedAt || Date.now()
    };
  }

  /** Modelden gelen modül haritasını doğrular ve normalize eder. */
  public update(input: ModulePlanInput): ModulePlan {
    const rawModules = Array.isArray(input.modules) ? input.modules : [];
    if (rawModules.length === 0) {
      throw new ModulePlanValidationError('A module plan must contain at least one module.');
    }

    const usedIds = new Set<string>();
    const modules: ProjectModule[] = rawModules.map((raw, index) => {
      const name = String(raw.name || '').trim();
      if (!name) {
        throw new ModulePlanValidationError(`A name is required for module #${index + 1}.`);
      }
      const layerInput = String(raw.layer || 'application')
        .trim()
        .toLowerCase();
      if (!MODULE_LAYERS.includes(layerInput as ModuleLayer)) {
        throw new ModulePlanValidationError(
          `Module "${name}" has an unknown layer "${raw.layer}". Allowed: ${MODULE_LAYERS.join(', ')}.`
        );
      }
      const layer = layerInput as ModuleLayer;

      let id = String(raw.id || '').trim() || toSlug(name, `module-${index + 1}`);
      const baseId = id;
      let suffix = 2;
      while (usedIds.has(id)) {
        id = `${baseId}-${suffix++}`;
      }
      usedIds.add(id);

      const paths = cleanList(raw.paths);
      if (paths.length === 0) {
        throw new ModulePlanValidationError(`Module "${name}" must declare at least one path.`);
      }
      const responsibility = String(raw.responsibility || '').trim();
      if (!responsibility) {
        throw new ModulePlanValidationError(`Module "${name}" must declare a one-line responsibility.`);
      }

      return {
        id,
        name,
        layer,
        paths,
        responsibility,
        dependsOn: cleanList(raw.dependsOn),
        ownerRole: String(raw.ownerRole || 'coder').trim() || 'coder',
        criteria: cleanList(raw.criteria)
      };
    });

    this.validate(modules);

    this.plan = {
      goal: String(input.goal || '').trim(),
      modules,
      updatedAt: Date.now()
    };
    return this.getPlan()!;
  }

  /** Bağımlılık kimlikleri, katman yönü ve döngüler denetlenir. */
  private validate(modules: ProjectModule[]): void {
    const byId = new Map(modules.map((module) => [module.id.toLowerCase(), module]));

    for (const module of modules) {
      module.dependsOn = module.dependsOn.map((dependency) => {
        const target = byId.get(dependency.toLowerCase());
        if (!target) {
          throw new ModulePlanValidationError(
            `Module "${module.id}" depends on an unknown module: "${dependency}".`
          );
        }
        if (target.id === module.id) {
          throw new ModulePlanValidationError(`Module "${module.id}" cannot depend on itself.`);
        }
        if (!ALLOWED_DEPENDENCIES[module.layer].has(target.layer)) {
          throw new ModulePlanValidationError(
            `Layering violation: ${module.layer} module "${module.id}" cannot depend on ` +
              `${target.layer} module "${target.id}". Dependencies point toward the domain ` +
              `(interface → application → domain; infrastructure and shared are below).`
          );
        }
        return target.id;
      });
    }

    // Döngü tespiti: açık yığınlı DFS (modül sayısı önceden bilinmiyor).
    const state = new Map<string, 'visiting' | 'visited'>();
    const byKey = new Map(modules.map((module) => [module.id, module]));

    interface Frame {
      id: string;
      deps: string[];
      index: number;
    }

    for (const module of modules) {
      if (state.get(module.id) === 'visited') continue;
      const stack: Frame[] = [{ id: module.id, deps: byKey.get(module.id)?.dependsOn ?? [], index: 0 }];
      state.set(module.id, 'visiting');

      while (stack.length > 0) {
        const frame = stack[stack.length - 1];
        if (!frame) break;
        if (frame.index >= frame.deps.length) {
          state.set(frame.id, 'visited');
          stack.pop();
          continue;
        }
        const dependency = frame.deps[frame.index];
        frame.index++;
        if (!dependency) continue;

        const dependencyState = state.get(dependency);
        if (dependencyState === 'visiting') {
          const path = stack.map((item) => item.id);
          throw new ModulePlanValidationError(
            `Circular module dependency: ${[...path, dependency].join(' -> ')}.`
          );
        }
        if (dependencyState === 'visited') continue;
        state.set(dependency, 'visiting');
        stack.push({
          id: dependency,
          deps: byKey.get(dependency)?.dependsOn ?? [],
          index: 0
        });
      }
    }
  }

  /**
   * Modüllerin yazılma sırası: önce katman, sonra bağımlılık.
   *
   * Aynı katmandaki modüller birbirine bağlıysa bağımlılık önce gelir; böylece
   * alt modül hazır olmadan üst modül yazılmaz.
   */
  public getBuildOrder(): ProjectModule[] {
    if (!this.plan) return [];
    const completed = new Set<string>();
    const ordered: ProjectModule[] = [];
    const remaining = [...this.plan.modules].sort(
      (a, b) => LAYER_ORDER[a.layer] - LAYER_ORDER[b.layer] || a.id.localeCompare(b.id)
    );

    // Katman sırası zaten döngüsüz olduğundan tek geçiş yeterli olur; yine de
    // güvenli tarafta kalmak için hazır olmayan modüller sonraki tura bırakılır.
    let guard = remaining.length * remaining.length + remaining.length;
    while (remaining.length > 0 && guard-- > 0) {
      const index = remaining.findIndex((module) =>
        module.dependsOn.every((dependency) => completed.has(dependency))
      );
      if (index < 0) break;
      const [next] = remaining.splice(index, 1);
      if (!next) break;
      ordered.push(next);
      completed.add(next.id);
    }

    return ordered.length > 0 ? ordered : remaining;
  }

  /** Plan adımlarının sırasına göre model bağlamına eklenecek modül haritası. */
  public formatForPrompt(): string {
    if (!this.plan) return '';
    const order = this.getBuildOrder();
    const lines = order.map((module, index) => {
      const deps = module.dependsOn.length > 0 ? ` — depends on: ${module.dependsOn.join(', ')}` : '';
      const criteria = module.criteria.length > 0 ? ` — criteria: ${module.criteria.join(', ')}` : '';
      return (
        `${index + 1}. [${module.layer}] ${module.id} (${module.name}) — @${module.ownerRole}\n` +
        `   paths: ${module.paths.join(', ')}\n` +
        `   responsibility: ${module.responsibility}${deps}${criteria}`
      );
    });

    return `\n\n=== MODULE MAP (.ahi module plan) ===
Goal: ${this.plan.goal || '(not specified)'}
Write the modules in this order. Each module is a separate unit of work with a single responsibility:
${lines.join('\n')}

Module rules:
- Write lower layers first (shared → domain → infrastructure → application → interface); a module may only use modules it depends on.
- Never import an upper layer from a lower one: the domain must not know about the interface or the infrastructure.
- Finish (and verify) a module before starting the next one; do not spread a half-finished change across modules.
- Plan steps must reference these module ids; a step may not touch files outside its module paths.
=== END OF MODULE MAP ===`;
  }

  public formatForTool(): string {
    if (!this.plan) return 'No module plan.';
    return [
      `Module plan updated: ${this.plan.goal || '(goal not specified)'}`,
      ...this.getBuildOrder().map(
        (module, index) =>
          `${index + 1}. [${module.layer}] ${module.id}: ${module.name} — @${module.ownerRole}`
      ),
      `Summary: ${this.plan.modules.length} modules across ${new Set(this.plan.modules.map((m) => m.layer)).size} layers`
    ].join('\n');
  }
}
