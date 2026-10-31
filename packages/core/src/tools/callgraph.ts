/**
 * Çağrı haritası araçları (hepsi salt-okunur).
 *
 * Bu araçlar plan modunda da açıktır: hiçbiri dosya yazmaz, komut çalıştırmaz.
 * Harita hazır değilse her araç "hazırlanıyor" durumunu döndürür ve ajan eski
 * yönteme (arama, dosya okuma) dönebilir.
 */
import { ToolDefinition } from './base';
import type { CallGraphPort } from './contracts';
import {
  analyzeCallGraphImpact,
  clampDepth,
  findCallees,
  findCallers,
  limitNeighbors,
  nodeLabel,
  resolveNodes,
  suggestNodes
} from '../core/callgraph/query';
import type { CallGraphDocument, CallGraphNeighbor } from '../core/callgraph/types';

/** Araç çıktısında gösterilecek en fazla düğüm. */
const MAX_LISTED = 30;

function managerFrom(context: { callGraph?: CallGraphPort }): CallGraphPort | undefined {
  return context.callGraph;
}

function notReady(manager: CallGraphPort | undefined, workspaceRoot?: string): string | undefined {
  if (!manager) return 'Çağrı haritası bu çalışma alanında kullanılamıyor.';
  const status = manager.status(workspaceRoot);
  if (status.ready) return undefined;
  return (
    `${status.message} ` +
    'Harita hazır olana kadar `search_files` ve `read_file` ile devam edin; ' +
    'sonucu planda "çağrı haritası henüz hazır değil" diye belirtin.'
  );
}

/** Ortak komşu biçimlendirme: dosya:satır ad + satırlar + güven. */
function formatNeighbors(neighbors: CallGraphNeighbor[], label: string): string[] {
  const { items, omitted } = limitNeighbors(neighbors, MAX_LISTED);
  const lines = items.map((neighbor) => {
    const callLines = neighbor.lines.length > 0 ? ` (satır ${neighbor.lines.join(', ')})` : '';
    const estimated = neighbor.confidence === 'estimated' ? ' [tahmini]' : '';
    return `- ${nodeLabel(neighbor.node)}${callLines}${estimated}`;
  });
  if (omitted > 0) lines.push(`… ${omitted} sonuç daha (derinliği azaltın).`);
  return [`${label} (${neighbors.length}):`, ...lines];
}

/** Düğüm çözümleme ve "bulunamadı" durumunu ortak yönetir. */
function resolveOrSuggest(
  document: CallGraphDocument,
  query: string
): {
  nodes: ReturnType<typeof resolveNodes>;
  message?: string;
} {
  const nodes = resolveNodes(document, query);
  if (nodes.length > 0) return { nodes };

  const suggestions = suggestNodes(document, query);
  if (suggestions.length === 0) {
    return { nodes: [], message: `"${query}" haritada bulunamadı.` };
  }
  return {
    nodes: [],
    message:
      `"${query}" tam eşleşmedi. Benzer adlar:\n` +
      suggestions.map((node) => `- ${nodeLabel(node)}`).join('\n')
  };
}

export const getCallersTool: ToolDefinition = {
  name: 'get_callers',
  description:
    'Lists the functions or methods that call a given symbol, grouped by depth. Read-only; safe in plan mode.',
  parameters: {
    type: 'object',
    properties: {
      symbol: {
        type: 'string',
        description: 'Symbol name, file#name, or an exact node id.'
      },
      depth: {
        type: 'number',
        description: 'Kaç seviye yukarı izleneceği (varsayılan 1). 0 = sınırsız.'
      }
    },
    required: ['symbol']
  },
  execute: async (args, context) => {
    const manager = managerFrom(context);
    const early = notReady(manager, context.workspaceRoot);
    if (early) return early;

    const workspaceRoot = context.workspaceRoot;
    if (!workspaceRoot) return 'Açık bir çalışma alanı yok.';
    const document = manager?.getDocument(workspaceRoot);
    if (!document) return 'Çağrı haritası hazır değil.';

    const query = String(args.symbol || '').trim();
    if (!query) return 'Sembol adı gerekli.';

    const resolved = resolveOrSuggest(document, query);
    if (resolved.message) return resolved.message;

    const depth = clampDepth(Number(args.depth));
    const callers = findCallers(
      document,
      resolved.nodes.map((node) => node.id),
      depth
    );
    if (callers.length === 0) {
      return (
        `Haritaya göre "${query}" sembolünü çağıran kimse yok. ` +
        'Bu, haritanın dışından (başka paket, dinamik çağrı) kullanılmadığı anlamına gelmez.'
      );
    }

    return formatNeighbors(callers, `Çağıranlar (derinlik ${depth})`).join('\n');
  }
};

