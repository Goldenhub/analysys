import type { PercentileStats } from '@/types/metrics';
import type { RequestStatus } from '@/simulation/types';
import { computePercentiles } from './percentiles';

// ─── MeasurementIntervalAccumulator (Task 496) ───────────────────

/**
 * Accumulates end-to-end latency samples and terminal statuses during the
 * measurement interval [warmUpMs, durationPerStepMs] of a sweep step.
 *
 * p99 over this interval cannot be reconstructed by averaging window percentiles,
 * so this accumulator records individual samples and computes exact percentiles.
 *
 * Starts recording only when the virtual clock passes warmUpMs.
 */
export class MeasurementIntervalAccumulator {
  private readonly warmUpMs: number;
  private readonly durationMs: number;
  private recording = false;
  private readonly latencySamples: number[] = [];
  private readonly terminalCounts: Record<string, number> = {};
  private totalTerminations = 0;
  private totalErrors = 0;
  private schedulerJobsEmitted = 0;

  constructor(warmUpMs: number, durationMs: number) {
    this.warmUpMs = warmUpMs;
    this.durationMs = durationMs;
  }

  /**
   * Called on each simulation tick/event to check if recording should begin.
   * Returns true if the accumulator is now recording.
   */
  checkClock(simulatedTimeMs: number): boolean {
    if (!this.recording && simulatedTimeMs >= this.warmUpMs) {
      this.recording = true;
    }
    return this.recording;
  }

  /**
   * Whether the accumulator is currently recording (past warm-up).
   */
  isRecording(): boolean {
    return this.recording;
  }

  /**
   * Record the completion of a request/Job with its end-to-end latency and terminal status.
   * Only records if the accumulator is in recording mode (past warm-up).
   */
  recordTermination(
    latencyMs: number,
    status: RequestStatus | string,
    isError: boolean,
    isSchedulerJob?: boolean,
  ): void {
    if (!this.recording) return;

    this.latencySamples.push(latencyMs);
    this.terminalCounts[status] = (this.terminalCounts[status] ?? 0) + 1;
    this.totalTerminations++;

    if (isError) {
      this.totalErrors++;
    }

    if (isSchedulerJob) {
      this.schedulerJobsEmitted++;
    }
  }

  /**
   * Record a Scheduler-emitted Job (counted separately from offered load).
   */
  recordSchedulerJob(): void {
    if (!this.recording) return;
    this.schedulerJobsEmitted++;
  }

  /**
   * Get the measurement interval boundaries.
   */
  getMeasurementInterval(): { startMs: number; endMs: number } {
    return { startMs: this.warmUpMs, endMs: this.durationMs };
  }

  /**
   * Compute the latency percentiles over the measurement interval.
   */
  getPercentiles(): PercentileStats {
    return computePercentiles(this.latencySamples);
  }

  /**
   * Get the total error rate over the measurement interval.
   * Returns 0 if no terminations were recorded.
   */
  getTotalErrorRate(): number {
    if (this.totalTerminations === 0) return 0;
    return this.totalErrors / this.totalTerminations;
  }

  /**
   * Get the terminal status counts.
   */
  getTerminalCounts(): Record<string, number> {
    return { ...this.terminalCounts };
  }

  /**
   * Get total number of terminations recorded.
   */
  getTotalTerminations(): number {
    return this.totalTerminations;
  }

  /**
   * Get count of Scheduler-emitted Jobs.
   */
  getSchedulerJobsEmitted(): number {
    return this.schedulerJobsEmitted;
  }

  /**
   * Get the number of latency samples.
   */
  getSampleCount(): number {
    return this.latencySamples.length;
  }

  /**
   * Get the achieved throughput (terminations per second over the measurement interval).
   */
  getAchievedThroughput(): number {
    const intervalMs = this.durationMs - this.warmUpMs;
    if (intervalMs <= 0) return 0;
    return (this.totalTerminations / intervalMs) * 1000;
  }

  /**
   * Reset the accumulator for a new step.
   */
  reset(): void {
    this.recording = false;
    this.latencySamples.length = 0;
    Object.keys(this.terminalCounts).forEach((k) => {
      delete this.terminalCounts[k];
    });
    this.totalTerminations = 0;
    this.totalErrors = 0;
    this.schedulerJobsEmitted = 0;
  }
}
