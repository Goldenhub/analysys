import { useState, useRef, useCallback, useEffect } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useSimulationStore } from '@/store/simulationStore';
import { LatencyChart } from './LatencyChart';
import { ThroughputChart } from './ThroughputChart';
import { QueueGauge } from './QueueGauge';
import { EventLog } from './EventLog';
import { DashboardSkeleton } from './DashboardSkeleton';

// ─── Constants ───────────────────────────────────────────────────

const DEFAULT_HEIGHT = 320;
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 600;
const COLLAPSED_HEIGHT = 36;

// ─── Component ───────────────────────────────────────────────────

export function TelemetryDashboard() {
  const [collapsed, setCollapsed] = useState(false);
  const [panelHeight, setPanelHeight] = useState(DEFAULT_HEIGHT);
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
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Telemetry Dashboard
        </h2>
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
        <div className="flex h-[calc(100%-2rem)] gap-2 p-2">
          {metrics === null ? (
            /* Loading skeleton when no data (Task 239) */
            <DashboardSkeleton />
          ) : (
            <>
              {/* 2×2 Chart Grid */}
              <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-2">
                {/* Latency Chart */}
                <div
                  className="rounded border border-gray-800 bg-gray-900 p-1"
                  aria-label={`End-to-End Latency chart: p50=${metrics.systemWide.endToEndLatency.p50.toFixed(1)}ms, p90=${metrics.systemWide.endToEndLatency.p90.toFixed(1)}ms, p99=${metrics.systemWide.endToEndLatency.p99.toFixed(1)}ms`}
                >
                  <span className="mb-0.5 block text-[10px] font-medium text-gray-400">
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
                  <span className="mb-0.5 block text-[10px] font-medium text-gray-400">
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
                  <span className="mb-0.5 block text-[10px] font-medium text-gray-400">
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

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-gray-800 px-2 py-1">
      <span className="block text-[9px] text-gray-500">{label}</span>
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
