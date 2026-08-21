import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { AnalysysNode } from '@/types/nodes';
import type { TrafficGeneratorConfig } from '@/types/nodes';
import { NodeType } from '@/types/nodes';
import { useSimulationStore } from '@/store/simulationStore';
import { useTopologyStore } from '@/store/topologyStore';
import { ChaosStatusBadge } from './ChaosStatusBadge';

const healthColors = {
  green: 'border-green-400 shadow-green-400/20',
  yellow: 'border-yellow-400 shadow-yellow-400/20',
  red: 'border-red-400 shadow-red-400/20',
} as const;

export function TrafficGeneratorNode({ id, data }: NodeProps<AnalysysNode>) {
  const nodeStatus = useSimulationStore((s) => s.nodeStatuses.get(id));
  const edges = useTopologyStore((s) => s.edges);
  const isDisconnected = !edges.some((e) => e.source === id || e.target === id);

  const config = data.config as TrafficGeneratorConfig;
  const healthClass = nodeStatus ? healthColors[nodeStatus] : 'border-emerald-600';

  const healthLabel = nodeStatus ?? 'nominal';

  return (
    <div
      className={`relative w-[140px] rounded-lg border-2 bg-gray-900 px-3 py-2 shadow-md transition-all duration-300 ease-in-out ${healthClass} ${
        isDisconnected ? 'opacity-50 border-dashed' : ''
      } ${nodeStatus ? 'animate-pulse' : ''}`}
      aria-label={`Traffic Generator: ${data.label}, health: ${healthLabel}`}
    >
      <ChaosStatusBadge nodeId={id} nodeType={NodeType.TrafficGenerator} />
      {/* Icon + Label */}
      <div className="flex items-center gap-2">
        <svg
          className="h-5 w-5 shrink-0 text-emerald-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 2v4" />
          <path d="M12 18v4" />
          <path d="M4.93 4.93l2.83 2.83" />
          <path d="M16.24 16.24l2.83 2.83" />
          <path d="M2 12h4" />
          <path d="M18 12h4" />
          <path d="M4.93 19.07l2.83-2.83" />
          <path d="M16.24 7.76l2.83-2.83" />
        </svg>
        <span className="truncate text-xs font-medium text-gray-200">
          {data.label}
        </span>
      </div>

      {/* RPS Metric */}
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[10px] text-gray-400">RPS</span>
        <span className="text-xs font-semibold text-emerald-300">
          {config.rps.toLocaleString()}
        </span>
      </div>

      {/* Source Handle (right) - traffic flows out */}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border-2 !border-emerald-400 !bg-gray-900"
      />
    </div>
  );
}
