import { useState, useEffect } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import type { MetricsBatchPayload } from '@/types/metrics';

// ─── Types ───────────────────────────────────────────────────────

interface ThroughputDataPoint {
  time: number;
  timeLabel: string;
  success: number;
  errors: number;
}

interface ThroughputChartProps {
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

export function ThroughputChart({ metrics }: ThroughputChartProps) {
  const [data, setData] = useState<ThroughputDataPoint[]>([]);

  useEffect(() => {
    if (!metrics) return;

    setData((prev) => {
      const lastPoint = prev[prev.length - 1];
      if (lastPoint && lastPoint.time === metrics.simulatedTimeMs) {
        return prev;
      }

      const totalThroughput = metrics.systemWide.totalThroughput;
      const errorRate = metrics.systemWide.totalErrorRate;
      const errorThroughput = totalThroughput * errorRate;
      const successThroughput = totalThroughput - errorThroughput;

      const newPoint: ThroughputDataPoint = {
        time: metrics.simulatedTimeMs,
        timeLabel: formatTime(metrics.simulatedTimeMs),
        success: Math.round(successThroughput * 100) / 100,
        errors: Math.round(errorThroughput * 100) / 100,
      };

      return [...prev, newPoint].slice(-MAX_BUFFER_SIZE);
    });
  }, [metrics]);

  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-gray-500">
        Awaiting throughput data…
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis
          dataKey="timeLabel"
          tick={{ fill: '#9ca3af', fontSize: 10 }}
          stroke="#4b5563"
        />
        <YAxis
          tick={{ fill: '#9ca3af', fontSize: 10 }}
          stroke="#4b5563"
          label={{ value: 'req/s', position: 'insideLeft', fill: '#9ca3af', fontSize: 10 }}
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
        <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} />
        <Area
          type="monotone"
          dataKey="success"
          name="Success"
          stackId="1"
          stroke="#22c55e"
          fill="#22c55e"
          fillOpacity={0.4}
        />
        <Area
          type="monotone"
          dataKey="errors"
          name="Errors"
          stackId="1"
          stroke="#ef4444"
          fill="#ef4444"
          fillOpacity={0.4}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
