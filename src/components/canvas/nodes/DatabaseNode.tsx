import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { AnalysysNode } from '@/types/nodes';
import type { DatabaseConfig } from '@/types/nodes';
import { useSimulationStore } from '@/store/simulationStore';
import { useTopologyStore } from '@/store/topologyStore';

const healthColors = {
  green: 'border-green-400 shadow-green-400/20',
  yellow: 'border-yellow-400 shadow-yellow-400/20',
  red: 'border-red-400 shadow-red-400/20',
} as const;

export function DatabaseNode({ id, data }: NodeProps<AnalysysNode>) {
  const nodeStatus = useSimulationStore((s) => s.nodeStatuses.get(id));
  const edges = useTopologyStore((s) => s.edges);
  const isDisconnected = !edges.some((e) => e.source === id || e.target === id);

  const config = data.config as DatabaseConfig;
  const healthClass = nodeStatus ? healthColors[nodeStatus] : 'border-rose-600';

  // Connection pool gauge
  const poolPct = Math.min(100, (config.connectionPoolSize / 500) * 100);

  const healthLabel = nodeStatus ?? 'nominal';

  return (
    <div
      className={`w-[140px] rounded-lg border-2 bg-gray-900 px-3 py-2 shadow-md transition-all duration-300 ease-in-out ${healthClass} ${
        isDisconnected ? 'opacity-50 border-dashed' : ''
      } ${nodeStatus ? 'animate-pulse' : ''}`}
      aria-label={`Database: ${data.label}, health: ${healthLabel}`}
    >
      {/* Icon + Label */}
      <div className="flex items-center gap-2">
        <svg
          className="h-5 w-5 shrink-0 text-rose-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M21 5v14c0 1.66-4.03 3-9 3s-9-1.34-9-3V5" />
          <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3" />
        </svg>
        <span className="truncate text-xs font-medium text-gray-200">
          {data.label}
        </span>
      </div>

      {/* Connection Pool Gauge */}
      <div className="mt-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-gray-400">Pool</span>
          <span className="text-[10px] text-rose-300">
            {config.connectionPoolSize}
          </span>
        </div>
        <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-700">
          <div
            className="h-full rounded-full bg-rose-500 transition-all"
            style={{ width: `${poolPct}%` }}
          />
        </div>
      </div>

      {/* Target Handle (left) - database is a sink */}
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !border-2 !border-rose-400 !bg-gray-900"
      />
    </div>
  );
}
