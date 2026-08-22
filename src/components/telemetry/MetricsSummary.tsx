import type {
  MetricsBatchPayload,
  NodeMetricsSnapshot,
  UtilizationReading,
} from '@/types/metrics';
import { useNodeLabels } from './useNodeLabel';

// ─── Types ───────────────────────────────────────────────────────

interface MetricsSummaryProps {
  metrics: MetricsBatchPayload;
}

// ─── Helpers ─────────────────────────────────────────────────────

function formatSimTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${sec}s`;
}

function healthBadge(status: 'green' | 'yellow' | 'red'): string {
  switch (status) {
    case 'green': return '🟢';
    case 'yellow': return '🟡';
    case 'red': return '🔴';
  }
}

/**
 * A percentage only means something where the node has a bounded resource. Where it does
 * not, the reason takes the cell instead of a misleading 0%.
 */
function UtilizationCell({ reading }: { reading: UtilizationReading }) {
  if (reading.kind === 'not-applicable') {
    return <span className="text-gray-500">{reading.reason}</span>;
  }
  return (
    <>
      {(reading.value * 100).toFixed(0)} <span className="text-gray-500">%</span>
    </>
  );
}

// ─── Metric Card ─────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  unit,
  description,
}: {
  label: string;
  value: string;
  unit: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800/60 px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-xl font-bold text-gray-100">{value}</span>
        <span className="text-xs text-gray-400">{unit}</span>
      </div>
      <div className="mt-1 text-[10px] text-gray-500">{description}</div>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────

export function MetricsSummary({ metrics }: MetricsSummaryProps) {
  const { systemWide, nodes, simulatedTimeMs } = metrics;
  const labelFor = useNodeLabels();

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto px-2 py-3">
      {/* System-Wide Metrics */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
          System-Wide Metrics
        </h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <SummaryCard
            label="Throughput"
            value={systemWide.totalThroughput.toFixed(1)}
            unit="req/s"
            description="Successful requests completing per second"
          />
          <SummaryCard
            label="Error Rate"
            value={(systemWide.totalErrorRate * 100).toFixed(1)}
            unit="%"
            description="Percentage of requests that timed out or were dropped"
          />
          <SummaryCard
            label="Active Requests"
            value={String(systemWide.activeRequests)}
            unit="count"
            description="Average number of requests simultaneously in-flight"
          />
          <SummaryCard
            label="Latency (p50)"
            value={systemWide.endToEndLatency.p50.toFixed(1)}
            unit="ms"
            description="Median round-trip time — 50% of requests are faster than this"
          />
          <SummaryCard
            label="Latency (p90)"
            value={systemWide.endToEndLatency.p90.toFixed(1)}
            unit="ms"
            description="90th percentile — only 10% of requests are slower"
          />
          <SummaryCard
            label="Latency (p99)"
            value={systemWide.endToEndLatency.p99.toFixed(1)}
            unit="ms"
            description="99th percentile — worst-case latency for most requests"
          />
          <SummaryCard
            label="Elapsed Time"
            value={formatSimTime(simulatedTimeMs)}
            unit="(simulated)"
            description="How much time has passed in the simulated world"
          />
          <SummaryCard
            label="Nodes Reporting"
            value={String(nodes.length)}
            unit="nodes"
            description="Number of nodes actively reporting metrics"
          />
        </div>
      </div>

      {/* Per-Node Breakdown */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
          Per-Node Breakdown
        </h3>
        <div className="overflow-x-auto rounded-lg border border-gray-700">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="border-b border-gray-700 bg-gray-800/80 text-gray-400">
                <th className="px-3 py-2 font-medium">Node</th>
                <th className="px-3 py-2 font-medium">Health</th>
                <th className="px-3 py-2 font-medium">Throughput</th>
                <th className="px-3 py-2 font-medium">Error Rate</th>
                <th className="px-3 py-2 font-medium">Latency (p50)</th>
                <th className="px-3 py-2 font-medium">Queue</th>
                <th className="px-3 py-2 font-medium">Connections</th>
                <th className="px-3 py-2 font-medium">Utilization</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((node: NodeMetricsSnapshot) => (
                <tr
                  key={node.nodeId}
                  className="border-b border-gray-800 hover:bg-gray-800/40"
                >
                  <td className="px-3 py-1.5 text-gray-300" title={node.nodeId}>
                    {labelFor(node.nodeId)}
                  </td>
                  <td className="px-3 py-1.5">
                    {healthBadge(node.healthStatus)}
                  </td>
                  <td className="px-3 py-1.5 text-gray-200">
                    {node.throughput.toFixed(1)} <span className="text-gray-500">req/s</span>
                  </td>
                  <td className="px-3 py-1.5 text-gray-200">
                    {(node.errorRate * 100).toFixed(1)} <span className="text-gray-500">%</span>
                  </td>
                  <td className="px-3 py-1.5 text-gray-200">
                    {node.latencyPercentiles.p50.toFixed(1)} <span className="text-gray-500">ms</span>
                  </td>
                  <td className="px-3 py-1.5 text-gray-200">
                    {node.queueDepth} <span className="text-gray-500">items</span>
                  </td>
                  <td className="px-3 py-1.5 text-gray-200">
                    {node.activeConnections} <span className="text-gray-500">active</span>
                  </td>
                  <td className="px-3 py-1.5 text-gray-200">
                    <UtilizationCell reading={node.utilization} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[10px] text-gray-500">
          Throughput = requests processed per second at this node. Utilization = % of node capacity in use. Queue = requests waiting to be processed.
        </p>
      </div>
    </div>
  );
}
