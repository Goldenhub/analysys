import type { MetricsBatchPayload, NodeMetricsSnapshot, UtilizationReading } from '@/types/metrics';
import { useNodeLabels } from './useNodeLabel';
import { useSimulationStore } from '@/store/simulationStore';
import { SimState } from '@/simulation/types';
import { downloadTextFile } from '@/utils/download';
import { toCsv } from '@/utils/csv';
import { formatSimDuration, formatSimClockMs } from '@/utils/simTime';
import { TerminalStatusTable } from './TerminalStatusTable';

// ─── Types ───────────────────────────────────────────────────────

interface MetricsSummaryProps {
  metrics: MetricsBatchPayload;
}

// ─── Helpers ─────────────────────────────────────────────────────

function healthBadge(status: 'green' | 'yellow' | 'red'): string {
  switch (status) {
    case 'green':
      return '🟢';
    case 'yellow':
      return '🟡';
    case 'red':
      return '🔴';
  }
}

/**
 * A percentage only means something where the node has a bounded resource. Where it does
 * not, the reason takes the cell instead of a misleading 0%.
 */
function UtilizationCell({ reading }: { reading: UtilizationReading }) {
  if (reading.kind === 'not-applicable') {
    return <span className="text-[#f3ede2]/70">{reading.reason}</span>;
  }
  return (
    <>
      {(reading.value * 100).toFixed(0)} <span className="text-[#f3ede2]/70">%</span>
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
    <div className="rounded-lg border border-[#5b5347]/30 bg-[#5b5347]/80/60 px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-[#f3ede2]/70">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-xl font-bold text-[#f3ede2]/90">{value}</span>
        <span className="text-xs text-[#f3ede2]/80">{unit}</span>
      </div>
      <div className="mt-1 text-[10px] text-[#f3ede2]/70">{description}</div>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────

function formatWallClock(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Whole-run totals from the worker's SIM_COMPLETE payload — shown once the run ends. */
function RunReportCard() {
  const runSummary = useSimulationStore((s) => s.runSummary);
  if (!runSummary) return null;

  const successPct = (runSummary.successRate * 100).toFixed(1);
  const speedup =
    runSummary.wallClockDurationMs > 0
      ? Math.round(runSummary.simulatedDurationMs / runSummary.wallClockDurationMs)
      : 0;
  return (
    <div className="rounded-lg border border-[#b8402e]/30/60 bg-[#b8402e]/10 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[#ef9a8b]">
          Run Report — whole-run totals
        </h3>
        <span
          className="rounded bg-[#5b5347]/80 px-2 py-0.5 font-mono text-[10px] text-[#f3ede2]/80"
          title="The PRNG seed for this run. Enter the same seed in the toolbar to reproduce this run exactly."
        >
          seed {runSummary.seed}
        </span>
      </div>

      {runSummary.totalRequests === 0 && (
        <div
          className="mb-3 rounded-md border border-[#dfb357]/60/60 bg-[#dfb357]/15 px-3 py-2 text-[11px] leading-relaxed text-[#dfb357]"
          role="alert"
        >
          <span className="font-semibold">No requests were generated during this run.</span> The
          simulation advanced its clock over an idle system. Check that:
          <ul className="mt-1 list-disc pl-4">
            <li>a Traffic Generator node exists and is wired to your system,</li>
            <li>its RPS is above 0, and</li>
            <li>the edge direction points from the generator toward your services.</li>
          </ul>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryCard
          label="Total Requests"
          value={String(runSummary.totalRequests)}
          unit="requests"
          description="Top-level requests created during the run (excludes fan-out branches)"
        />
        <SummaryCard
          label="Success Rate"
          value={successPct}
          unit="%"
          description="Share of finished requests that completed successfully"
        />
        <SummaryCard
          label="Avg Latency"
          value={runSummary.avgEndToEndLatencyMs.toFixed(1)}
          unit="ms"
          description="Mean end-to-end latency across successful requests"
        />
        <SummaryCard
          label="Simulated Time"
          value={formatSimDuration(runSummary.simulatedDurationMs)}
          unit="(simulated)"
          description="Virtual time the run covered"
        />
        <SummaryCard
          label="Wall Clock"
          value={formatWallClock(runSummary.wallClockDurationMs)}
          unit="(real)"
          description={
            speedup > 0
              ? `Real execution time — simulated ${speedup.toLocaleString()}× faster than real time`
              : 'Real time the run took to execute'
          }
        />
        <SummaryCard
          label="Event Rate"
          value={Math.round(runSummary.eventsPerSecond).toLocaleString()}
          unit="events/s"
          description="Discrete events processed per wall-clock second"
        />
      </div>
      <p className="mt-2 text-[10px] text-[#f3ede2]/70">
        Discrete-event simulation: the virtual clock jumps between events, so{' '}
        {formatSimDuration(runSummary.simulatedDurationMs)} of system time can execute in
        milliseconds of real time — wall clock measures computation, not duration.
      </p>
    </div>
  );
}

export function MetricsSummary({ metrics }: MetricsSummaryProps) {
  const { systemWide, nodes, simulatedTimeMs } = metrics;
  const labelFor = useNodeLabels();
  const simState = useSimulationStore((s) => s.simState);
  const isComplete = simState === SimState.Complete;

  const exportNodesCsv = () => {
    const csv = toCsv(
      [
        'node',
        'health',
        'throughput_rps',
        'error_rate_pct',
        'p50_ms',
        'p90_ms',
        'p99_ms',
        'queue_depth',
        'active_connections',
        'utilization_pct',
      ],
      nodes.map((n) => [
        labelFor(n.nodeId),
        n.healthStatus,
        n.throughput.toFixed(2),
        (n.errorRate * 100).toFixed(2),
        n.latencyPercentiles.p50.toFixed(2),
        n.latencyPercentiles.p90.toFixed(2),
        n.latencyPercentiles.p99.toFixed(2),
        n.queueDepth,
        n.activeConnections,
        n.utilization.kind === 'value' ? (n.utilization.value * 100).toFixed(1) : 'n/a',
      ]),
    );
    downloadTextFile(csv, 'analysys-nodes.csv', 'text/csv');
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto px-2 py-3">
      {/* Run Report — only meaningful once a run has finished */}
      {isComplete && <RunReportCard />}
      {!isComplete && (
        <p className="text-[10px] text-[#f3ede2]/70">
          Live values below are trailing 5-second windows. A whole-run Run Report appears here when
          the simulation completes.
        </p>
      )}

      {/* System-Wide Metrics */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#f3ede2]/80">
          System-Wide Metrics{' '}
          <span className="font-normal normal-case tracking-normal text-[#f3ede2]/70">
            (trailing 5s window)
          </span>
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
            label="Avg In-Flight"
            value={systemWide.activeRequests.toFixed(1)}
            unit="requests"
            description="Time-weighted average of requests simultaneously in the system during this window. Near 0 with traffic flowing means requests drain faster than they queue."
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
            value={formatSimDuration(simulatedTimeMs)}
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
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#f3ede2]/80">
            Per-Node Breakdown{' '}
            <span className="font-normal normal-case tracking-normal text-[#f3ede2]/70">
              (trailing 5s window · updated t={formatSimClockMs(metrics.simulatedTimeMs)})
            </span>
          </h3>
          {nodes.length > 0 && (
            <button
              onClick={exportNodesCsv}
              className="rounded border border-[#5b5347]/30 bg-[#5b5347]/80 px-2 py-0.5 text-[10px] text-[#f3ede2]/80 hover:border-[#5b5347]/40 hover:text-[#f3ede2]/90"
              title="Download the current per-node metrics as CSV"
            >
              Export nodes CSV
            </button>
          )}
        </div>
        {nodes.length === 0 ? (
          <div className="rounded-lg border border-[#5b5347]/30 bg-[#5b5347]/80/40 px-4 py-6 text-center">
            <p className="text-sm text-[#f3ede2]/80">Waiting for node metrics...</p>
            <p className="mt-1 text-[10px] text-[#f3ede2]/70">
              Per-node data will appear once the simulation has processed enough events.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[#5b5347]/30">
            <table className="w-full text-left text-[11px]">
              <thead>
                <tr className="border-b border-[#5b5347]/30 bg-[#5b5347]/80/80 text-[#f3ede2]/80">
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
                  <tr key={node.nodeId} className="border-b border-[#5b5347]/20 hover:bg-[#5b5347]/80/40">
                    <td className="px-3 py-1.5 text-[#f3ede2]/80" title={node.nodeId}>
                      {labelFor(node.nodeId)}
                    </td>
                    <td className="px-3 py-1.5">{healthBadge(node.healthStatus)}</td>
                    <td className="px-3 py-1.5 text-[#f3ede2]">
                      {node.throughput.toFixed(1)} <span className="text-[#f3ede2]/70">req/s</span>
                    </td>
                    <td className="px-3 py-1.5 text-[#f3ede2]">
                      {(node.errorRate * 100).toFixed(1)} <span className="text-[#f3ede2]/70">%</span>
                    </td>
                    <td className="px-3 py-1.5 text-[#f3ede2]">
                      {node.latencyPercentiles.p50.toFixed(1)}{' '}
                      <span className="text-[#f3ede2]/70">ms</span>
                    </td>
                    <td className="px-3 py-1.5 text-[#f3ede2]">
                      {node.queueDepth} <span className="text-[#f3ede2]/70">items</span>
                    </td>
                    <td className="px-3 py-1.5 text-[#f3ede2]">
                      {node.activeConnections} <span className="text-[#f3ede2]/70">active</span>
                    </td>
                    <td className="px-3 py-1.5 text-[#f3ede2]">
                      <UtilizationCell reading={node.utilization} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[10px] text-[#f3ede2]/70">
          Throughput = requests processed per second at this node. Utilization = % of node capacity
          in use. Queue = requests waiting to be processed.
        </p>
      </div>

      {/* Terminal status distribution (cumulative across the run) */}
      {nodes.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#f3ede2]/80">
            Request Outcomes{' '}
            <span className="font-normal normal-case tracking-normal text-[#f3ede2]/70">
              (cumulative)
            </span>
          </h3>
          <TerminalStatusTable nodes={nodes} windowDurationSec={5} />
        </div>
      )}
    </div>
  );
}
