import { describe, it, expect } from 'vitest';
import { MeasurementIntervalAccumulator } from './MeasurementIntervalAccumulator';

describe('MeasurementIntervalAccumulator', () => {
  it('does not record before warmUpMs', () => {
    const acc = new MeasurementIntervalAccumulator(10_000, 30_000);
    acc.checkClock(5_000);
    acc.recordTermination(100, 'SUCCESS', false);
    expect(acc.getTotalTerminations()).toBe(0);
    expect(acc.getSampleCount()).toBe(0);
  });

  it('starts recording after warmUpMs', () => {
    const acc = new MeasurementIntervalAccumulator(10_000, 30_000);
    acc.checkClock(10_000);
    expect(acc.isRecording()).toBe(true);
    acc.recordTermination(100, 'SUCCESS', false);
    expect(acc.getTotalTerminations()).toBe(1);
    expect(acc.getSampleCount()).toBe(1);
  });

  it('starts recording when clock passes warmUpMs', () => {
    const acc = new MeasurementIntervalAccumulator(10_000, 30_000);
    acc.checkClock(15_000);
    expect(acc.isRecording()).toBe(true);
  });

  it('computes correct percentiles from samples', () => {
    const acc = new MeasurementIntervalAccumulator(0, 30_000);
    acc.checkClock(0);

    // Add 100 samples: 1, 2, 3, ... 100
    for (let i = 1; i <= 100; i++) {
      acc.recordTermination(i, 'SUCCESS', false);
    }

    const percentiles = acc.getPercentiles();
    // nearest-rank: floor(100 * 0.5) = index 50 → value 51
    expect(percentiles.p50).toBe(51);
    // floor(100 * 0.9) = index 90 → value 91
    expect(percentiles.p90).toBe(91);
    // floor(100 * 0.99) = index 99 → value 100
    expect(percentiles.p99).toBe(100);
  });

  it('computes correct error rate', () => {
    const acc = new MeasurementIntervalAccumulator(0, 30_000);
    acc.checkClock(0);

    // 8 successes, 2 errors
    for (let i = 0; i < 8; i++) {
      acc.recordTermination(100, 'SUCCESS', false);
    }
    for (let i = 0; i < 2; i++) {
      acc.recordTermination(100, 'TIMEOUT', true);
    }

    expect(acc.getTotalErrorRate()).toBeCloseTo(0.2);
  });

  it('returns 0 error rate when no terminations', () => {
    const acc = new MeasurementIntervalAccumulator(0, 30_000);
    expect(acc.getTotalErrorRate()).toBe(0);
  });

  it('tracks terminal counts by status', () => {
    const acc = new MeasurementIntervalAccumulator(0, 30_000);
    acc.checkClock(0);

    acc.recordTermination(50, 'SUCCESS', false);
    acc.recordTermination(100, 'SUCCESS', false);
    acc.recordTermination(200, 'TIMEOUT', true);
    acc.recordTermination(300, 'DROPPED', true);

    const counts = acc.getTerminalCounts();
    expect(counts['SUCCESS']).toBe(2);
    expect(counts['TIMEOUT']).toBe(1);
    expect(counts['DROPPED']).toBe(1);
  });

  it('tracks scheduler jobs separately', () => {
    const acc = new MeasurementIntervalAccumulator(0, 30_000);
    acc.checkClock(0);

    acc.recordSchedulerJob();
    acc.recordSchedulerJob();
    acc.recordSchedulerJob();

    expect(acc.getSchedulerJobsEmitted()).toBe(3);
  });

  it('computes achieved throughput over measurement interval', () => {
    const acc = new MeasurementIntervalAccumulator(10_000, 30_000);
    acc.checkClock(10_000);

    // 100 terminations over a 20s measurement interval
    for (let i = 0; i < 100; i++) {
      acc.recordTermination(50, 'SUCCESS', false);
    }

    // 100 terminations / 20,000 ms * 1000 = 5 req/s
    expect(acc.getAchievedThroughput()).toBe(5);
  });

  it('returns correct measurement interval', () => {
    const acc = new MeasurementIntervalAccumulator(10_000, 30_000);
    expect(acc.getMeasurementInterval()).toEqual({ startMs: 10_000, endMs: 30_000 });
  });

  it('resets all state correctly', () => {
    const acc = new MeasurementIntervalAccumulator(0, 30_000);
    acc.checkClock(0);
    acc.recordTermination(100, 'SUCCESS', false);
    acc.recordSchedulerJob();

    acc.reset();

    expect(acc.isRecording()).toBe(false);
    expect(acc.getTotalTerminations()).toBe(0);
    expect(acc.getSampleCount()).toBe(0);
    expect(acc.getSchedulerJobsEmitted()).toBe(0);
    expect(Object.keys(acc.getTerminalCounts())).toHaveLength(0);
  });

  it('does not record scheduler jobs before warmUp', () => {
    const acc = new MeasurementIntervalAccumulator(10_000, 30_000);
    acc.recordSchedulerJob();
    expect(acc.getSchedulerJobsEmitted()).toBe(0);
  });
});
