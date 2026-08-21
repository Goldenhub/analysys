import { useState, useRef, useCallback, useEffect } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useSimulationStore } from '@/store/simulationStore';
import { LatencyChart } from './LatencyChart';
import { ThroughputChart } from './ThroughputChart';
import { QueueGauge } from './QueueGauge';
import { EventLog } from './EventLog';
import { DashboardSkeleton } from './DashboardSkeleton';
import { MetricsSummary } from './MetricsSummary';

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
  const isDragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);
  const metrics = useSimulationStore((s) => s.metrics);
  const eventLog = useSimulationStore((s) => s.eventLog);

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
            >
              Summary
            </button>
          </div>
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
        <div className="flex h-[calc(100%-2.5rem)] gap-2 p-2">
          {metrics === null ? (
            <DashboardSkeleton />
          ) : viewMode === 'summary' ? (
            <MetricsSummary metrics={metrics} />
          ) : (
            <>
              {/* 2×2 Chart Grid */}
              <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-2">
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
              <div className="w-72 rounded border border-gray-800 bg-gray-900">
                <EventLog entries={eventLog} />
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
    'Peak number of requests simultaneously in-flight during the last measurement window. High values indicate backpressure.',
  'Elapsed (sim)':
    'Simulated time elapsed (not wall-clock time). The simulation can run faster or slower than real-time.',
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

function formatSimTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
