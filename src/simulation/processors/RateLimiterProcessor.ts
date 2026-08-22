import type { RateLimiterConfig } from '@/types/nodes';
import type { NodeProcessor, SimEvent, SimRequest, ProcessorContext } from '../types';
import { SimEventType, RequestStatus } from '../types';

/**
 * Token bucket rate limiter. Admits a burst up to `bucketCapacity` and then
 * only as fast as `refillRatePerSec` replenishes tokens; everything else is
 * rejected outright (the 429 case). Fully deterministic — no RNG.
 */
export class RateLimiterProcessor implements NodeProcessor {
  private config: RateLimiterConfig;
  private tokens: number;
  private lastRefillTime = 0;

  /** Fixed admission overhead — a bucket check is cheap but not free. */
  private static readonly ADMIT_LATENCY_MS = 0.3;

  constructor(config: RateLimiterConfig) {
    this.config = { ...config };
    this.tokens = config.bucketCapacity;
  }

  onRequestArrived(
    event: SimEvent,
    request: SimRequest,
    context: ProcessorContext,
  ): void {
    const state = context.getNodeState(event.nodeId);
    if (!state) return;

    context.recordArrival(event.nodeId, request.id, event.timestamp);

    this.refill(event.timestamp);

    // Bucket empty — reject without consulting downstream.
    if (this.tokens < 1) {
      request.status = RequestStatus.Dropped;
      request.completedAt = event.timestamp;
      state.totalDropped++;
      context.recordDeparture(event.nodeId, request.id, event.timestamp);
      return;
    }

    this.tokens -= 1;

    const latency = RateLimiterProcessor.ADMIT_LATENCY_MS;
    request.accumulatedLatencyMs += latency;
    state.totalProcessed++;
    state.latencySamples.push(latency);

    const edges = context.getOutgoingEdges(event.nodeId);
    if (edges.length === 0) {
      request.status = RequestStatus.Dropped;
      request.completedAt = event.timestamp + latency;
      state.totalDropped++;
      context.recordDeparture(event.nodeId, request.id, event.timestamp + latency);
      return;
    }

    context.scheduleEvent({
      type: SimEventType.RequestRoute,
      timestamp: event.timestamp + latency,
      nodeId: edges[0]!.target,
      requestId: request.id,
      payload: { fromNodeId: event.nodeId },
    });
    context.recordDeparture(event.nodeId, request.id, event.timestamp + latency);
  }

  private refill(timestamp: number): void {
    const elapsedSec = (timestamp - this.lastRefillTime) / 1000;
    this.tokens = Math.min(
      this.config.bucketCapacity,
      this.tokens + elapsedSec * this.config.refillRatePerSec,
    );
    this.lastRefillTime = timestamp;
  }

  onChaosApplied(_chaosType: string, _params: Record<string, unknown>): void {
    // The limiter has no chaos behaviour of its own.
  }

  onChaosReverted(): void {
    // No chaos state to revert.
  }

  getUtilization(): number {
    // Fraction of the bucket drained — 1 means the next request is rejected.
    const used = 1 - this.tokens / this.config.bucketCapacity;
    return Math.max(0, Math.min(1, used));
  }
}
