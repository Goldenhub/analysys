import type { DeadLetterQueueConfig } from '@/types/nodes';
import type { UtilizationReading } from '@/types/metrics';
import type { NodeProcessor, SimEvent, SimRequest, ProcessorContext } from '../types';
import { SimEventType } from '../types';

/**
 * Phase 14 skeleton — accepts a request, records arrival and departure,
 * forwards along the resolved target, and returns a not-applicable utilization.
 * Real behavior lands in Phase 16.
 */
export class DeadLetterQueueSkeletonProcessor implements NodeProcessor {
  private config: DeadLetterQueueConfig;

  constructor(config: DeadLetterQueueConfig) {
    this.config = { ...config };
  }

  onRequestArrived(
    event: SimEvent,
    request: SimRequest,
    context: ProcessorContext,
  ): void {
    const state = context.getNodeState(event.nodeId);
    if (!state) return;

    context.recordArrival(event.nodeId, request.id, event.timestamp);
    state.totalProcessed++;
    state.latencySamples.push(0);

    const targets = context.resolveTargets(event.nodeId, request);
    if (targets.length > 0) {
      context.scheduleEvent({
        type: SimEventType.RequestRoute,
        timestamp: event.timestamp,
        nodeId: targets[0]!.target,
        requestId: request.id,
        payload: { fromNodeId: event.nodeId },
      });
    }

    context.recordDeparture(event.nodeId, request.id, event.timestamp);
  }

  onChaosApplied(): void {}
  onChaosReverted(): void {}

  getUtilization(): UtilizationReading {
    // Config retained for Phase 16; reference it to satisfy noUnusedLocals.
    void this.config;
    return { kind: 'not-applicable', reason: 'skeleton — real processor lands in Phase 16' };
  }
}
