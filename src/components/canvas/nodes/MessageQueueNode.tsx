import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { AnalysysNode } from '@/types/nodes';
import type { MessageQueueConfig } from '@/types/nodes';
import { NodeType } from '@/types/nodes';
import { useSimulationStore } from '@/store/simulationStore';
import { useTopologyStore } from '@/store/topologyStore';
import { ChaosStatusBadge } from './ChaosStatusBadge';

const healthColors = {
  green: 'border-green-400 shadow-green-400/20',
  yellow: 'border-yellow-400 shadow-yellow-400/20',
  red: 'border-red-400 shadow-red-400/20',
} as const;

export function MessageQueueNode({ id, data }: NodeProps<AnalysysNode>) {
  const nodeStatus = useSimulationStore((s) => s.nodeStatuses.get(id));
  const edges = useTopologyStore((s) => s.edges);
  const isDisconnected = !edges.some((e) => e.source === id || e.target === id);

  const config = data.config as MessageQueueConfig;
  const healthClass = nodeStatus ? healthColors[nodeStatus] : 'border-cyan-600';

  // Buffer capacity gauge
  const bufferPct = Math.min(100, (config.backpressureThresholdPct / 100) * 100);

  const healthLabel = nodeStatus ?? 'nominal';

  return (
    <div
      className={`relative w-[140px] rounded-lg border-2 bg-gray-900 px-3 py-2 shadow-md transition-all duration-300 ease-in-out ${healthClass} ${
        isDisconnected ? 'opacity-50 border-dashed' : ''
      } ${nodeStatus ? 'animate-pulse' : ''}`}
      aria-label={`Message Queue: ${data.label}, health: ${healthLabel}`}
    >
      <ChaosStatusBadge nodeId={id} nodeType={NodeType.MessageQueue} />
      {/* Icon + Label */}
      <div className="flex items-center gap-2">
        <svg
          className="h-5 w-5 shrink-0 text-cyan-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="18" height="4" rx="1" />
          <rect x="3" y="10" width="18" height="4" rx="1" />
          <rect x="3" y="17" width="18" height="4" rx="1" />
        </svg>
        <span className="truncate text-xs font-medium text-gray-200">
          {data.label}
        </span>
      </div>

      {/* Buffer Gauge */}
      <div className="mt-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-gray-400">Buffer</span>
          <span className="text-[10px] text-cyan-300">
            {config.bufferCapacity.toLocaleString()}
          </span>
        </div>
        <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-700">
          <div
            className="h-full rounded-full bg-cyan-500 transition-all"
            style={{ width: `${bufferPct}%` }}
          />
        </div>
      </div>

      {/* Target Handle (left) */}
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !border-2 !border-cyan-400 !bg-gray-900"
      />
      {/* Source Handle (right) */}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border-2 !border-cyan-400 !bg-gray-900"
      />
    </div>
  );
}
