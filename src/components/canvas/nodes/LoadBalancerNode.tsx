import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { AnalysysNode } from '@/types/nodes';
import type { LoadBalancerConfig } from '@/types/nodes';
import { LBAlgorithm } from '@/types/nodes';
import { useSimulationStore } from '@/store/simulationStore';
import { useTopologyStore } from '@/store/topologyStore';

const healthColors = {
  green: 'border-green-400 shadow-green-400/20',
  yellow: 'border-yellow-400 shadow-yellow-400/20',
  red: 'border-red-400 shadow-red-400/20',
} as const;

const algorithmLabels: Record<LBAlgorithm, string> = {
  [LBAlgorithm.RoundRobin]: 'RR',
  [LBAlgorithm.LeastConnections]: 'LC',
};

export function LoadBalancerNode({ id, data }: NodeProps<AnalysysNode>) {
  const nodeStatus = useSimulationStore((s) => s.nodeStatuses.get(id));
  const edges = useTopologyStore((s) => s.edges);
  const isDisconnected = !edges.some((e) => e.source === id || e.target === id);

  const config = data.config as LoadBalancerConfig;
  const healthClass = nodeStatus ? healthColors[nodeStatus] : 'border-blue-600';

  const healthLabel = nodeStatus ?? 'nominal';

  return (
    <div
      className={`w-[140px] rounded-lg border-2 bg-gray-900 px-3 py-2 shadow-md transition-all duration-300 ease-in-out ${healthClass} ${
        isDisconnected ? 'opacity-50 border-dashed' : ''
      } ${nodeStatus ? 'animate-pulse' : ''}`}
      aria-label={`Load Balancer: ${data.label}, health: ${healthLabel}`}
    >
      {/* Icon + Label */}
      <div className="flex items-center gap-2">
        <svg
          className="h-5 w-5 shrink-0 text-blue-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3v18" />
          <path d="M3 12h18" />
          <path d="M7 7l-4 5 4 5" />
          <path d="M17 7l4 5-4 5" />
        </svg>
        <span className="truncate text-xs font-medium text-gray-200">
          {data.label}
        </span>
      </div>

      {/* Algorithm Badge */}
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[10px] text-gray-400">Algorithm</span>
        <span className="rounded bg-blue-900/60 px-1.5 py-0.5 text-[10px] font-semibold text-blue-300">
          {algorithmLabels[config.algorithm]}
        </span>
      </div>

      {/* Target Handle (left) */}
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !border-2 !border-blue-400 !bg-gray-900"
      />
      {/* Source Handle (right) */}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border-2 !border-blue-400 !bg-gray-900"
      />
    </div>
  );
}
