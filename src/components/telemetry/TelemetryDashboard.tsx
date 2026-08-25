import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronUp, BarChart3 } from 'lucide-react';
import { useSimulationStore } from '@/store/simulationStore';
import { useAnalysisPanelStore } from '@/store/analysisPanelStore';
import { SimState } from '@/simulation/types';
import { LatencyChart } from './LatencyChart';
import { ThroughputChart } from './ThroughputChart';
import { QueueGauge } from './QueueGauge';
import { EventLog } from './EventLog';
import { DashboardSkeleton } from './DashboardSkeleton';
import { MetricsSummary } from './MetricsSummary';
import { useNodeLabels } from './useNodeLabel';
import { formatSimClock as formatSimTime } from '@/utils/simTime';

// ─── Constants ───────────────────────────────────────────────────

const DEFAULT_HEIGHT = 320;
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 600;
const COLLAPSED_HEIGHT = 36;

// ─── Component ───────────────────────────────────────────────────

export function TelemetryDashboard() {
  const [collapsed, setCollapsed] = useState(false);
  const [panelHeight, setPanelHeight] = useState(DEFAULT_HEIGHT);
  const [viewMode, setViewMode] = useState<'charts' | 'summary'>('charts');
  const analysisPanelOpen = useAnalysisPanelStore((s) => s.isOpen);
  const toggleAnalysisPanel = useAnalysisPanelStore((s) => s.toggle);
  const isDragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);
  const metrics = useSimulationStore((s) => s.metrics);
  const eventLog = useSimulationStore((s) => s.eventLog);
  const simState = useSimulationStore((s) => s.simState);
  const workerError = useSimulationStore((s) => s.workerError);
  const dismissWorkerError = useSimulationStore((s) => s.setWorkerError);
  const labelFor = useNodeLabels();

  // Zero-traffic diagnosis: after a few windows, if nothing has arrived anywhere,
  // the run is advancing an idle system — say so instead of showing silent zeros.
  const hasAnyTraffic = metrics
    ? metrics.nodes.some((n) => n.arrivalCount > 0 || n.throughput > 0) ||
      metrics.systemWide.totalThroughput > 0
    : false;
  const idleSystemWarning =
    simState === SimState.Running &&
    metrics !== null &&
    metrics.simulatedTimeMs > 3000 &&
    metrics.nodes.length > 0 &&
    !hasAnyTraffic;

  // Config problems reported by the engine at INIT (e.g. a generator without RPS).
  const lastConfigWarning = useMemo(() => {
    for (let i = eventLog.length - 1; i >= 0; i--) {
      if (eventLog[i]!.type === 'CONFIG_WARNING') return eventLog[i]!;
    }
    return null;
  }, [eventLog]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (collapsed) return;
      isDragging.current = true;
      startY.current = e.clientY;
      startHeight.current = panelHeight;
      e.preventDefault();
    },
    [collapsed, panelHeight],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      // Dragging upward (negative delta) increases height since the handle is at the top
      const delta = startY.current - e.clientY;
      const newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeight.current + delta));
      setPanelHeight(newHeight);
    };

    const handleMouseUp = () => {
      isDragging.current = false;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return (
    <section
      className="border-t border-gray-800 bg-gray-900/50 transition-[height] duration-150"
      style={{ height: collapsed ? COLLAPSED_HEIGHT : panelHeight }}
      tabIndex={6}
      aria-label="Telemetry dashboard"
    >
      {/* Drag Handle */}
      {!collapsed && (
        <div
          onMouseDown={handleMouseDown}
          className="group flex h-[6px] cursor-ns-resize items-center justify-center"
          aria-label="Resize telemetry panel"
          role="separator"
          aria-orientation="horizontal"
        >
          <span className="h-[2px] w-8 rounded-full bg-gray-700 transition-colors group-hover:bg-gray-500" />
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-800 px-4 py-1.5">
        <div className="flex items-center gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            Telemetry Dashboard
          </h2>
          {/* View Toggle */}
          <div className="flex rounded-md border border-gray-700 bg-gray-800 p-0.5">
            <button
              onClick={() => setViewMode('charts')}
              className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                viewMode === 'charts'
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Charts
            </button>
            <button
              onClick={() => setViewMode('summary')}
              className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                viewMode === 'summary'
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
              title="Per-node breakdown: throughput, latency, queues, utilization for every node"
            >
              Per-node
            </button>
          </div>
          {/* Analysis Panel Toggle (Task 536) */}
          <button
            onClick={toggleAnalysisPanel}
            className={`flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium transition-colors border ${
              analysisPanelOpen
                ? 'bg-indigo-600 text-white border-indigo-500'
                : 'border-gray-700 bg-gray-800 text-gray-400 hover:text-gray-200 hover:border-gray-600'
            }`}
            aria-label={analysisPanelOpen ? 'Close analysis panel' : 'Open analysis panel'}
            aria-expanded={analysisPanelOpen}
            aria-controls="analysis-panel"
          >
            <BarChart3 size={12} />
            <span>Analysis</span>
          </button>
        </div>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="rounded p-0.5 text-gray-400 hover:bg-gray-800 hover:text-gray-200"
          aria-label={collapsed ? 'Expand telemetry panel' : 'Collapse telemetry panel'}
        >
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* Content */}
      {!collapsed && (
        <div className="flex h-[calc(100%-2.5rem)] flex-col gap-1.5 p-2">
          {workerError && (
            <div
              className="flex shrink-0 items-center justify-between rounded-md border border-red-800 bg-red-950/60 px-3 py-1.5 text-[11px] text-red-200"
              role="alert"
            >
              <span>
                <span className="font-semibold">Simulation worker error:</span> {workerError}
              </span>
              <button
                onClick={() => dismissWorkerError(null)}
                aria-label="Dismiss error"
                className="ml-3 shrink-0 rounded px-1 text-base leading-none opacity-70 hover:opacity-100"
              >
                ×
              </button>
            </div>
          )}
          {metrics === null ? (
            <DashboardSkeleton />
          ) : (
            <>
              {/* Summary View */}
              <div className={viewMode === 'summary' ? 'h-full' : 'hidden'}>
                <MetricsSummary metrics={metrics} />
              </div>

              {/* Charts View — always mounted, hidden when not active.
                  The inner content row has a DEFINITE height (h-[400px]) on purpose:
                  the chart bodies use percentage heights, which collapse to 0 inside
                  an auto-height grid. Definite height + overflow-y-auto = usable
                  cells at any panel size, scrolling when the panel is shorter. */}
              <div
                className={`h-full flex-col gap-1.5 ${
                  viewMode === 'charts' ? 'flex overflow-y-auto' : 'hidden'
                }`}
              >
                {lastConfigWarning && (
                  <div
                    className="shrink-0 rounded-md border border-amber-700/60 bg-amber-950/40 px-3 py-1.5 text-[11px] text-amber-200"
                    role="alert"
                  >
                    ⚠️ {lastConfigWarning.message}
                  </div>
                )}
                {idleSystemWarning && (
                  <div
                    className="shrink-0 rounded-md border border-amber-700/60 bg-amber-950/40 px-3 py-1.5 text-[11px] text-amber-200"
                    role="alert"
                  >
                    <span className="font-semibold">No traffic is reaching any node.</span> The
                    clock is advancing over an idle system. Check that a Traffic Generator with RPS
                    &gt; 0 is connected to your topology.
                  </div>
                )}

                {/* Per-node strip: every node's live headline numbers, one click away from detail */}
                <div
                  className="flex shrink-0 flex-wrap items-center gap-1.5"
                  aria-label="Per-node live status"
                >
                  {metrics.nodes.map((node) => {
                    const healthColor =
                      node.healthStatus === 'red'
                        ? 'bg-red-500'
                        : node.healthStatus === 'yellow'
                          ? 'bg-amber-400'
                          : 'bg-green-500';
                    const utilPct =
                      node.utilization.kind === 'value'
                        ? `${Math.round(node.utilization.value * 100)}%`
                        : 'n/a';
                    return (
                      <button
                        key={node.nodeId}
                        onClick={() => setViewMode('summary')}
                        title={`${labelFor(node.nodeId)} — throughput ${node.throughput.toFixed(1)} req/s, error ${(node.errorRate * 100).toFixed(1)}%, p50 ${node.latencyPercentiles.p50.toFixed(1)}ms, queue ${node.queueDepth}, utilization ${utilPct}. Click for the full per-node table.`}
                        className="flex items-center gap-1.5 rounded border border-gray-800 bg-gray-900 px-2 py-0.5 text-[10px] text-gray-300 hover:border-gray-600"
                      >
                        <span
                          className={`size-1.5 rounded-full ${healthColor}`}
                          aria-hidden="true"
                        />
                        <span className="max-w-[7rem] truncate">{labelFor(node.nodeId)}</span>
                        <span className="font-mono text-gray-400">
                          {node.throughput.toFixed(0)}/s · q{node.queueDepth} · {utilPct}
                        </span>
                      </button>
                    );
                  })}
                  <span
                    className="ml-auto text-[9px] text-gray-600"
                    title="These are trailing 5-second window values, sampled every 500ms of simulated time."
                  >
                    live · 5s windows
                  </span>
                </div>

                {/* 2×2 Chart Grid + event log — definite 400px row so 1fr rows
                    and percentage-height chart bodies resolve correctly. */}
                <div className="flex h-[400px] shrink-0 gap-2">
                  <div className="grid h-full flex-1 grid-cols-2 grid-rows-2 gap-2">
                    {/* Latency Chart */}
                    <div
                      className="rounded border border-gray-800 bg-gray-900 p-1"
                      aria-label={`End-to-End Latency chart: p50=${metrics.systemWide.endToEndLatency.p50.toFixed(1)}ms, p90=${metrics.systemWide.endToEndLatency.p90.toFixed(1)}ms, p99=${metrics.systemWide.endToEndLatency.p99.toFixed(1)}ms`}
                    >
                      <span
                        className="mb-0.5 block text-[10px] font-medium text-gray-400 cursor-help"
                        title="Time from request creation to completion (p50/p90/p99 percentiles in ms)"
                      >
                        End-to-End Latency
                      </span>
                      <div className="h-[calc(100%-16px)]">
                        <LatencyChart metrics={metrics} />
                      </div>
                    </div>

                    {/* Throughput Chart */}
                    <div
                      className="rounded border border-gray-800 bg-gray-900 p-1"
                      aria-label={`Throughput chart: ${metrics.systemWide.totalThroughput.toFixed(1)} req/s, error rate ${(metrics.systemWide.totalErrorRate * 100).toFixed(1)}%`}
                    >
                      <span
                        className="mb-0.5 block text-[10px] font-medium text-gray-400 cursor-help"
                        title="Requests processed per second (green=success, red=errors)"
                      >
                        Throughput
                      </span>
                      <div className="h-[calc(100%-16px)]">
                        <ThroughputChart metrics={metrics} />
                      </div>
                    </div>

                    {/* Queue/Pool Gauges */}
                    <div
                      className="rounded border border-gray-800 bg-gray-900 p-1"
                      aria-label={`Queue and connection pools gauge: ${metrics.nodes.length} nodes reporting`}
                    >
                      <span
                        className="mb-0.5 block text-[10px] font-medium text-gray-400 cursor-help"
                        title="Resource utilization per node. Green <70%, amber 70-90%, red >90%. Pulse = at capacity."
                      >
                        Queue / Connection Pools
                      </span>
                      <div className="h-[calc(100%-16px)]">
                        <QueueGauge metrics={metrics} />
                      </div>
                    </div>

                    {/* System-wide Summary */}
                    <div
                      className="rounded border border-gray-800 bg-gray-900 p-2"
                      aria-label={`System overview: throughput ${metrics.systemWide.totalThroughput.toFixed(1)} req/s, error rate ${(metrics.systemWide.totalErrorRate * 100).toFixed(1)}%, active requests ${metrics.systemWide.activeRequests}`}
                    >
                      <span className="mb-1 block text-[10px] font-medium text-gray-400">
                        System Overview
                      </span>
                      <div className="grid grid-cols-2 gap-2 overflow-auto">
                        <MetricCard
                          label="Total Throughput"
                          value={`${metrics.systemWide.totalThroughput.toFixed(1)} req/s`}
                        />
                        <MetricCard
                          label="Error Rate"
                          value={`${(metrics.systemWide.totalErrorRate * 100).toFixed(1)}%`}
                        />
                        <MetricCard
                          label="Active Requests"
                          value={String(metrics.systemWide.activeRequests)}
                        />
                        <MetricCard
                          label="Elapsed (sim)"
                          value={formatSimTime(metrics.simulatedTimeMs)}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Event Log Sidebar */}
                  <div className="w-72 shrink-0 rounded border border-gray-800 bg-gray-900">
                    <EventLog entries={eventLog} />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Internal Helpers ────────────────────────────────────────────

const METRIC_TOOLTIPS: Record<string, string> = {
  'Total Throughput': 'Successful requests completing per second in the simulated system.',
  'Error Rate': 'Percentage of requests that failed (timed out or dropped) in the current window.',
  'Active Requests':
    'Time-weighted AVERAGE number of requests simultaneously in the system during the last window — not a peak. Near 0 with traffic flowing means requests complete faster than they accumulate.',
  'Elapsed (sim)':
    'Simulated time elapsed (not wall-clock time). The virtual clock jumps between events, so it advances far faster than real time.',
};

function MetricCard({ label, value }: { label: string; value: string }) {
  const tooltip = METRIC_TOOLTIPS[label];
  return (
    <div className="rounded bg-gray-800 px-2 py-1">
      <span className="flex items-center gap-1 text-[9px] text-gray-500">
        {label}
        {tooltip && (
          <span className="group relative cursor-help" aria-label={tooltip}>
            <span className="inline-flex items-center text-gray-500 hover:text-gray-300">ℹ️</span>
            <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 -translate-x-1/2 whitespace-normal rounded bg-gray-700 px-2 py-1 text-[10px] leading-tight text-gray-200 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 w-48">
              {tooltip}
            </span>
          </span>
        )}
      </span>
      <span className="text-xs font-medium text-gray-200">{value}</span>
    </div>
  );
}
