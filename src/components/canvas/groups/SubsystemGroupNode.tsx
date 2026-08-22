import { memo, useCallback } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { AnalysysNode } from '@/types/nodes';
import { useSimulationStore } from '@/store/simulationStore';
import { useTopologyStore } from '@/store/topologyStore';
import type { SubsystemGroupNodeData } from './useCollapsedTopologyView';
import type { NodeMetricsSnapshot } from '@/types/metrics';

// ─── Health Ordering ─────────────────────────────────────────────

type HealthStatus = 'red' | 'yellow' | 'green';
const HEALTH_ORDER: HealthStatus[] = ['red', 'yellow', 'green'];

function leastHealthy(statuses: HealthStatus[]): HealthStatus | null {
  if (statuses.length === 0) return null;
  for (const level of HEALTH_ORDER) {
    if (statuses.includes(level)) return level;
  }
  return null;
}

const healthColors = {
  green: 'border-green-400 shadow-[0_0_8px_rgba(74,222,128,0.5)]',
  yellow: 'border-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.5)]',
  red: 'border-red-400 shadow-[0_0_8px_rgba(248,113,113,0.5)]',
} as const;

// ─── Component ───────────────────────────────────────────────────

function SubsystemGroupNodeInner({ data }: NodeProps<AnalysysNode>) {
  const groupData = data as unknown as SubsystemGroupNodeData;
  const metrics = useSimulationStore((s) => s.metrics);
  const nodeStatuses = useSimulationStore((s) => s.nodeStatuses);
  const setGroupCollapsed = useTopologyStore((s) => s.setGroupCollapsed);

  // Compute group telemetry from member metrics
  const memberMetrics: NodeMetricsSnapshot[] = [];
  if (metrics?.nodes) {
    for (const snap of metrics.nodes) {
      if (groupData.memberNodeIds.includes(snap.nodeId)) {
        memberMetrics.push(snap);
      }
    }
  }

  const summedThroughput = memberMetrics.reduce((sum, m) => sum + m.throughput, 0);
  const summedErrors = memberMetrics.reduce((sum, m) => sum + m.errorRate, 0);

  // Collect health statuses for members that have one
  const availableHealthStatuses: HealthStatus[] = [];
  for (const nodeId of groupData.memberNodeIds) {
    const status = nodeStatuses.get(nodeId);
    if (status) {
      availableHealthStatuses.push(status);
    }
  }

  const groupHealth = leastHealthy(availableHealthStatuses);
  const healthClass = groupHealth ? healthColors[groupHealth] : 'border-indigo-600';
  const hasMetrics = memberMetrics.length > 0;

  const handleExpand = useCallback(() => {
    setGroupCollapsed(groupData.groupId, false);
  }, [setGroupCollapsed, groupData.groupId]);

  return (
    <div
      className={`relative w-[180px] rounded-xl border-2 bg-gray-900 px-3 py-2 shadow-lg transition-all duration-300 ease-in-out ${healthClass}`}
      aria-label={`Subsystem group: ${groupData.groupName}, ${groupData.memberCount} members, health: ${groupHealth ?? 'not applicable'}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <svg
          className="h-5 w-5 shrink-0 text-indigo-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
        </svg>
        <span className="truncate text-xs font-semibold text-gray-100">
          {groupData.groupName}
        </span>
      </div>

      {/* Member count */}
      <div className="mt-1 text-[10px] text-gray-400">
        {groupData.memberCount} nodes
      </div>

      {/* Telemetry badges (R33.14, R33.15, R33.16) */}
      {hasMetrics ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px]">
          <span className="rounded bg-gray-800 px-1.5 py-0.5 text-gray-300">
            {summedThroughput.toFixed(1)} req/s
          </span>
          <span className="rounded bg-gray-800 px-1.5 py-0.5 text-gray-300">
            {summedErrors.toFixed(0)} errors
          </span>
          {groupHealth ? (
            <span className={`rounded px-1.5 py-0.5 font-medium ${
              groupHealth === 'red' ? 'bg-red-900/50 text-red-300' :
              groupHealth === 'yellow' ? 'bg-yellow-900/50 text-yellow-300' :
              'bg-green-900/50 text-green-300'
            }`}>
              {groupHealth}
            </span>
          ) : (
            <span className="rounded bg-gray-800 px-1.5 py-0.5 text-gray-500">
              health: N/A — no member has reported metrics
            </span>
          )}
        </div>
      ) : (
        <div className="mt-1.5 text-[10px] text-gray-500">
          health: N/A — no member has reported metrics
        </div>
      )}

      {/* Expand button */}
      <button
        onClick={handleExpand}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleExpand(); }}
        className="mt-1.5 w-full rounded bg-indigo-800/50 px-2 py-0.5 text-[10px] text-indigo-300 hover:bg-indigo-700/50 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        aria-label={`Expand group ${groupData.groupName}`}
      >
        Expand
      </button>

      {/* Connection handles */}
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-indigo-400 !w-2 !h-2"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-indigo-400 !w-2 !h-2"
      />
    </div>
  );
}

export const SubsystemGroupNode = memo(SubsystemGroupNodeInner);
