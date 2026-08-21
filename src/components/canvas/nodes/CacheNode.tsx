import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { AnalysysNode } from '@/types/nodes';
import type { CacheConfig } from '@/types/nodes';
import { useSimulationStore } from '@/store/simulationStore';
import { useTopologyStore } from '@/store/topologyStore';

const healthColors = {
  green: 'border-green-400 shadow-green-400/20',
  yellow: 'border-yellow-400 shadow-yellow-400/20',
  red: 'border-red-400 shadow-red-400/20',
} as const;

export function CacheNode({ id, data }: NodeProps<AnalysysNode>) {
  const nodeStatus = useSimulationStore((s) => s.nodeStatuses.get(id));
  const edges = useTopologyStore((s) => s.edges);
  const isDisconnected = !edges.some((e) => e.source === id || e.target === id);

  const config = data.config as CacheConfig;
  const healthClass = nodeStatus ? healthColors[nodeStatus] : 'border-amber-600';
  const hitPct = Math.round(config.hitRatio * 100);

  const healthLabel = nodeStatus ?? 'nominal';

  return (
    <div
      className={`w-[140px] rounded-lg border-2 bg-gray-900 px-3 py-2 shadow-md transition-all duration-300 ease-in-out ${healthClass} ${
        isDisconnected ? 'opacity-50 border-dashed' : ''
      } ${nodeStatus ? 'animate-pulse' : ''}`}
      aria-label={`Cache: ${data.label}, health: ${healthLabel}`}
    >
      {/* Icon + Label */}
      <div className="flex items-center gap-2">
        <svg
          className="h-5 w-5 shrink-0 text-amber-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
        <span className="truncate text-xs font-medium text-gray-200">
          {data.label}
        </span>
      </div>

      {/* Hit Ratio Display */}
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[10px] text-gray-400">Hit Ratio</span>
        <span className="text-xs font-semibold text-amber-300">{hitPct}%</span>
      </div>

      {/* Target Handle (left) */}
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !border-2 !border-amber-400 !bg-gray-900"
      />
      {/* Source Handle (right) */}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border-2 !border-amber-400 !bg-gray-900"
      />
    </div>
  );
}
