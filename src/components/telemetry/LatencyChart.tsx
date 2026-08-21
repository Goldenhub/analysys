/* oxlint-disable react/set-state-in-effect */
import { useReducer, useMemo, useRef, useEffect } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Brush,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from 'recharts';
import type { MetricsBatchPayload } from '@/types/metrics';
import { useSimulationStore } from '@/store/simulationStore';

// ─── Types ───────────────────────────────────────────────────────

interface LatencyDataPoint {
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

const MAX_BUFFER_SIZE = 120;

const CHAOS_LABELS: Record<string, string> = {
  FLUSH_CACHE: '\ud83d\udd25 Cache Flush',
  DROP_DB: '\u26a0\ufe0f DB Partition',
  SPIKE_TRAFFIC: '\u26a1 Traffic Spike',
};

// ─── Helpers ─────────────────────────────────────────────────────

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// ─── Reducer ─────────────────────────────────────────────────────

function dataReducer(
  state: LatencyDataPoint[],
  action: LatencyDataPoint,
): LatencyDataPoint[] {
  const lastPoint = state[state.length - 1];
  if (lastPoint && lastPoint.time === action.time) return state;
  return [...state, action].slice(-MAX_BUFFER_SIZE);
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

  // Compute reference lines for chaos start times that fall within our data window
  const chaosReferenceLines = useMemo(() => {
    if (data.length === 0) return [];
    const minTime = data[0]!.time;
    const maxTime = data[data.length - 1]!.time;

    return activeChaosEffects
      .filter((e) => e.startTimeMs >= minTime && e.startTimeMs <= maxTime)
      .map((e) => ({
        time: formatTime(e.startTimeMs),
        label: CHAOS_LABELS[e.chaosType] ?? e.label,
        chaosType: e.chaosType,
        id: e.id,
      }));
  }, [activeChaosEffects, data]);

  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-gray-500">
        Awaiting latency data…
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis
          dataKey="timeLabel"
          tick={{ fill: '#9ca3af', fontSize: 10 }}
          stroke="#4b5563"
        />
        <YAxis
          tick={{ fill: '#9ca3af', fontSize: 10 }}
          stroke="#4b5563"
          label={{ value: 'ms', position: 'insideLeft', fill: '#9ca3af', fontSize: 10 }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#1f2937',
            border: '1px solid #374151',
            borderRadius: 6,
            fontSize: 11,
          }}
          labelStyle={{ color: '#9ca3af' }}
        />
        <Legend
          wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
        />

        {/* Chaos event reference lines */}
        {chaosReferenceLines.map((ref) => (
          <ReferenceLine
            key={ref.id}
            x={ref.time}
            stroke={ref.chaosType === 'DROP_DB' ? '#ef4444' : '#f59e0b'}
            strokeDasharray="4 2"
            strokeWidth={1.5}
            label={{
              value: ref.label,
              position: 'top',
              fill: ref.chaosType === 'DROP_DB' ? '#fca5a5' : '#fcd34d',
              fontSize: 9,
            }}
          />
        ))}

        <Line
          type="monotone"
          dataKey="p50"
          name="p50"
          stroke="#3b82f6"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3 }}
        />
        <Line
          type="monotone"
          dataKey="p90"
          name="p90"
          stroke="#f59e0b"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3 }}
        />
        <Line
          type="monotone"
          dataKey="p99"
          name="p99"
          stroke="#ef4444"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3 }}
        />
        <Brush
          dataKey="timeLabel"
          height={16}
          stroke="#4b5563"
          fill="#111827"
          travellerWidth={8}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
