import { useCallback } from 'react';
import { NodeType } from '@/types/nodes';
import { useTopologyStore } from '@/store/topologyStore';
import type { AnalysysNode } from '@/types/nodes';
import { createDefaultNodeData } from '@/types/nodeDefaults';

// ─── Palette Item Definition ─────────────────────────────────────

interface PaletteItem {
  nodeType: NodeType;
  label: string;
  icon: React.ReactNode;
}

interface PaletteCategory {
  name: string;
  items: PaletteItem[];
}

// ─── Icons (inline SVG) ──────────────────────────────────────────

function TrafficGeneratorIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.652a3.75 3.75 0 0 1 0-5.304m5.304 0a3.75 3.75 0 0 1 0 5.304m-7.425 2.121a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
    </svg>
  );
}

function ApiGatewayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 17l5-5-5-5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12H3" />
    </svg>
  );
}

function RateLimiterIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18l-7 8v7l-4 2v-9L3 4z" />
    </svg>
  );
}

function CircuitBreakerIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18.36 6.64a9 9 0 1 1-12.73 0" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v10" />
    </svg>
  );
}

function LoadBalancerIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
    </svg>
  );
}

function AppServerIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 0 1-3-3m3 3a3 3 0 1 0 0 6h13.5a3 3 0 1 0 0-6m-13.5-3a3 3 0 0 1 0-6h13.5a3 3 0 1 1 0 6M6 6.75h.008v.008H6V6.75Zm0 7.5h.008v.008H6v-.008Zm0 7.5h.008v.008H6v-.008Z" />
    </svg>
  );
}

function CacheIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
    </svg>
  );
}

function DatabaseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
    </svg>
  );
}

function MessageQueueIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.429 9.75 2.25 12l4.179 2.25m0-4.5 5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L12 12.75l-5.571-3m11.142 0L21.75 12l-4.179 2.25m0 0L12 17.25l-5.571-3m11.142 0L21.75 16.5 12 21.75l-9.75-5.25 4.179-2.25" />
    </svg>
  );
}

// ─── Palette Categories ──────────────────────────────────────────

const PALETTE_CATEGORIES: PaletteCategory[] = [
  {
    name: 'Sources',
    items: [
      { nodeType: NodeType.TrafficGenerator, label: 'Traffic Generator', icon: <TrafficGeneratorIcon /> },
    ],
  },
  {
    name: 'Edge & Resilience',
    items: [
      { nodeType: NodeType.ApiGateway, label: 'API Gateway', icon: <ApiGatewayIcon /> },
      { nodeType: NodeType.RateLimiter, label: 'Rate Limiter', icon: <RateLimiterIcon /> },
      { nodeType: NodeType.CircuitBreaker, label: 'Circuit Breaker', icon: <CircuitBreakerIcon /> },
    ],
  },
  {
    name: 'Compute',
    items: [
      { nodeType: NodeType.LoadBalancer, label: 'Load Balancer', icon: <LoadBalancerIcon /> },
      { nodeType: NodeType.AppServer, label: 'App Server', icon: <AppServerIcon /> },
    ],
  },
  {
    name: 'Storage',
    items: [
      { nodeType: NodeType.Cache, label: 'Cache', icon: <CacheIcon /> },
      { nodeType: NodeType.Database, label: 'Database', icon: <DatabaseIcon /> },
    ],
  },
  {
    name: 'Messaging',
    items: [
      { nodeType: NodeType.MessageQueue, label: 'Message Queue', icon: <MessageQueueIcon /> },
    ],
  },
];

// ─── Palette Item Component ──────────────────────────────────────

interface PaletteItemComponentProps {
  item: PaletteItem;
}

function PaletteItemComponent({ item }: PaletteItemComponentProps) {
  const addNode = useTopologyStore((s) => s.addNode);

  const onDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.dataTransfer.setData('application/analysys-node-type', item.nodeType);
      event.dataTransfer.effectAllowed = 'move';
    },
    [item.nodeType],
  );

  const placeAtCenter = useCallback(() => {
    const position = { x: 250, y: 250 };
    const nodeData = createDefaultNodeData(item.nodeType, position);
    const newNode: AnalysysNode = {
      id: nodeData.id,
      type: nodeData.nodeType,
      position,
      data: nodeData as AnalysysNode['data'],
    };
    addNode(newNode);
  }, [item.nodeType, addNode]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        placeAtCenter();
      }
    },
    [placeAtCenter],
  );

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="button"
      aria-label={`Add ${item.label} node. Drag to canvas or press Enter to place.`}
      className="flex cursor-grab items-center gap-2 rounded-md border border-gray-700/50 bg-gray-800/60 px-3 py-2 text-sm text-gray-200 transition-colors hover:border-gray-600 hover:bg-gray-700/60 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 focus:ring-offset-gray-900 active:cursor-grabbing"
    >
      <span className="flex-shrink-0 text-gray-400">{item.icon}</span>
      <span className="truncate">{item.label}</span>
    </div>
  );
}

// ─── Node Palette Component ──────────────────────────────────────

export function NodePalette() {
  return (
    <nav aria-label="Node palette" className="flex flex-col gap-4">
      {PALETTE_CATEGORIES.map((category) => (
        <div key={category.name}>
          <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wider text-gray-500">
            {category.name}
          </h3>
          <div className="flex flex-col gap-1.5">
            {category.items.map((item) => (
              <PaletteItemComponent key={item.nodeType} item={item} />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
