import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { AnalysysNode } from '@/types/nodes';
import type { CircuitBreakerConfig } from '@/types/nodes';
import { NodeType } from '@/types/nodes';
import { useSimulationStore } from '@/store/simulationStore';
import { useTopologyStore } from '@/store/topologyStore';
import { ChaosStatusBadge } from './ChaosStatusBadge';

const healthColors = {
  green: 'border-green-400 shadow-[0_0_8px_rgba(74,222,128,0.5)]',
  yellow: 'border-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.5)]',
  red: 'border-red-400 shadow-[0_0_8px_rgba(248,113,113,0.5)]',
} as const;

export function CircuitBreakerNode({ id, data }: NodeProps<AnalysysNode>) {
  const nodeStatus = useSimulationStore((s) => s.nodeStatuses.get(id));
  const edges = useTopologyStore((s) => s.edges);
  const isDisconnected = !edges.some((e) => e.source === id || e.target === id);

  const config = data.config as CircuitBreakerConfig;
  const healthClass = nodeStatus ? healthColors[nodeStatus] : 'border-orange-600';

  const healthLabel = nodeStatus ?? 'nominal';

  return (
    <div
      className={`relative w-[140px] rounded-lg border-2 bg-gray-900 px-3 py-2 shadow-md transition-all duration-300 ease-in-out ${healthClass} ${
        isDisconnected ? 'opacity-50 border-dashed' : ''
      }`}
      aria-label={`Circuit Breaker: ${data.label}, health: ${healthLabel}`}
    >
      <ChaosStatusBadge nodeId={id} nodeType={NodeType.CircuitBreaker} />
      {/* Icon + Label */}
      <div className="flex items-center gap-2">
        <svg
          className="h-5 w-5 shrink-0 text-orange-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
          <path d="M12 2v10" />
        </svg>
        <span className="truncate text-xs font-medium text-gray-200">
          {data.label}
        </span>
      </div>

      {/* Error Threshold Display */}
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[10px] text-gray-400">Threshold</span>
        <span className="text-xs font-semibold text-orange-300">
          {(config.errorThreshold * 100).toFixed(0)}%
        </span>
      </div>

      {/* Open Duration Display */}
      <div className="mt-1 flex items-center justify-between">
        <span className="text-[10px] text-gray-400">Reset</span>
        <span className="text-xs font-semibold text-orange-300">
          {config.openDurationMs / 1000}s
        </span>
      </div>

      {/* Target Handle (left) */}
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !border-2 !border-orange-400 !bg-gray-900"
      />
      {/* Source Handle (right) */}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border-2 !border-orange-400 !bg-gray-900"
      />
    </div>
  );
}
