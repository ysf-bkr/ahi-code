/**
 * Çağrı grafiği ekranı için sorgu çözücüsü.
 *
 * Motorun çağrı grafiği haritasını arayüz "nereden görülüp incelenecek?"
 * sorusunun cevabıdır: durum, sembol arama ve çağıran/çağrılan komşuları tek
 * istek-yanıt sözleşmesine indirger. SidebarProvider yalnızca taşıyıcıdır;
 * tüm mantık burada ve vscode bağımlılığı olmadan sınanabilir.
 */
import { CallGraphManager } from '@ahicode/core/core/callgraph/CallGraphManager';
import { clampDepth, findCallers, findCallees, suggestNodes } from '@ahicode/core/core/callgraph/query';
import type { CallGraphDocument, CallGraphNode, CallGraphNeighbor } from '@ahicode/core/core/callgraph/types';
import {
  CallGraphPanelNeighbor,
  CallGraphPanelNode,
  CallGraphPanelRequest,
  CallGraphPanelResult
} from '@ahicode/core/shared/types';

/** Çözücünün ihtiyaç duyduğu dar yüzey; testler sahte yöneticiyle beslenir. */
export type CallGraphPanelSource = Pick<CallGraphManager, 'ensureReady' | 'getDocument' | 'rebuild'>;

function toPanelNode(node: CallGraphNode): CallGraphPanelNode {
  return {
    id: node.id,
    name: node.name,
    kind: node.kind,
    file: node.file,
    startLine: node.startLine,
    exported: node.exported,
    isTest: node.isTest,
    className: node.className
  };
}

function toPanelNeighbor(neighbor: CallGraphNeighbor): CallGraphPanelNeighbor {
  return { ...toPanelNode(neighbor.node), depth: neighbor.depth, lines: neighbor.lines };
}

function statsOf(document: CallGraphDocument | undefined) {
  if (!document) return undefined;
  const files = Object.values(document.files);
  return {
    files: files.length,
    nodes: document.meta.nodeCount,
    edges: document.meta.edgeCount,
    updatedAt: document.meta.updatedAt,
    incompleteFiles: files.filter((file) => file.status !== 'complete').length
  };
}

export async function resolveCallGraphPanelRequest(
  manager: CallGraphPanelSource,
  workspaceRoot: string | undefined,
  request: CallGraphPanelRequest
): Promise<CallGraphPanelResult> {
  const base: CallGraphPanelResult = {
    action: request.action,
    ready: false,
    building: false,
    message: ''
  };
  if (!workspaceRoot) {
    return { ...base, message: 'Aktif bir çalışma alanı klasörü yok.' };
  }

  if (request.action === 'rebuild') {
    const status = await manager.rebuild(workspaceRoot);
    return {
      ...base,
      ready: status.ready,
      building: status.building,
      progress: status.progress,
      message: status.message,
      stats: statsOf(manager.getDocument(workspaceRoot))
    };
  }

  const status = await manager.ensureReady(workspaceRoot);
  const document = manager.getDocument(workspaceRoot);
  if (request.action === 'status') {
    return {
      ...base,
      ready: status.ready,
      building: status.building,
      progress: status.progress,
      message: status.message,
      stats: statsOf(document)
    };
  }

  if (!document) {
    return {
      ...base,
      ready: status.ready,
      building: status.building,
      progress: status.progress,
      message: status.message || 'Çağrı haritası henüz hazır değil.'
    };
  }

  if (request.action === 'search') {
    return {
      ...base,
      ready: true,
      message: status.message,
      stats: statsOf(document),
      matches: suggestNodes(document, request.query || '', 30).map(toPanelNode)
    };
  }

  // neighbors: seçili düğümün çağıranları ve çağrılanları.
  const node = document.nodes.find((candidate) => candidate.id === request.nodeId);
  if (!node) {
    return { ...base, ready: true, message: 'Düğüm haritada bulunamadı.', stats: statsOf(document) };
  }
  const depth = clampDepth(request.depth ?? 2);
  return {
    ...base,
    ready: true,
    message: status.message,
    stats: statsOf(document),
    callers: findCallers(document, [node.id], depth).map(toPanelNeighbor),
    callees: findCallees(document, [node.id], depth).map(toPanelNeighbor)
  };
}
