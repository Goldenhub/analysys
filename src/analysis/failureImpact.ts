/**
 * Failure Impact Comparison — Requirement 39.12
 *
 * Compare the pre-failure window (most recent window completing at or before the failure
 * instant) against every window lying wholly within the failure interval, excluding
 * partial overlaps at both ends.
 *
 * Reports:
 * - Change in success rate: signed absolute difference + signed percentage of pre-failure value.
 * - Change in end-to-end p99: signed absolute difference + signed percentage of pre-failure value.
 * - "Not applicable" where pre-failure value is 0 (for percentage).
 * - Both "not applicable" where no window lies wholly inside (common for failure < metricsIntervalMs).
 */

import type { NodeMetricsWindow } from '@/analysis/AnalysisWindowStore';

// ─── Types ───────────────────────────────────────────────────────

export interface FailureImpactResult {
  /** Whether any complete window lies wholly within the failure interval. */
  hasCompleteWindow: boolean;
  /** If no complete window lies within: "The failure interval contained no complete metrics window." */
  notApplicableReason?: string;
  /** Success rate change (absolute difference). Null if not applicable. */
  successRateAbsChange: number | null;
  /** Success rate change (percentage of pre-failure value). Null if pre-failure is 0. */
  successRatePctChange: number | null;
  /** P99 latency change (absolute difference). Null if not applicable. */
  p99AbsChange: number | null;
  /** P99 latency change (percentage of pre-failure value). Null if pre-failure is 0. */
  p99PctChange: number | null;
  /** Pre-failure success rate. */
  preFailureSuccessRate: number | null;
  /** Pre-failure p99. */
  preFailureP99: number | null;
}

// ─── Computation ─────────────────────────────────────────────────

/**
 * Compute the failure impact by comparing pre-failure metrics against
 * windows wholly within the failure interval.
 *
 * @param windows - Available metrics windows.
 * @param failureStartMs - Simulated time the failure began.
 * @param failureEndMs - Simulated time the failure ended.
 */
export function computeFailureImpact(
  windows: readonly NodeMetricsWindow[],
  failureStartMs: number,
  failureEndMs: number,
): FailureImpactResult {
  // Filter only completed windows (durationMs > 0)
  const completed = windows.filter((w) => w.durationMs > 0);

  // Pre-failure window: most recent window completing at or before failureStartMs
  let preFailureWindow: NodeMetricsWindow | null = null;
  for (const w of completed) {
    if (w.endMs <= failureStartMs) {
      preFailureWindow = w;
    }
  }

  // Windows wholly within the failure interval: startMs >= failureStartMs AND endMs <= failureEndMs
  const failureWindows = completed.filter(
    (w) => w.startMs >= failureStartMs && w.endMs <= failureEndMs,
  );

  if (failureWindows.length === 0) {
    return {
      hasCompleteWindow: false,
      notApplicableReason: 'The failure interval contained no complete metrics window.',
      successRateAbsChange: null,
      successRatePctChange: null,
      p99AbsChange: null,
      p99PctChange: null,
      preFailureSuccessRate: preFailureWindow ? computeSuccessRate(preFailureWindow) : null,
      preFailureP99: preFailureWindow ? preFailureWindow.systemWide.endToEndLatency.p99 : null,
    };
  }

  if (!preFailureWindow) {
    return {
      hasCompleteWindow: true,
      notApplicableReason: 'No pre-failure window available for comparison.',
      successRateAbsChange: null,
      successRatePctChange: null,
      p99AbsChange: null,
      p99PctChange: null,
      preFailureSuccessRate: null,
      preFailureP99: null,
    };
  }

  // Compute averages over failure windows
  let totalSuccessRate = 0;
  let totalP99 = 0;
  for (const w of failureWindows) {
    totalSuccessRate += computeSuccessRate(w);
    totalP99 += w.systemWide.endToEndLatency.p99;
  }
  const avgSuccessRate = totalSuccessRate / failureWindows.length;
  const avgP99 = totalP99 / failureWindows.length;

  const preSuccessRate = computeSuccessRate(preFailureWindow);
  const preP99 = preFailureWindow.systemWide.endToEndLatency.p99;

  // Absolute differences
  const successRateAbsChange = avgSuccessRate - preSuccessRate;
  const p99AbsChange = avgP99 - preP99;

  // Percentage differences (not applicable where pre-failure value is 0)
  const successRatePctChange =
    preSuccessRate !== 0 ? (successRateAbsChange / preSuccessRate) * 100 : null;
  const p99PctChange = preP99 !== 0 ? (p99AbsChange / preP99) * 100 : null;

  return {
    hasCompleteWindow: true,
    successRateAbsChange,
    successRatePctChange,
    p99AbsChange,
    p99PctChange,
    preFailureSuccessRate: preSuccessRate,
    preFailureP99: preP99,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

function computeSuccessRate(window: NodeMetricsWindow): number {
  // Success rate = 1 - totalErrorRate (error rate is already a fraction)
  return 1 - window.systemWide.totalErrorRate;
}
