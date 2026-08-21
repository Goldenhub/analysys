import { useRef, useCallback } from 'react';
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
} from 'recharts';
import type { MetricsBatchPayload } from '@/types/metrics';

// ─── Types ───────────────────────────────────────────────────────

interface LatencyDataPoint {
  time: number;
  timeLabel: string;
  p50: number;
  p90: number;
  p99: number;
}

interface LatencyChartProps {
  metrics: MetricsBatchPayload | null;
}

// ─── Constants ───────────────────────────────────────────────────

const MAX_BUFFER_SIZE = 120;

// ─── Helpers ─────────────────────────────────────────────────────

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// ─── Component ───────────────────────────────────────────────────

export function LatencyChart({ metrics }: LatencyChartProps) {
  const bufferRef = useRef<LatencyDataPoint[]>([]);

  // Update buffer with new metrics
  const getData = useCallback((): LatencyDataPoint[] => {
    if (!metrics) return bufferRef.current;

    const lastPoint = bufferRef.current[bufferRef.current.length - 1];
    if (lastPoint && lastPoint.time === metrics.simulatedTimeMs) {
      return bufferRef.current;
    }

    const newPoint: LatencyDataPoint = {
      time: metrics.simulatedTimeMs,
      timeLabel: formatTime(metrics.simulatedTimeMs),
      p50: metrics.systemWide.endToEndLatency.p50,
      p90: metrics.systemWide.endToEndLatency.p90,
      p99: metrics.systemWide.endToEndLatency.p99,
    };

    bufferRef.current = [...bufferRef.current, newPoint].slice(-MAX_BUFFER_SIZE);
    return bufferRef.current;
  }, [metrics]);

  const data = getData();

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
