import type { MetricsBatchPayload, NodeMetricsSnapshot } from '@/types/metrics';

// ─── Types ───────────────────────────────────────────────────────

interface QueueGaugeProps {
  metrics: MetricsBatchPayload | null;
}

interface GaugeBarProps {
  label: string;
  current: number;
  max: number;
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
          className={`h-full rounded-full transition-all duration-300 ${colorClass} ${
            isPulsing ? 'animate-pulse' : ''
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────

export function QueueGauge({ metrics }: QueueGaugeProps) {
  if (!metrics || metrics.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-gray-500">
        Awaiting queue data…
      </div>
    );
  }

  // Filter to nodes that have meaningful queue/connection data
  const relevantNodes = metrics.nodes.filter(
    (n) => n.queueDepth > 0 || n.activeConnections > 0 || n.bufferOccupancy > 0,
  );

  if (relevantNodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-gray-500">
        No active queues or pools
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto pr-1">
      {relevantNodes.map((node: NodeMetricsSnapshot) => (
        <div key={node.nodeId} className="space-y-1">
          <span className="text-[10px] font-medium text-gray-300">
            {node.nodeId.slice(0, 8)}…
          </span>
          {node.queueDepth > 0 && (
            <GaugeBar
              label="Queue"
              current={node.queueDepth}
              max={Math.max(node.queueDepth, 100)}
            />
          )}
          {node.activeConnections > 0 && (
            <GaugeBar
              label="Connections"
              current={node.activeConnections}
              max={Math.max(node.activeConnections, 50)}
            />
          )}
          {node.bufferOccupancy > 0 && (
            <GaugeBar
              label="Buffer"
              current={Math.round(node.bufferOccupancy * 100)}
              max={100}
            />
          )}
        </div>
      ))}
    </div>
  );
}
