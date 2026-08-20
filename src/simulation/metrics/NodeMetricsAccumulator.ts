import type { LittlesLawMetrics } from '@/types/metrics';

interface ArrivalRecord {
  requestId: string;
  arrivedAt: number;
  departedAt?: number;
}

/**
 * Per-node metrics collector implementing Little's Law computation.
 * Uses a sliding time window for stability assessment.
 *
 * Little's Law: L = λ × W
 *   L = time-weighted average occupancy (items in system)
 *   λ = arrival rate (requests/sec)
 *   W = average sojourn time (ms)
 */
export class NodeMetricsAccumulator {
  private arrivals: ArrivalRecord[] = [];
  private currentOccupancy = 0;
  private lastEventTime = 0;
  private weightedOccupancySum = 0;
  private windowStartTime = 0;

  constructor(
    public readonly nodeId: string,
    private windowMs: number = 5000,
  ) {}

  recordArrival(requestId: string, timestamp: number): void {
    this.updateWeightedOccupancy(timestamp);
    this.currentOccupancy++;
    this.arrivals.push({ requestId, arrivedAt: timestamp });
  }

  recordDeparture(requestId: string, timestamp: number): void {
    this.updateWeightedOccupancy(timestamp);
    this.currentOccupancy = Math.max(0, this.currentOccupancy - 1);

    const record = this.arrivals.find((a) => a.requestId === requestId && !a.departedAt);
    if (record) {
      record.departedAt = timestamp;
    }
  }

  /**
   * Compute Little's Law metrics over the current sliding window.
   */
  compute(currentTime: number): LittlesLawMetrics {
    this.pruneWindow(currentTime);
    this.updateWeightedOccupancy(currentTime);

    const windowDuration = currentTime - this.windowStartTime;
    if (windowDuration <= 0) {
      return this.emptyMetrics();
    }

    // λ: arrival rate (per second)
    const arrivalsInWindow = this.arrivals.filter(
      (a) => a.arrivedAt >= this.windowStartTime,
    ).length;
    const lambda = arrivalsInWindow / (windowDuration / 1000);

    // W: average sojourn time (ms) of completed requests in window
    const completedInWindow = this.arrivals.filter(
      (a) => a.departedAt !== undefined && a.departedAt >= this.windowStartTime,
    );
    const W =
      completedInWindow.length > 0
        ? completedInWindow.reduce((sum, a) => sum + (a.departedAt! - a.arrivedAt), 0) /
          completedInWindow.length
        : 0;

    // L: time-weighted average occupancy
    const L = this.weightedOccupancySum / windowDuration;

    // Deviation: |L - λ*W/1000| / max(L, 0.001)
    const lambdaW = lambda * (W / 1000);
    const deviation = L > 0.001 ? Math.abs(L - lambdaW) / L : 0;

    return {
      nodeId: this.nodeId,
      L,
      lambda,
      W,
      deviation,
      isStable: deviation < 0.05,
    };
  }

  getCurrentOccupancy(): number {
    return this.currentOccupancy;
  }

  reset(): void {
    this.arrivals = [];
    this.currentOccupancy = 0;
    this.weightedOccupancySum = 0;
    this.lastEventTime = 0;
    this.windowStartTime = 0;
  }

  private updateWeightedOccupancy(timestamp: number): void {
    const dt = timestamp - this.lastEventTime;
    if (dt > 0) {
      this.weightedOccupancySum += this.currentOccupancy * dt;
    }
    this.lastEventTime = timestamp;
  }

  private pruneWindow(currentTime: number): void {
    const newWindowStart = Math.max(0, currentTime - this.windowMs);

    // Recompute weighted occupancy for the new window
    // (simplified: we accept slight drift for performance; full recompute on window shift)
    if (newWindowStart > this.windowStartTime) {
      // Subtract the portion of weighted sum that fell out of the window
      const removedDuration = newWindowStart - this.windowStartTime;
      // Approximate: we can't perfectly reconstruct past occupancy, so we scale
      const totalDuration = this.lastEventTime - this.windowStartTime;
      if (totalDuration > 0) {
        const ratio = removedDuration / totalDuration;
        this.weightedOccupancySum *= (1 - ratio);
      }
    }

    this.windowStartTime = newWindowStart;

    // Remove records fully outside the window
    this.arrivals = this.arrivals.filter(
      (a) => (a.departedAt ?? currentTime) >= this.windowStartTime,
    );
  }

  private emptyMetrics(): LittlesLawMetrics {
    return { nodeId: this.nodeId, L: 0, lambda: 0, W: 0, deviation: 0, isStable: true };
  }
}
