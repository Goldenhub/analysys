import type { MetricsBatchPayload, NodeMetricsSnapshot, UtilizationReading } from '@/types/metrics';
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
}

// ─── Helpers ─────────────────────────────────────────────────────

function getGaugeColor(pct: number): string {
  if (pct >= 90) return 'bg-[#ef9a8b]';
  if (pct >= 70) return 'bg-[#dfb357]';
  return 'bg-[#8fbf97]';
}

function getGaugeTextColor(pct: number): string {
  if (pct >= 90) return 'text-[#ef9a8b]';
  if (pct >= 70) return 'text-[#dfb357]';
  return 'text-[#8fbf97]';
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
        <span className="truncate text-[10px] text-[#f3ede2]/80">{label}</span>
        <span className={`text-[10px] font-mono ${textColor}`}>
          {current} / {max}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-[#5b5347]/60">
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

// ─── Utilization Bar ─────────────────────────────────────────────

/**
 * A bar can only express a fraction of a bound. Where the node has no bound, there is
 * nothing to fill, so the reason is shown on its own and no bar is rendered at all.
 */
function UtilizationBar({ reading }: { reading: UtilizationReading | undefined }) {
  if (!reading) return null;

  if (reading.kind === 'not-applicable') {
    return (
      <div className="flex items-center justify-between">
        <span className="truncate text-[10px] text-[#f3ede2]/80">Utilization</span>
        <span className="text-[10px] text-[#f3ede2]/70">{reading.reason}</span>
      </div>
    );
  }

  const pct = Math.min(100, Math.max(0, reading.value * 100));

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between">
        <span className="truncate text-[10px] text-[#f3ede2]/80">Utilization</span>
        <span className={`text-[10px] font-mono ${getGaugeTextColor(pct)}`}>{pct.toFixed(0)}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-[#5b5347]/60">
        <div
          className={`h-full rounded-full transition-all duration-500 ${getGaugeColor(pct)} ${
            pct > 90 ? 'animate-pulse' : ''
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
      <div className="flex h-full items-center justify-center text-xs text-[#f3ede2]/70">
        Awaiting queue data…
      </div>
    );
  }

  // Update peak values
  for (const node of metrics.nodes) {
    const prev = peakValues.get(node.nodeId) ?? {
      queue: 0,
      conn: 0,
      buffer: 0,
    };
    peakValues.set(node.nodeId, {
      queue: Math.max(prev.queue, node.queueDepth),
      conn: Math.max(prev.conn, node.activeConnections),
      buffer: Math.max(prev.buffer, node.bufferOccupancy),
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
      <div className="flex h-full items-center justify-center text-xs text-[#f3ede2]/70">
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

        const connBound = currentSnapshot?.concurrencyBound;
        const queueBound = currentSnapshot?.monitoredDepthBound;

        return (
          <div key={nodeId} className="space-y-1">
            <span className="text-[10px] font-medium text-[#f3ede2]/80" title={nodeId}>
              {labelFor(nodeId)}
            </span>
            {peaks.queue > 0 && (
              <GaugeBar
                label="Queue"
                current={currentQueue}
                max={queueBound ?? Math.max(peaks.queue, 1)}
              />
            )}
            {peaks.conn > 0 && (
              <GaugeBar
                label="Connections"
                current={currentConn}
                max={connBound ?? Math.max(peaks.conn, 1)}
              />
            )}
            {peaks.buffer > 0 && (
              <GaugeBar
                label="Buffer"
                current={Math.round(currentBuffer)}
                max={Math.max(peaks.buffer, 10)}
              />
            )}
            <UtilizationBar reading={currentSnapshot?.utilization} />
          </div>
        );
      })}
    </div>
  );
}
