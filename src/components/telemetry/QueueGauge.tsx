import type { MetricsBatchPayload, NodeMetricsSnapshot } from '@/types/metrics';
import { useNodeLabels } from './useNodeLabel';

// ─── Types ───────────────────────────────────────────────────────

interface QueueGaugeProps {
  metrics: MetricsBatchPayload | null;
}

interface GaugeBarProps {
  label: string;
  current: number;
  max: number;
}

interface NodePeaks {
  queue: number;
  conn: number;
  buffer: number;
  connMax: number;
  queueMax: number;
}

// ─── Helpers ─────────────────────────────────────────────────────

function getGaugeColor(pct: number): string {
  if (pct >= 90) return 'bg-red-500';
  if (pct >= 70) return 'bg-amber-500';
  return 'bg-green-500';
}

function getGaugeTextColor(pct: number): string {
  if (pct >= 90) return 'text-red-400';
  if (pct >= 70) return 'text-amber-400';
  return 'text-green-400';
}

// ─── GaugeBar Component ──────────────────────────────────────────

function GaugeBar({ label, current, max }: GaugeBarProps) {
  const pct = max > 0 ? Math.min(100, (current / max) * 100) : 0;
  const colorClass = getGaugeColor(pct);
  const textColor = getGaugeTextColor(pct);
  const isPulsing = pct > 90;

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between">
        <span className="truncate text-[10px] text-gray-400">{label}</span>
        <span className={`text-[10px] font-mono ${textColor}`}>
          {current} / {max}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-700">
        <div
          className={`h-full rounded-full transition-all duration-500 ${colorClass} ${
            isPulsing ? 'animate-pulse' : ''
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Module-level peak tracking (survives re-renders without lint issues) ──

const peakValues = new Map<string, NodePeaks>();

// ─── Main Component ──────────────────────────────────────────────

export function QueueGauge({ metrics }: QueueGaugeProps) {
  const labelFor = useNodeLabels();

  if (!metrics || metrics.nodes.length === 0) {
    // Simulation was reset — clear accumulated peaks so a new run starts fresh
    peakValues.clear();
    return (
      <div className="flex h-full items-center justify-center text-xs text-gray-500">
        Awaiting queue data…
      </div>
    );
  }

  // Update peak values
  for (const node of metrics.nodes) {
    const prev = peakValues.get(node.nodeId) ?? {
      queue: 0, conn: 0, buffer: 0, connMax: 50, queueMax: 100,
    };
    peakValues.set(node.nodeId, {
      queue: Math.max(prev.queue, node.queueDepth),
      conn: Math.max(prev.conn, node.activeConnections),
      buffer: Math.max(prev.buffer, node.bufferOccupancy),
      connMax: Math.max(prev.connMax, node.activeConnections, 50),
      queueMax: Math.max(prev.queueMax, node.queueDepth, 100),
    });
  }

  // Drop peaks for nodes no longer present in the topology
  const currentNodeIds = new Set(metrics.nodes.map((n) => n.nodeId));
  for (const nodeId of peakValues.keys()) {
    if (!currentNodeIds.has(nodeId)) {
      peakValues.delete(nodeId);
    }
  }

  // Show all nodes that have ever had non-zero resource usage
  const relevantNodeIds: string[] = [];
  for (const [nodeId, peaks] of peakValues) {
    if (peaks.queue > 0 || peaks.conn > 0 || peaks.buffer > 0) {
      relevantNodeIds.push(nodeId);
    }
  }

  if (relevantNodeIds.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-gray-500">
        No active queues or pools
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto pr-1">
      {relevantNodeIds.map((nodeId) => {
        const currentSnapshot = metrics.nodes.find((n: NodeMetricsSnapshot) => n.nodeId === nodeId);
        const peaks = peakValues.get(nodeId)!;

        const currentQueue = currentSnapshot?.queueDepth ?? 0;
        const currentConn = currentSnapshot?.activeConnections ?? 0;
        const currentBuffer = currentSnapshot?.bufferOccupancy ?? 0;

        return (
          <div key={nodeId} className="space-y-1">
            <span className="text-[10px] font-medium text-gray-300" title={nodeId}>
              {labelFor(nodeId)}
            </span>
            {peaks.queue > 0 && (
              <GaugeBar
                label="Queue"
                current={currentQueue}
                max={peaks.queueMax}
              />
            )}
            {peaks.conn > 0 && (
              <GaugeBar
                label="Connections"
                current={currentConn}
                max={peaks.connMax}
              />
            )}
            {peaks.buffer > 0 && (
              <GaugeBar
                label="Buffer"
                current={Math.round(currentBuffer)}
                max={Math.max(peaks.buffer, 10)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
