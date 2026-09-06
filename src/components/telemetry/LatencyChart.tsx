/* oxlint-disable react/set-state-in-effect */
import { useReducer, useMemo, useRef, useEffect } from 'react';
import type { MetricsBatchPayload } from '@/types/metrics';
import { useSimulationStore } from '@/store/simulationStore';
import { appendTelemetryPoint } from './telemetryBuffer';
import { SvgTimeSeriesChart, type ChartDatum, type ReferenceLine } from './svg/SvgTimeSeriesChart';

// ─── Types ───────────────────────────────────────────────────────

interface LatencyDataPoint extends ChartDatum {
  time: number;
  timeLabel: string;
  p50: number;
  p90: number;
  p99: number;
  chaosAnnotation?: string;
}

interface LatencyChartProps {
  metrics: MetricsBatchPayload | null;
}

// ─── Constants ───────────────────────────────────────────────────

const CHAOS_LABELS: Record<string, string> = {
  FLUSH_CACHE: '\ud83d\udd25 Cold Cache',
  DROP_DB: '\u26a0\ufe0f DB Outage',
  SPIKE_TRAFFIC: '\u26a1 Traffic Spike',
};

const SERIES = [
  { key: 'p50', name: 'p50', color: '#dfb357' },
  { key: 'p90', name: 'p90', color: '#8fbf97' },
  { key: 'p99', name: 'p99', color: '#ef9a8b' },
];

// ─── Helpers ─────────────────────────────────────────────────────

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// ─── Reducer ─────────────────────────────────────────────────────

function dataReducer(state: LatencyDataPoint[], action: LatencyDataPoint): LatencyDataPoint[] {
  return appendTelemetryPoint(state, action);
}

// ─── Component ───────────────────────────────────────────────────

export function LatencyChart({ metrics }: LatencyChartProps) {
  const [data, dispatch] = useReducer(dataReducer, []);
  const activeChaosEffects = useSimulationStore((s) => s.activeChaosEffects);
  const lastTimeRef = useRef<number>(-1);

  useEffect(() => {
    if (!metrics) return;
    if (metrics.simulatedTimeMs === lastTimeRef.current) return;
    lastTimeRef.current = metrics.simulatedTimeMs;

    const activeLabels = activeChaosEffects
      .filter(
        (e) =>
          metrics.simulatedTimeMs >= e.startTimeMs &&
          metrics.simulatedTimeMs <= e.startTimeMs + e.durationMs,
      )
      .map((e) => CHAOS_LABELS[e.chaosType] ?? e.label);

    dispatch({
      time: metrics.simulatedTimeMs,
      timeLabel: formatTime(metrics.simulatedTimeMs),
      p50: metrics.systemWide.endToEndLatency.p50,
      p90: metrics.systemWide.endToEndLatency.p90,
      p99: metrics.systemWide.endToEndLatency.p99,
      chaosAnnotation: activeLabels.length > 0 ? activeLabels.join(', ') : undefined,
    });
  }, [metrics, activeChaosEffects]);

  const chaosReferenceLines: ReferenceLine[] = useMemo(() => {
    if (data.length === 0) return [];
    const minTime = data[0]!.time;
    const maxTime = data[data.length - 1]!.time;

    return activeChaosEffects
      .filter((e) => e.startTimeMs >= minTime && e.startTimeMs <= maxTime)
      .map((e) => ({
        id: e.id,
        x: e.startTimeMs,
        label: CHAOS_LABELS[e.chaosType] ?? e.label,
        color: e.chaosType === 'DROP_DB' ? '#ef9a8b' : '#dfb357',
        labelColor: e.chaosType === 'DROP_DB' ? '#ef9a8b' : '#dfb357',
      }));
  }, [activeChaosEffects, data]);

  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-[#f3ede2]/70">
        Awaiting latency data…
      </div>
    );
  }

  return (
    <SvgTimeSeriesChart
      data={data}
      series={SERIES}
      referenceLines={chaosReferenceLines}
      unit="ms"
      brush
      height={200}
    />
  );
}
