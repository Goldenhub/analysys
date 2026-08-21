import type { DatabaseConfig } from '@/types/nodes';
import type { NodeProcessor, SimEvent, SimRequest, ProcessorContext } from '../types';
import { SimEventType, RequestStatus } from '../types';

export class DatabaseProcessor implements NodeProcessor {
  private config: DatabaseConfig;
  private activeConnections = 0;
  private isDown = false;

  constructor(config: DatabaseConfig) {
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

    // If DB is down (chaos), timeout immediately
    if (this.isDown) {
      request.status = RequestStatus.Timeout;
      request.completedAt = event.timestamp;
      state.totalTimedOut++;
      context.recordDeparture(event.nodeId, request.id, event.timestamp);
      context.scheduleEvent({
        type: SimEventType.RequestTimeout,
        timestamp: event.timestamp,
        nodeId: event.nodeId,
        requestId: request.id,
        payload: { reason: 'DB_DOWN' },
      });
      return;
    }

    // Check connection pool
    if (this.activeConnections >= this.config.connectionPoolSize) {
      // Pool exhausted — check if we can queue (wait for lock timeout)
      if (state.queuedRequests.length < this.config.connectionPoolSize * 2) {
        // Wait in queue — schedule a timeout check
        state.queuedRequests.push(request.id);
        context.scheduleEvent({
          type: SimEventType.RequestTimeout,
          timestamp: event.timestamp + this.config.lockTimeoutMs,
          nodeId: event.nodeId,
          requestId: request.id,
          payload: { reason: 'POOL_EXHAUSTION_TIMEOUT' },
        });
      } else {
        // Hard drop
        request.status = RequestStatus.Dropped;
        request.completedAt = event.timestamp;
        state.totalDropped++;
        context.recordDeparture(event.nodeId, request.id, event.timestamp);
      }
      return;
    }

    this.acquireAndProcess(event, request, state, context);
  }

  private acquireAndProcess(
    event: SimEvent,
    request: SimRequest,
    state: import('../types').NodeRuntimeState,
    context: ProcessorContext,
  ): void {
    this.activeConnections++;
    state.activeConnections = this.activeConnections;

    const rng = context.getRNG();
    const queryTime = rng.normalPositive(
      this.config.queryLatencyMeanMs,
      this.config.queryLatencyStdDevMs,
    );

    request.accumulatedLatencyMs += queryTime;

    context.scheduleEvent({
      type: SimEventType.RequestProcess,
      timestamp: event.timestamp + queryTime,
      nodeId: event.nodeId,
      requestId: request.id,
      payload: { queryTime },
    });
  }

  /**
   * Called by engine when RequestProcess completes at this DB node.
   */
  onProcessComplete(
    event: SimEvent,
    request: SimRequest,
    context: ProcessorContext,
  ): void {
    const state = context.getNodeState(event.nodeId);
    if (!state) return;

    this.activeConnections--;
    state.activeConnections = this.activeConnections;
    state.totalProcessed++;
    state.latencySamples.push(request.accumulatedLatencyMs);

    // DB is terminal — mark request as successful (response traversal handles completedAt)
    request.status = RequestStatus.Success;
    context.recordDeparture(event.nodeId, request.id, event.timestamp);

    // Dequeue waiting request if any
    if (state.queuedRequests.length > 0) {
      const nextId = state.queuedRequests.shift()!;
      context.scheduleEvent({
        type: SimEventType.RequestRoute,
        timestamp: event.timestamp + 0.01,
        nodeId: event.nodeId,
        requestId: nextId,
        payload: { fromQueue: true },
      });
    }
  }

  onChaosApplied(chaosType: string, _params: Record<string, unknown>): void {
    if (chaosType === 'DROP_DB') {
      this.isDown = true;
    }
  }

  onChaosReverted(): void {
    this.isDown = false;
  }

  getUtilization(): number {
    if (this.config.connectionPoolSize === 0) return 0;
    return this.activeConnections / this.config.connectionPoolSize;
  }
}
