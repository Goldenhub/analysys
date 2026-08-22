import type { AppServerConfig } from '@/types/nodes';
import type { UtilizationReading } from '@/types/metrics';
import type { NodeProcessor, SimEvent, SimRequest, ProcessorContext, NodeRuntimeState } from '../types';
import { SimEventType, RequestStatus } from '../types';

export class AppServerProcessor implements NodeProcessor {
  private config: AppServerConfig;
  private activeWorkers = 0;

  constructor(config: AppServerConfig) {
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

    // Check if we can process immediately (worker available)
    if (this.activeWorkers < this.config.workerThreadPoolSize) {
      this.processRequest(event, request, state, context);
    } else if (state.queuedRequests.length < this.config.requestQueueDepth) {
      // Enqueue
      state.queuedRequests.push(request.id);
      context.scheduleEvent({
        type: SimEventType.RequestEnqueue,
        timestamp: event.timestamp,
        nodeId: event.nodeId,
        requestId: request.id,
        payload: {},
      });
    } else {
      // Queue full — drop
      request.status = RequestStatus.Dropped;
      request.completedAt = event.timestamp;
      state.totalDropped++;
      context.recordDeparture(event.nodeId, request.id, event.timestamp);
    }
  }

  private processRequest(
    event: SimEvent,
    request: SimRequest,
    state: NodeRuntimeState,
    context: ProcessorContext,
  ): void {
    this.activeWorkers++;
    state.activeConnections = this.activeWorkers;

    const rng = context.getRNG();
    const processingTime = rng.normalPositive(
      this.config.processingTimeMeanMs,
      this.config.processingTimeStdDevMs,
    );

    request.accumulatedLatencyMs += processingTime;

    context.scheduleEvent({
      type: SimEventType.RequestProcess,
      timestamp: event.timestamp + processingTime,
      nodeId: event.nodeId,
      requestId: request.id,
      payload: { processingTime },
    });
  }

  /**
   * Called by the engine when a RequestProcess event fires.
   * Releases the worker and routes downstream.
   */
  onProcessComplete(
    event: SimEvent,
    request: SimRequest,
    context: ProcessorContext,
  ): void {
    const state = context.getNodeState(event.nodeId);
    if (!state) return;

    this.activeWorkers--;
    state.activeConnections = this.activeWorkers;
    state.totalProcessed++;
    state.latencySamples.push(request.accumulatedLatencyMs);

    // Route downstream
    const edges = context.getOutgoingEdges(event.nodeId);
    if (edges.length > 0) {
      const target = edges[0]!.target; // Simple: route to first downstream
      context.scheduleEvent({
        type: SimEventType.RequestRoute,
        timestamp: event.timestamp,
        nodeId: target,
        requestId: request.id,
        payload: { fromNodeId: event.nodeId },
      });
    } else {
      // Terminal — request complete
      request.status = RequestStatus.Success;
      request.completedAt = event.timestamp;
    }

    context.recordDeparture(event.nodeId, request.id, event.timestamp);

    // Dequeue next if any
    if (state.queuedRequests.length > 0) {
      const nextRequestId = state.queuedRequests.shift()!;
      context.scheduleEvent({
        type: SimEventType.RequestRoute,
        timestamp: event.timestamp + 0.01, // tiny delay for dequeue
        nodeId: event.nodeId,
        requestId: nextRequestId,
        payload: { fromQueue: true },
      });
    }
  }

  onChaosApplied(_chaosType: string, _params: Record<string, unknown>): void {
    // AppServer doesn't directly respond to chaos events
  }

  onChaosReverted(): void {
    // No-op
  }

  getUtilization(): UtilizationReading {
    const value =
      this.config.workerThreadPoolSize === 0
        ? 0
        : this.activeWorkers / this.config.workerThreadPoolSize;
    // TODO(task 392): `idle` mirrors the pre-existing `utilization === 0` derivation because
    // the pool holds no per-window arrival counter, so a pool with every worker momentarily
    // free reads the same as one that saw no traffic. Refine once an arrival count exists.
    return { kind: 'value', value, idle: value === 0 };
  }
}