export const getCalleesTool: ToolDefinition = {
  name: 'get_callees',
  description:
    'Lists what a given symbol calls, grouped by depth, plus the number of calls leaving the project. Read-only.',
  parameters: {
    type: 'object',
    properties: {
      symbol: { type: 'string', description: 'Symbol name, file#name, or an exact node id.' },
      depth: { type: 'number', description: 'Kaç seviye aşağı izleneceği (varsayılan 1). 0 = sınırsız.' }
    },
    required: ['symbol']
  },
  execute: async (args, context) => {
    const manager = managerFrom(context);
    const early = notReady(manager, context.workspaceRoot);
    if (early) return early;

    const workspaceRoot = context.workspaceRoot;
    if (!workspaceRoot) return 'Açık bir çalışma alanı yok.';
    const document = manager?.getDocument(workspaceRoot);
    if (!document) return 'Çağrı haritası hazır değil.';

    const query = String(args.symbol || '').trim();
    if (!query) return 'Sembol adı gerekli.';

    const resolved = resolveOrSuggest(document, query);
    if (resolved.message) return resolved.message;

    const depth = clampDepth(Number(args.depth));
    const callees = findCallees(
      document,
      resolved.nodes.map((node) => node.id),
      depth
    );

    const externalCalls = resolved.nodes.reduce(
      (total, node) => total + (document.files[node.file]?.externalCalls ?? 0),
      0
    );

    const lines =
      callees.length === 0
        ? ['Haritaya göre bu sembol proje içinde başka bir şeyi çağırmıyor.']
        : formatNeighbors(callees, `Çağrılanlar (derinlik ${depth})`);

    if (externalCalls > 0) {
      lines.push(`Proje dışına yapılan çağrı sayısı: ${externalCalls} (ayrı düğüm olarak tutulmaz).`);
    }
    return lines.join('\n');
  }
};

