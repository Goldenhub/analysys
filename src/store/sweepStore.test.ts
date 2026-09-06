import { describe, it, expect, beforeEach } from 'vitest';
import { useSweepStore } from './sweepStore';
import type { SweepStepCompletePayload } from '@/types/messages';
import { DEFAULT_SWEEP_CONFIG } from '@/analysis/CapacitySweepController';

function payload(stepIndex: number, overrides: Partial<SweepStepCompletePayload> = {}): SweepStepCompletePayload {
  return {
    stepIndex,
    requestedRps: 100 + stepIndex * 100,
    appliedRps: 100 + stepIndex * 100,
    achievedThroughput: 95,
    latency: { p50: 10, p90: 20, p99: 40 },
    totalErrorRate: 0.01,
    terminalCounts: { SUCCESS: 90 },
    schedulerJobsEmitted: 0,
    measurementInterval: { startMs: 10_000, endMs: 30_000 },
    verdict: 'satisfied',
    ...overrides,
  };
}

describe('sweepStore', () => {
  beforeEach(() => {
    useSweepStore.getState().resetSweep();
  });

  it('accumulates step results while running and advances the cursor', () => {
    const store = useSweepStore.getState();
    store.beginSweep({ ...DEFAULT_SWEEP_CONFIG });
    expect(useSweepStore.getState().status).toBe('running');

    useSweepStore.getState().onStepComplete(payload(0));
    useSweepStore.getState().onStepComplete(payload(1));

    const state = useSweepStore.getState();
    expect(state.results).toHaveLength(2);
    expect(state.currentStepIndex).toBe(2);
  });

  it('ignores late completions after finalization', () => {
    useSweepStore.getState().beginSweep({ ...DEFAULT_SWEEP_CONFIG });
    useSweepStore.getState().finalizeSweep('completed');
    useSweepStore.getState().onStepComplete(payload(0));

    expect(useSweepStore.getState().results).toHaveLength(0);
  });

  it('computes knee point and sustainable load on completion', () => {
    useSweepStore.getState().beginSweep({
      ...DEFAULT_SWEEP_CONFIG,
      startRps: 100,
      endRps: 300,
      stepCount: 3,
      objective: { maxP99LatencyMs: 50, maxErrorRate: 0.05 },
    });

    // Step 0 satisfies; steps 1–2 violate (p99 above the 50ms objective).
    useSweepStore
      .getState()
      .onStepComplete(payload(0));
    useSweepStore
      .getState()
      .onStepComplete(
        payload(1, { verdict: 'violated', latency: { p50: 60, p90: 80, p99: 120 } }),
      );
    useSweepStore
      .getState()
      .onStepComplete(
        payload(2, { verdict: 'violated', latency: { p50: 90, p90: 110, p99: 200 } }),
      );

    useSweepStore.getState().finalizeSweep('completed');

    const report = useSweepStore.getState().report!;
    expect(report.status).toBe('completed');
    expect(report.kneePoint?.offeredRps).toBe(200);
    expect(report.sustainableLoad.offeredRps).toBe(100);
  });

  it('marks a cancelled report with the step it stopped at', () => {
    useSweepStore.getState().beginSweep({ ...DEFAULT_SWEEP_CONFIG });
    useSweepStore.getState().onStepComplete(payload(0));
    useSweepStore.getState().finalizeSweep('cancelled');

    const report = useSweepStore.getState().report!;
    expect(report.status).toBe('cancelled');
    expect(report.cancelledAtStep).toBe(1);
    expect(report.kneePoint).toBeNull();
  });
});
