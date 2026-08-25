import type { PercentileStats } from '@/types/metrics';
import type { SimRequest, TerminalStatus } from '../types';
import { RequestStatus, TERMINAL_STATUSES } from '../types';
import { computePercentiles } from './percentiles';

/**
 * Whole-run cumulative aggregates — Task 437.
 *
 * The existing `completedRequests` array in MetricsCollector prunes to a sliding
 * 5,000 ms window to prevent unbounded memory growth. That is correct for per-window
 * metrics, but baselines (R40) and comparison need whole-run statistics:
 * latency percentiles, throughput, and error rate computed over the full simulated
 * duration — not a snapshot of the last five seconds.
 *
 * This accumulator maintains O(1)-update counters and a bounded reservoir of latency
 * samples for percentile estimation across the full run.
 */
export class RunCumulativeAccumulator {
  private totalTerminations = 0;
  private successCount = 0;
  private latencySamples: number[] = [];
  private terminalCounts: Record<string, number>;
  private startTimeMs = 0;
  private lastTerminationTimeMs = 0;

  /** Maximum reservoir size for latency samples (reservoir sampling). */
  private static readonly MAX_RESERVOIR_SIZE = 10_000;

  /**
   * `rng` must be deterministic (the engine supplies a seeded stream derived from
   * the run's seed) so that whole-run percentiles are reproducible for a given
   * seed. Defaults to Math.random only for standalone/test use.
   */
  constructor(private rng: () => number = Math.random) {
    this.terminalCounts = {};
    for (const status of TERMINAL_STATUSES) {
      this.terminalCounts[status] = 0;
    }
  }

  /**
   * Record a request that has received a terminal status.
   * Called from the engine at terminal-assignment time.
   */
  recordTermination(request: SimRequest, status: TerminalStatus, timestamp: number): void {
    this.totalTerminations++;
    this.terminalCounts[status] = (this.terminalCounts[status] ?? 0) + 1;
    this.lastTerminationTimeMs = timestamp;

    if (status === RequestStatus.Success) {
      this.successCount++;
      // Reservoir sampling for latency percentiles
      if (this.latencySamples.length < RunCumulativeAccumulator.MAX_RESERVOIR_SIZE) {
        this.latencySamples.push(request.accumulatedLatencyMs);
      } else {
        // Reservoir sampling: replace a random element with decreasing probability
        const idx = Math.floor(this.rng() * this.totalTerminations);
        if (idx < RunCumulativeAccumulator.MAX_RESERVOIR_SIZE) {
          this.latencySamples[idx] = request.accumulatedLatencyMs;
        }
      }
    }
  }

  setStartTime(startTimeMs: number): void {
    this.startTimeMs = startTimeMs;
  }

  // ─── Query Methods ───────────────────────────────────────────

  /** Total number of terminal-status assignments across the run. */
  getTotalTerminations(): number {
    return this.totalTerminations;
  }

  /** Successful completions across the run. */
  getSuccessCount(): number {
    return this.successCount;
  }

  /** Whole-run error rate: non-success / total. */
  getErrorRate(): number {
    if (this.totalTerminations === 0) return 0;
    return (this.totalTerminations - this.successCount) / this.totalTerminations;
  }

  /** Whole-run throughput: successes per second over the full duration. */
  getThroughput(currentTimeMs: number): number {
    const durationSec = (currentTimeMs - this.startTimeMs) / 1000;
    if (durationSec <= 0) return 0;
    return this.successCount / durationSec;
  }

  /** Whole-run latency percentiles from the reservoir. */
  getLatencyPercentiles(): PercentileStats {
    return computePercentiles(this.latencySamples);
  }

  /** Per-status cumulative counts. */
  getTerminalCounts(): Record<string, number> {
    return { ...this.terminalCounts };
  }

  /** Duration from start to last termination. */
  getDurationMs(): number {
    return this.lastTerminationTimeMs - this.startTimeMs;
  }

  /** Full reset for simulation restart. */
  reset(): void {
    this.totalTerminations = 0;
    this.successCount = 0;
    this.latencySamples = [];
    this.startTimeMs = 0;
    this.lastTerminationTimeMs = 0;
    for (const status of TERMINAL_STATUSES) {
      this.terminalCounts[status] = 0;
    }
  }
}
