import type { CacheConfig } from '@/types/nodes';
import type { NodeProcessor, SimEvent, SimRequest, ProcessorContext } from '../types';
import { SimEventType, RequestStatus } from '../types';

export class CacheProcessor implements NodeProcessor {
  private config: CacheConfig;
  private originalHitRatio: number;
  private chaosActive = false;

  constructor(config: CacheConfig) {
    this.config = { ...config };
    this.originalHitRatio = config.hitRatio;
  }

  onRequestArrived(
    event: SimEvent,
    request: SimRequest,
    context: ProcessorContext,
  ): void {
    const state = context.getNodeState(event.nodeId);
    if (!state) return;

    context.recordArrival(event.nodeId, request.id, event.timestamp);

    const rng = context.getRNG();
    const isHit = rng.next() < this.config.hitRatio;

    // Access latency always incurred (lookup cost)
    const accessTime = this.config.accessLatencyMs;
    request.accumulatedLatencyMs += accessTime;

    if (isHit) {
      // Cache hit — respond immediately after access latency
      state.totalProcessed++;
      state.latencySamples.push(accessTime);

      const edges = context.getOutgoingEdges(event.nodeId);
      if (edges.length > 0) {
        // Even on cache hit, if there's a downstream, it means we're done here
        // Cache hits don't forward to DB — mark as complete or route back
        request.status = RequestStatus.Success;
        request.completedAt = event.timestamp + accessTime;
      } else {
        request.status = RequestStatus.Success;
        request.completedAt = event.timestamp + accessTime;
      }
      context.recordDeparture(event.nodeId, request.id, event.timestamp + accessTime);

      // Schedule a completion event
      context.scheduleEvent({
        type: SimEventType.RequestComplete,
        timestamp: event.timestamp + accessTime,
        nodeId: event.nodeId,
        requestId: request.id,
        payload: { cacheHit: true },
      });
    } else {
      // Cache miss — forward to downstream (DB)
      const edges = context.getOutgoingEdges(event.nodeId);
      if (edges.length > 0) {
        const target = edges[0]!.target;
        context.scheduleEvent({
          type: SimEventType.RequestRoute,
          timestamp: event.timestamp + accessTime,
          nodeId: target,
          requestId: request.id,
          payload: { fromNodeId: event.nodeId, cacheMiss: true },
        });
        context.recordDeparture(event.nodeId, request.id, event.timestamp + accessTime);
      } else {
        // No downstream — treat as error
        request.status = RequestStatus.Dropped;
        request.completedAt = event.timestamp + accessTime;
        state.totalDropped++;
        context.recordDeparture(event.nodeId, request.id, event.timestamp + accessTime);
      }
      state.totalProcessed++;
    }
  }

  onChaosApplied(chaosType: string, _params: Record<string, unknown>): void {
    if (chaosType === 'FLUSH_CACHE') {
      this.chaosActive = true;
      this.config.hitRatio = 0;
    }
  }

  onChaosReverted(): void {
    if (this.chaosActive) {
      this.config.hitRatio = this.originalHitRatio;
      this.chaosActive = false;
    }
  }

  getUtilization(): number {
    // Cache utilization isn't directly capacity-bound in this model
    // Report inverse of hit ratio as a proxy (more misses = more stressed)
    return 1 - this.config.hitRatio;
  }
}
