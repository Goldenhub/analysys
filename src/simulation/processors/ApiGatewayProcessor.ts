import type { ApiGatewayConfig } from '@/types/nodes';
import type { UtilizationReading } from '@/types/metrics';
import type { NodeProcessor, SimEvent, SimRequest, ProcessorContext } from '../types';
import { SimEventType, RequestStatus } from '../types';

/**
 * Front door of the topology: applies an authentication latency to every
 * request and rejects a configurable fraction as unauthorized before they
 * reach any downstream capacity.
 */
export class ApiGatewayProcessor implements NodeProcessor {
  private config: ApiGatewayConfig;
  private admittedInWindow = 0;
  private rejectedInWindow = 0;

  constructor(config: ApiGatewayConfig) {
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

    const rng = context.getRNG();
    const authLatency = rng.normalPositive(
      this.config.authLatencyMeanMs,
      this.config.authLatencyStdDevMs,
    );

    // Auth work happens whether or not the request is admitted.
    request.accumulatedLatencyMs += authLatency;
    state.totalProcessed++;
    state.latencySamples.push(authLatency);

    // Unauthorized rejection — terminates here, never touches downstream.
    if (rng.next() < this.config.rejectionRate) {
      this.rejectedInWindow++;
      request.status = RequestStatus.Dropped;
      request.completedAt = event.timestamp + authLatency;
      state.totalDropped++;
      context.recordDeparture(event.nodeId, request.id, event.timestamp + authLatency);
      return;
    }

    const edges = context.getOutgoingEdges(event.nodeId);
    if (edges.length === 0) {
      request.status = RequestStatus.Dropped;
      request.completedAt = event.timestamp + authLatency;
      state.totalDropped++;
      context.recordDeparture(event.nodeId, request.id, event.timestamp + authLatency);
      return;
    }

    this.admittedInWindow++;
    context.scheduleEvent({
      type: SimEventType.RequestRoute,
      timestamp: event.timestamp + authLatency,
      nodeId: edges[0]!.target,
      requestId: request.id,
      payload: { fromNodeId: event.nodeId },
    });
    context.recordDeparture(event.nodeId, request.id, event.timestamp + authLatency);
  }

  onChaosApplied(_chaosType: string, _params: Record<string, unknown>): void {
    // The gateway has no chaos behaviour of its own.
  }

  onChaosReverted(): void {
    // No chaos state to revert.
  }

  getUtilization(): UtilizationReading {
    // Not capacity-bound; report the observed rejection rate as a stress proxy.
    const total = this.admittedInWindow + this.rejectedInWindow;
    if (total === 0) return { kind: 'value', value: 0, idle: true };
    return { kind: 'value', value: this.rejectedInWindow / total, idle: false };
  }

  resetWindowCounters(): void {
    this.admittedInWindow = 0;
    this.rejectedInWindow = 0;
  }
}
