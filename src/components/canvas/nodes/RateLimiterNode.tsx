import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { AnalysysNode } from '@/types/nodes';
import type { RateLimiterConfig } from '@/types/nodes';
import { NodeType } from '@/types/nodes';
import { useSimulationStore } from '@/store/simulationStore';
import { useTopologyStore } from '@/store/topologyStore';
import { ChaosStatusBadge } from './ChaosStatusBadge';

const healthColors = {
  green: 'border-green-400 shadow-[0_0_8px_rgba(74,222,128,0.5)]',
  yellow: 'border-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.5)]',
  red: 'border-red-400 shadow-[0_0_8px_rgba(248,113,113,0.5)]',
} as const;

export function RateLimiterNode({ id, data }: NodeProps<AnalysysNode>) {
  const nodeStatus = useSimulationStore((s) => s.nodeStatuses.get(id));
  const edges = useTopologyStore((s) => s.edges);
  const isDisconnected = !edges.some((e) => e.source === id || e.target === id);

  const config = data.config as RateLimiterConfig;
  const healthClass = nodeStatus ? healthColors[nodeStatus] : 'border-teal-600';

  // Burst capacity relative to a 1000-token reference bucket.
  const capacityFillPct = Math.min(100, (config.bucketCapacity / 1000) * 100);

  const healthLabel = nodeStatus ?? 'nominal';

  return (
    <div
      className={`relative w-[140px] rounded-lg border-2 bg-gray-900 px-3 py-2 shadow-md transition-all duration-300 ease-in-out ${healthClass} ${
        isDisconnected ? 'opacity-50 border-dashed' : ''
      }`}
      aria-label={`Rate Limiter: ${data.label}, health: ${healthLabel}`}
    >
      <ChaosStatusBadge nodeId={id} nodeType={NodeType.RateLimiter} />
      {/* Icon + Label */}
      <div className="flex items-center gap-2">
        <svg
          className="h-5 w-5 shrink-0 text-teal-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 4h18l-7 8v7l-4 2v-9L3 4z" />
        </svg>
        <span className="truncate text-xs font-medium text-gray-200">
          {data.label}
        </span>
      </div>

      {/* Refill Rate Display */}
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[10px] text-gray-400">Rate</span>
        <span className="text-xs font-semibold text-teal-300">
          {config.refillRatePerSec}/s
        </span>
      </div>

      {/* Burst Capacity Gauge */}
      <div className="mt-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-gray-400">Burst</span>
          <span className="text-[10px] text-teal-300">{config.bucketCapacity}</span>
        </div>
        <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-700">
          <div
            className="h-full rounded-full bg-teal-500 transition-all"
            style={{ width: `${capacityFillPct}%` }}
          />
        </div>
      </div>

      {/* Target Handle (left) */}
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !border-2 !border-teal-400 !bg-gray-900"
      />
      {/* Source Handle (right) */}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border-2 !border-teal-400 !bg-gray-900"
      />
    </div>
  );
}
