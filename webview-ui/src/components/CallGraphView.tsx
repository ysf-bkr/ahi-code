import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Search,
  RefreshCw,
  Loader2,
  GitBranch,
  CornerDownLeft,
  CornerUpRight,
  FileCode,
  Network
} from 'lucide-react';
import { CallGraphPanelNode, CallGraphPanelResult, NavigationDestination } from '@shared/types';
import { ScreenHeader } from './ScreenHeader';
import { Badge, Button, Card, EmptyState, IconButton, Input, Section, SectionTitle } from './ui';
import { vscode } from '../utils/vscode';

interface CallGraphViewProps {
  onBack: () => void;
  onSelectMenu?: (destination: NavigationDestination) => void;
  changedFileCount?: number;
}

const request = (payload: {
  action: 'status' | 'search' | 'neighbors' | 'rebuild';
  query?: string;
  nodeId?: string;
}) => vscode.postMessage({ type: 'CALLGRAPH_QUERY', payload });

/** Düğüm satırı: ad, imza konumu ve rozetler; tıklayınca komşular yüklenir. */
const NodeRow: React.FC<{
  node: CallGraphPanelNode;
  selected: boolean;
  onSelect: (node: CallGraphPanelNode) => void;
}> = ({ node, selected, onSelect }) => (
  <button
    type="button"
    onClick={() => onSelect(node)}
    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition hover:opacity-85 ${
      selected ? 'ahi-bg-brand-soft ahi-text-brand' : 'ahi-text-fg'
    }`}
  >
    <FileCode className="ahi-icon-xs shrink-0 ahi-text-muted" />
    <span className="min-w-0 flex-1">
      <span className="block truncate font-medium">
        {node.className ? `${node.className}.${node.name}` : node.name}
      </span>
      <span className="block truncate font-mono text-2xs ahi-text-muted">
        {node.file}:{node.startLine}
      </span>
    </span>
    <Badge tone="muted">{node.kind}</Badge>
    {node.isTest && <Badge tone="info">test</Badge>}
  </button>
);

const NeighborList: React.FC<{
  title: string;
  icon: React.ReactNode;
  neighbors: CallGraphPanelResult['callers'];
  onSelect: (node: CallGraphPanelNode) => void;
}> = ({ title, icon, neighbors, onSelect }) => (
  <div className="space-y-1">
    <SectionTitle icon={icon} title={title} count={neighbors?.length ?? 0} />
    {neighbors && neighbors.length > 0 ? (
      neighbors.map((neighbor) => (
        <button
          key={`${neighbor.id}-${neighbor.depth}`}
          type="button"
          onClick={() => onSelect(neighbor)}
          className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs ahi-text-fg hover:opacity-85"
          title={`${neighbor.file}:${neighbor.lines.join(', ')} · ${neighbor.depth}. kademe`}
        >
          <span className="min-w-0 flex-1 truncate">{neighbor.name}</span>
          <span className="shrink-0 font-mono text-2xs ahi-text-muted">
            {neighbor.file}:{neighbor.lines[0] ?? neighbor.startLine}
          </span>
          <Badge tone={neighbor.depth === 1 ? 'brand' : 'muted'}>{neighbor.depth}. kademe</Badge>
        </button>
      ))
    ) : (
      <p className="px-2 text-2xs ahi-text-muted">Bu yönde bağlantı yok.</p>
    )}
  </div>
);

/**
 * Çağrı grafiği ekranı: motorun LSP'den ürettiği harita burada görülür —
 * durum/ilerleme, sembol arama ve seçili sembolün çağıran/çağrılan ağacı.
 */
export const CallGraphView: React.FC<CallGraphViewProps> = ({ onBack, onSelectMenu, changedFileCount }) => {
  const [status, setStatus] = useState<CallGraphPanelResult | null>(null);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<CallGraphPanelNode[]>([]);
  const [selected, setSelected] = useState<CallGraphPanelNode | null>(null);
  const [neighbors, setNeighbors] = useState<CallGraphPanelResult | null>(null);
  const [busy, setBusy] = useState(false);
  const resultHandler = useRef<((event: MessageEvent) => void) | null>(null);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const message = event.data as { type: string; payload: CallGraphPanelResult };
      if (message?.type !== 'CALLGRAPH_RESULT') return;
      const payload = message.payload;
      setBusy(false);
      if (payload.action === 'status' || payload.action === 'rebuild') {
        setStatus(payload);
      } else if (payload.action === 'search') {
        setMatches(payload.matches ?? []);
      } else if (payload.action === 'neighbors') {
        setNeighbors(payload);
      }
    };
    resultHandler.current = handler;
    window.addEventListener('message', handler);
    request({ action: 'status' });
    // Durum kartı bayatlamasın: kurulum sürüyorken kısaca yenile.
    return () => window.removeEventListener('message', handler);
  }, []);

  // Kurulum sürüyorsa ilerlemeyi periyodik çek; bitince dur.
  useEffect(() => {
    if (!status?.building) return;
    const timer = setInterval(() => request({ action: 'status' }), 2500);
    return () => clearInterval(timer);
  }, [status?.building]);

  const runSearch = useCallback(() => {
    if (!query.trim()) return;
    setBusy(true);
    request({ action: 'search', query: query.trim() });
  }, [query]);

  const selectNode = useCallback((node: CallGraphPanelNode) => {
    setSelected(node);
    setBusy(true);
    request({ action: 'neighbors', nodeId: node.id });
  }, []);

  const rebuilding = status?.action === 'rebuild' && status.building;

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader
        title="Çağrı Grafiği"
        onBack={onBack}
        onSelectMenu={onSelectMenu}
        activeDestination="callgraph"
        changedFileCount={changedFileCount}
        actions={
          <IconButton
            label="Yeniden kur"
            title="Haritayı baştan tara"
            onClick={() => {
              setBusy(true);
              request({ action: 'rebuild' });
            }}
            disabled={busy}
          >
            <RefreshCw className="ahi-icon-sm" />
          </IconButton>
        }
      />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-4">
        <Card className="space-y-2 p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Network className="ahi-icon-sm ahi-text-brand" />
            <span className="font-medium ahi-text-fg">
              {status?.building ? 'Harita çıkarılıyor' : status?.ready ? 'Harita hazır' : 'Harita yok'}
            </span>
            {status?.building && (
              <Badge tone="info">
                <Loader2 className="ahi-icon-xs animate-spin" /> %{status.progress ?? 0}
              </Badge>
            )}
            {status?.stats && (
              <span className="ahi-text-muted">
                {status.stats.nodes} sembol · {status.stats.edges} kenar · {status.stats.files} dosya
              </span>
            )}
            {status?.stats && status.stats.incompleteFiles > 0 && (
              <Badge tone="warning">{status.stats.incompleteFiles} dosya eksik tarandı</Badge>
            )}
          </div>
          {status?.message && <p className="text-2xs leading-relaxed ahi-text-muted">{status.message}</p>}
          {!status?.ready && !status?.building && (
            <p className="text-2xs ahi-text-muted">
              Harita dil sunucusundan arka planda üretilir; bir dosyayı kaydettiğinde o dosya kendiliğinden
              yeniden taranır.
            </p>
          )}
        </Card>

        <Section>
          <SectionTitle icon={<Search className="ahi-icon-xs" />} title="Sembol ara" />
          <div className="mt-2 flex items-center gap-2">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') runSearch();
              }}
              placeholder="fonksiyon ya da sınıf adı…"
              aria-label="Çağrı grafiğinde sembol ara"
            />
            <Button onClick={runSearch} disabled={busy || !query.trim()}>
              <Search className="ahi-icon-xs" /> Ara
            </Button>
          </div>
          {matches.length > 0 && (
            <div className="mt-2 space-y-0.5">
              {matches.map((node) => (
                <NodeRow
                  key={node.id}
                  node={node}
                  selected={selected?.id === node.id}
                  onSelect={selectNode}
                />
              ))}
            </div>
          )}
          {query.trim() && !busy && matches.length === 0 && (
            <p className="mt-2 text-2xs ahi-text-muted">
              Eşleşme yok; harita bayatsa yeniden kurmayı deneyin.
            </p>
          )}
        </Section>

        {selected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 px-1">
              <GitBranch className="ahi-icon-sm ahi-text-brand" />
              <span className="min-w-0 truncate text-xs font-semibold ahi-text-fg">
                {selected.className ? `${selected.className}.${selected.name}` : selected.name}
              </span>
              <span className="truncate font-mono text-2xs ahi-text-muted">
                {selected.file}:{selected.startLine}
              </span>
            </div>
            {neighbors ? (
              <>
                <NeighborList
                  title="Çağıranlar"
                  icon={<CornerUpRight className="ahi-icon-xs" />}
                  neighbors={neighbors.callers}
                  onSelect={selectNode}
                />
                <NeighborList
                  title="Çağırdıkları"
                  icon={<CornerDownLeft className="ahi-icon-xs" />}
                  neighbors={neighbors.callees}
                  onSelect={selectNode}
                />
              </>
            ) : (
              <p className="flex items-center gap-2 text-2xs ahi-text-muted">
                <Loader2 className="ahi-icon-xs animate-spin" /> Komşular yükleniyor…
              </p>
            )}
          </div>
        ) : (
          <EmptyState
            icon={<Network className="ahi-icon-md" />}
            title="Bir sembol seçin"
            description="Arama sonuçlarından bir sembole tıklayınca onu kimlerin çağırdığını ve kendisinin ne çağırdığını burada görürsünüz."
          />
        )}

        {rebuilding && (
          <p className="flex items-center gap-2 px-1 text-2xs ahi-text-muted">
            <Loader2 className="ahi-icon-xs animate-spin" /> Tam yeniden kurulum başladı; ilerleme durumu
            göstergesinde izlenir.
          </p>
        )}
      </div>
    </div>
  );
};
