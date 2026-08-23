import { useTopologyStore } from '@/store/topologyStore';
import { useSimulationStore } from '@/store/simulationStore';
import type { SimulationNode } from '@/types/nodes';
import type { NodeMetricsSnapshot, UtilizationReading } from '@/types/metrics';

// ─── Types ───────────────────────────────────────────────────────

interface GroupBreakdown {
  groupId: string;
  groupName: string;
  summedThroughput: number;
  summedErrorsByStatus: Record<string, number>;
  highestUtilization: UtilizationReading;
  highestUtilizationNodeLabel: string | null;
}

// ─── Component ───────────────────────────────────────────────────

/**
 * Telemetry dashboard breakdown per subsystem group (R33.17, R33.18).
 *
 * Computes on the main thread from the latest METRICS_BATCH:
 * - Summed throughput across group members
 * - Summed error count by terminal status
 * - Highest member Utilization among numeric readings, and the label holding it
 * - Reports "not applicable" when every member reads not-applicable (R33.18)
 */
export function SubsystemBreakdown() {
  const subsystemGroups = useTopologyStore((s) => s.subsystemGroups);
  const nodes = useTopologyStore((s) => s.nodes);
  const metrics = useSimulationStore((s) => s.metrics);

  if (subsystemGroups.length === 0) return null;

  const nodeLabels = new Map<string, string>(
    nodes.map((n) => [n.id, (n.data as SimulationNode).label]),
  );

  const metricsMap = new Map<string, NodeMetricsSnapshot>();
  if (metrics?.nodes) {
    for (const snap of metrics.nodes) {
      metricsMap.set(snap.nodeId, snap);
    }
  }

  const breakdowns: GroupBreakdown[] = subsystemGroups.map((group) => {
    let summedThroughput = 0;
    const summedErrorsByStatus: Record<string, number> = {};
    let highestUtil: UtilizationReading = {
      kind: 'not-applicable',
      reason: 'No member has a numeric utilization reading.',
    };
    let highestUtilValue = -1;
    let highestUtilNodeLabel: string | null = null;

    for (const memberId of group.memberNodeIds) {
      const snap = metricsMap.get(memberId);
      if (!snap) continue;

      summedThroughput += snap.throughput;

      // Sum terminal counts (errors by status)
      for (const [status, count] of Object.entries(snap.terminalCounts ?? {})) {
        if (status === 'Success') continue;
        summedErrorsByStatus[status] = (summedErrorsByStatus[status] ?? 0) + count;
      }

      // Highest utilization among numeric readings
      if (snap.utilization.kind === 'value' && snap.utilization.value > highestUtilValue) {
        highestUtilValue = snap.utilization.value;
        highestUtil = snap.utilization;
        highestUtilNodeLabel = nodeLabels.get(memberId) ?? memberId;
      }
    }

    return {
      groupId: group.id,
      groupName: group.name,
      summedThroughput,
      summedErrorsByStatus,
      highestUtilization: highestUtil,
      highestUtilizationNodeLabel: highestUtilNodeLabel,
    };
  });

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-gray-200">Subsystem Breakdown</h3>
      {breakdowns.map((bd) => (
        <div
          key={bd.groupId}
          className="rounded-md border border-gray-700 bg-gray-800/50 p-2"
          aria-label={`Group breakdown: ${bd.groupName}`}
        >
          <div className="text-xs font-medium text-gray-100 mb-1">{bd.groupName}</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-gray-300">
            <div>Throughput</div>
            <div className="text-right">{bd.summedThroughput.toFixed(1)} req/s</div>

            {Object.entries(bd.summedErrorsByStatus).map(([status, count]) => (
              <div key={status} className="contents">
                <div className="text-red-400">{status}</div>
                <div className="text-right text-red-400">{count} req</div>
              </div>
            ))}

            <div>Highest Utilization</div>
            <div className="text-right">
              {bd.highestUtilization.kind === 'value' ? (
                <span>
                  {(bd.highestUtilization.value * 100).toFixed(1)}%
                  {bd.highestUtilizationNodeLabel && (
                    <span className="text-gray-500 ml-1">({bd.highestUtilizationNodeLabel})</span>
                  )}
                </span>
              ) : (
                <span className="text-gray-500">N/A</span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
