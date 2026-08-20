import type { PercentileStats } from '@/types/metrics';

/**
 * Compute p50, p90, p99 from an array of numeric samples.
 * Uses nearest-rank method.
 */
export function computePercentiles(samples: number[]): PercentileStats {
  if (samples.length === 0) return { p50: 0, p90: 0, p99: 0 };

  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
    p90: sorted[Math.floor(sorted.length * 0.9)] ?? 0,
    p99: sorted[Math.floor(sorted.length * 0.99)] ?? 0,
  };
}