export const callGraphImpactTool: ToolDefinition = {
  name: 'call_graph_impact',
  description:
    'Finds affected functions, files and tests for one or more symbols. Read-only; used by planning and verification.',
  parameters: {
    type: 'object',
    properties: {
      symbols: {
        type: 'array',
        description: 'Symbol names or ids to analyze.',
        items: { type: 'string' }
      },
      depth: { type: 'number', description: 'Gezinme derinliği (varsayılan 2). 0 = sınırsız.' }
    },
    required: ['symbols']
  },
  execute: async (args, context) => {
    const manager = managerFrom(context);
    const early = notReady(manager, context.workspaceRoot);
    if (early) return early;

    const workspaceRoot = context.workspaceRoot;
    if (!workspaceRoot) return 'Açık bir çalışma alanı yok.';
    const document = manager?.getDocument(workspaceRoot);
    if (!document) return 'Çağrı haritası hazır değil.';

    const raw = Array.isArray(args.symbols) ? args.symbols : [];
    const queries = raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    if (queries.length === 0) return 'En az bir sembol adı gerekli.';

    const nodes = queries.flatMap((query) => resolveNodes(document, query));
    if (nodes.length === 0) {
      const suggestions = queries.flatMap((query) => suggestNodes(document, query));
      if (suggestions.length === 0) return `Semboller haritada bulunamadı: ${queries.join(', ')}`;
      return (
        'Tam eşleşme yok. Benzer adlar:\n' + suggestions.map((node) => `- ${nodeLabel(node)}`).join('\n')
      );
    }

    const depth = clampDepth(Number(args.depth) || 2);
    const impact = analyzeCallGraphImpact(
      document,
      nodes.map((node) => node.id),
      depth
    );

    const sections: string[] = [`Etkilenen semboller: ${nodes.map(nodeLabel).join(', ')}`];

    if (impact.directCallers.length > 0) {
      sections.push(formatNeighbors(impact.directCallers, 'Doğrudan çağıranlar').join('\n'));
    }
    if (impact.indirectCallers.length > 0) {
      sections.push(formatNeighbors(impact.indirectCallers, 'Dolaylı çağıranlar').join('\n'));
    }
    if (impact.affectedTests.length > 0) {
      sections.push(formatNeighbors(impact.affectedTests, 'Etkilenen testler').join('\n'));
    }

    sections.push(
      `Etkilenen dosyalar (${impact.affectedFiles.length}):\n` +
        impact.affectedFiles
          .slice(0, MAX_LISTED)
          .map((file) => `- ${file}`)
          .join('\n')
    );

    if (impact.warnings.length > 0) {
      sections.push('Uyarılar:\n' + impact.warnings.map((warning) => `- ${warning}`).join('\n'));
    }
    sections.push(
      'Not: Bu sonuç haritaya dayanır. Dinamik çağrılar, geri çağrılar ve başka paketlerden ' +
        'gelen kullanımlar görünmez; "kesinlikle etkilenmez" değil, "haritaya göre etkilenmiyor" denir.'
    );

    return sections.join('\n\n');
  }
};

export const findRelatedTool: ToolDefinition = {
  name: 'find_related_code',
  description:
    'Finds entry points related to keywords and shows their one-level neighbourhood. Use it while understanding a request. Read-only.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Keywords or symbol names.' }
    },
    required: ['query']
  },
  execute: async (args, context) => {
    const manager = managerFrom(context);
    const early = notReady(manager, context.workspaceRoot);
    if (early) return early;

    const workspaceRoot = context.workspaceRoot;
    if (!workspaceRoot) return 'Açık bir çalışma alanı yok.';
    const document = manager?.getDocument(workspaceRoot);
    if (!document) return 'Çağrı haritası hazır değil.';

    const query = String(args.query || '').trim();
    if (!query) return 'Arama metni gerekli.';

    const matches = suggestNodes(document, query, 10);
    if (matches.length === 0) {
      return `"${query}" ile eşleşen sembol bulunamadı.`;
    }

    const sections = [`Eşleşen başlangıç düğümleri (${matches.length}):`];
    for (const match of matches.slice(0, 5)) {
      const callers = findCallers(document, [match.id], 1).length;
      const callees = findCallees(document, [match.id], 1).length;
      sections.push(
        `- ${nodeLabel(match)} · ${callers} çağıran · ${callees} çağrılan` +
          (match.exported ? ' · dışa aktarılan' : '')
      );
    }
    return sections.join('\n');
  }
};

export const callGraphStatusTool: ToolDefinition = {
  name: 'call_graph_status',
  description:
    'Reports call graph state: last update, node/edge counts, incomplete files and whether a scan is running. Read-only.',
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async (_args, context) => {
    const manager = managerFrom(context);
    const workspaceRoot = context.workspaceRoot;
    if (!manager) return 'Çağrı haritası bu çalışma alanında kullanılamıyor.';

    const status = manager.status(workspaceRoot);
    const lines = [status.message];

    if (status.meta) {
      const meta = status.meta;
      lines.push(
        `- Düğüm: ${meta.nodeCount} · İlişki: ${meta.edgeCount} · Dosya: ${meta.fileCount}`,
        `- Eksik/kısmi dosya: ${meta.incompleteFiles}`,
        `- Son güncelleme: ${new Date(meta.updatedAt).toISOString()}`
      );
    }
    if (status.building) {
      lines.push(`- Tarama sürüyor: %${status.progress ?? 0}`);
    }
    return lines.join('\n');
  }
};
