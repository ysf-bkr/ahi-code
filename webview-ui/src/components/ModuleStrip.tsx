import React, { useMemo, useState } from 'react';
import { Boxes, ChevronDown, ChevronRight } from 'lucide-react';
import { ModuleLayer, ModulePlan, TaskPlan } from '@shared/types';

export interface ModuleStripProps {
  modules?: ModulePlan;
  plan?: TaskPlan;
  /** Kod yazma aşamasına geçildi mi? Modül sırası o zaman anlam kazanır. */
  building: boolean;
}

const LAYER_LABEL: Record<ModuleLayer, string> = {
  shared: 'Ortak',
  domain: 'Alan',
  infrastructure: 'Altyapı',
  application: 'Uygulama',
  interface: 'Arayüz',
  test: 'Test',
  docs: 'Belge'
};

const LAYER_TONE: Record<ModuleLayer, string> = {
  shared: 'ahi-text-muted',
  domain: 'ahi-text-success',
  infrastructure: 'ahi-text-warning',
  application: 'ahi-text-info',
  interface: 'ahi-text-brand',
  test: 'ahi-text-muted',
  docs: 'ahi-text-muted'
};

const LAYER_ORDER: Record<ModuleLayer, number> = {
  shared: 0,
  domain: 1,
  infrastructure: 2,
  application: 3,
  interface: 4,
  test: 5,
  docs: 6
};

/**
 * Modül haritası şeridi.
 *
 * Endüstriyel akışta kod, katmanlı modüller hâlinde ve alt katmandan üst
 * katmana doğru yazılır. Şerit bu sırayı ve her modülün hangi adıma bağlı
 * olduğunu gösterir; kullanıcı "şimdi ne yazılıyor" sorusunu tek bakışta görür.
 */
export const ModuleStrip: React.FC<ModuleStripProps> = ({ modules, plan, building }) => {
  const [open, setOpen] = useState(false);

  const ordered = useMemo(() => {
    if (!modules) return [];
    return [...modules.modules].sort(
      (a, b) => LAYER_ORDER[a.layer] - LAYER_ORDER[b.layer] || a.id.localeCompare(b.id)
    );
  }, [modules]);

  if (!modules || ordered.length === 0) return null;

  const stepByModule = new Map<string, string>();
  for (const step of plan?.steps ?? []) {
    if (step.moduleId && !stepByModule.has(step.moduleId)) {
      stepByModule.set(step.moduleId, step.status);
    }
  }
  const completed = ordered.filter((module) => stepByModule.get(module.id) === 'completed').length;

  return (
    <div className="overflow-hidden rounded-md border ahi-border-surface ahi-bg-surface">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="composer-dock-modules"
        title={open ? 'Modül haritasını gizle' : 'Modül haritasını göster'}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left transition hover:bg-[var(--ahi-hover-bg)]"
      >
        {open ? (
          <ChevronDown className="ahi-icon-xs shrink-0" />
        ) : (
          <ChevronRight className="ahi-icon-xs shrink-0" />
        )}
        <Boxes className="ahi-icon-sm shrink-0 ahi-text-info" />
        <span className="text-sm min-w-0 flex-1 truncate font-medium ahi-text-fg">
          {modules.goal || 'Modül haritası'}
        </span>
        <span className="shrink-0 font-mono text-xs ahi-text-muted">
          {ordered.length} modül{completed > 0 ? ` · ${completed} bitti` : ''}
        </span>
        {!building && <span className="shrink-0 text-xs ahi-text-warning">kod öncesi</span>}
      </button>

      {open && (
        <ol
          id="composer-dock-modules"
          className="max-h-52 space-y-0.5 overflow-y-auto border-t ahi-border-surface px-2 py-1.5"
        >
          {ordered.map((module, index) => {
            const status = stepByModule.get(module.id);
            return (
              <li
                key={module.id}
                className="flex items-start gap-2 rounded px-1 py-0.5 text-xs"
                title={module.responsibility}
              >
                <span className="shrink-0 font-mono text-2xs ahi-text-muted">{index + 1}.</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className={`shrink-0 text-2xs font-semibold ${LAYER_TONE[module.layer]}`}>
                      {LAYER_LABEL[module.layer]}
                    </span>
                    <span className="truncate ahi-text-fg">{module.name}</span>
                    <span className="shrink-0 font-mono text-2xs ahi-text-muted">@{module.ownerRole}</span>
                    {status && (
                      <span
                        className={`shrink-0 text-2xs ${
                          status === 'completed'
                            ? 'ahi-text-success'
                            : status === 'in_progress'
                              ? 'ahi-text-info'
                              : status === 'blocked'
                                ? 'ahi-text-error'
                                : 'ahi-text-muted'
                        }`}
                      >
                        {status === 'completed'
                          ? 'bitti'
                          : status === 'in_progress'
                            ? 'yazılıyor'
                            : status === 'blocked'
                              ? 'engelli'
                              : 'bekliyor'}
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-2xs ahi-text-muted">{module.paths.join(', ')}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
};
