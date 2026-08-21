import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { AnalysysNode } from '@/types/nodes';
import type { AppServerConfig } from '@/types/nodes';
import { NodeType } from '@/types/nodes';
import { useSimulationStore } from '@/store/simulationStore';
import { useTopologyStore } from '@/store/topologyStore';
import { ChaosStatusBadge } from './ChaosStatusBadge';

const healthColors = {
  green: 'border-green-400 shadow-green-400/20',
  yellow: 'border-yellow-400 shadow-yellow-400/20',
  red: 'border-red-400 shadow-red-400/20',
} as const;

export function AppServerNode({ id, data }: NodeProps<AnalysysNode>) {
  const nodeStatus = useSimulationStore((s) => s.nodeStatuses.get(id));
  const edges = useTopologyStore((s) => s.edges);
  const isDisconnected = !edges.some((e) => e.source === id || e.target === id);

  const config = data.config as AppServerConfig;
  const healthClass = nodeStatus ? healthColors[nodeStatus] : 'border-violet-600';

  // Queue depth gauge as a ratio visualization
  const queueFillPct = Math.min(100, (config.workerThreadPoolSize / config.requestQueueDepth) * 100);

  const healthLabel = nodeStatus ?? 'nominal';

  return (
    <div
      className={`relative w-[140px] rounded-lg border-2 bg-gray-900 px-3 py-2 shadow-md transition-all duration-300 ease-in-out ${healthClass} ${
        isDisconnected ? 'opacity-50 border-dashed' : ''
      } ${nodeStatus ? 'animate-pulse' : ''}`}
      aria-label={`App Server: ${data.label}, health: ${healthLabel}`}
    >
      <ChaosStatusBadge nodeId={id} nodeType={NodeType.AppServer} />
      {/* Icon + Label */}
      <div className="flex items-center gap-2">
        <svg
          className="h-5 w-5 shrink-0 text-violet-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="2" y="2" width="20" height="8" rx="2" />
          <rect x="2" y="14" width="20" height="8" rx="2" />
          <circle cx="6" cy="6" r="1" fill="currentColor" />
          <circle cx="6" cy="18" r="1" fill="currentColor" />
        </svg>
        <span className="truncate text-xs font-medium text-gray-200">
          {data.label}
        </span>
      </div>

      {/* Queue Depth Gauge */}
      <div className="mt-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-gray-400">Queue</span>
          <span className="text-[10px] text-violet-300">
            {config.requestQueueDepth}
          </span>
        </div>
        <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-700">
          <div
            className="h-full rounded-full bg-violet-500 transition-all"
            style={{ width: `${queueFillPct}%` }}
          />
        </div>
      </div>

      {/* Target Handle (left) */}
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !border-2 !border-violet-400 !bg-gray-900"
      />
      {/* Source Handle (right) */}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border-2 !border-violet-400 !bg-gray-900"
      />
    </div>
  );
}
