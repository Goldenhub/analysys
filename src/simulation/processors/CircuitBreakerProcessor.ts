import type { CircuitBreakerConfig } from '@/types/nodes';
import { CircuitState } from '@/types/nodes';
import type { NodeProcessor, SimEvent, SimRequest, ProcessorContext } from '../types';
import { SimEventType, RequestStatus } from '../types';

/**
 * Circuit breaker guarding a downstream dependency. Observes the downstream
 * node's per-window error counters and fast-fails requests once the observed
 * error rate crosses the configured threshold, giving the dependency room to
 * recover instead of piling load onto it.
 */
export class CircuitBreakerProcessor implements NodeProcessor {
  private config: CircuitBreakerConfig;
  private circuitState: CircuitState = CircuitState.Closed;
  private openedAt = 0;
  private probesSent = 0;

  /** Forwarding overhead — the breaker only inspects state, it does no work. */
  private static readonly FORWARD_LATENCY_MS = 0.2;

  /** Minimum downstream samples required before the error rate is trustworthy. */
  private static readonly MIN_OBSERVATIONS = 10;

  constructor(config: CircuitBreakerConfig) {
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

    // Open → HalfOpen transition is checked on arrival rather than via a
    // scheduled event: with no traffic there is nothing to protect.
    if (
      this.circuitState === CircuitState.Open &&
      context.currentTime() - this.openedAt >= this.config.openDurationMs
    ) {
      this.circuitState = CircuitState.HalfOpen;
      this.probesSent = 0;
    }

    switch (this.circuitState) {
      case CircuitState.Open:
        this.fastFail(event, request, context, state);
        return;

      case CircuitState.HalfOpen: {
        if (this.probesSent < this.config.probeCount) {
          this.probesSent++;
          this.forward(event, request, context, state);
          return;
        }
        const rate = this.downstreamErrorRate(event.nodeId, context);
        if (rate === null) {
          // Not enough data to judge recovery — hold half-open and keep probing.
          this.forward(event, request, context, state);
          return;
        }
        if (rate > this.config.errorThreshold) {
          this.trip(context);
          this.fastFail(event, request, context, state);
          return;
        }
        this.circuitState = CircuitState.Closed;
        this.forward(event, request, context, state);
        return;
      }

      case CircuitState.Closed: {
        const rate = this.downstreamErrorRate(event.nodeId, context);
        if (rate !== null && rate > this.config.errorThreshold) {
          this.trip(context);
          this.fastFail(event, request, context, state);
          return;
        }
        this.forward(event, request, context, state);
        return;
      }
    }
  }

  /**
   * Downstream error rate, or null when there is not yet enough data to judge.
   * Per-window counter resets mean `total` is briefly 0 at each window boundary;
   * acting on that would make the breaker flap.
   */
  private downstreamErrorRate(nodeId: string, context: ProcessorContext): number | null {
    const target = context.getOutgoingEdges(nodeId)[0];
    if (!target) return null;
    const ds = context.getNodeState(target.target);
    if (!ds) return null;
    const total = ds.totalProcessed + ds.totalDropped + ds.totalTimedOut;
    if (total < CircuitBreakerProcessor.MIN_OBSERVATIONS) return null;
    return (ds.totalDropped + ds.totalTimedOut) / total;
  }

  private trip(context: ProcessorContext): void {
    this.circuitState = CircuitState.Open;
    this.openedAt = context.currentTime();
    this.probesSent = 0;
  }

  private fastFail(
    event: SimEvent,
    request: SimRequest,
    context: ProcessorContext,
    state: { totalDropped: number },
  ): void {
    request.status = RequestStatus.Dropped;
    request.completedAt = event.timestamp;
    state.totalDropped++;
    context.recordDeparture(event.nodeId, request.id, event.timestamp);
  }

  private forward(
    event: SimEvent,
    request: SimRequest,
    context: ProcessorContext,
    state: { totalProcessed: number; totalDropped: number; latencySamples: number[] },
  ): void {
    const latency = CircuitBreakerProcessor.FORWARD_LATENCY_MS;
    const edges = context.getOutgoingEdges(event.nodeId);

    if (edges.length === 0) {
      request.status = RequestStatus.Dropped;
      request.completedAt = event.timestamp;
      state.totalDropped++;
      context.recordDeparture(event.nodeId, request.id, event.timestamp);
      return;
    }

    request.accumulatedLatencyMs += latency;
    state.totalProcessed++;
    state.latencySamples.push(latency);

    context.scheduleEvent({
      type: SimEventType.RequestRoute,
      timestamp: event.timestamp + latency,
      nodeId: edges[0]!.target,
      requestId: request.id,
      payload: { fromNodeId: event.nodeId },
    });
    context.recordDeparture(event.nodeId, request.id, event.timestamp + latency);
  }

  /** Exposed for tests and assertions on the state machine. */
  getCircuitState(): CircuitState {
    return this.circuitState;
  }

  onChaosApplied(_chaosType: string, _params: Record<string, unknown>): void {
    // Deliberately inert: the breaker must react to downstream failure
    // organically, which is the whole point of pairing it with DROP_DB.
  }

  onChaosReverted(): void {
    // See onChaosApplied.
  }

  getUtilization(): number {
    switch (this.circuitState) {
      case CircuitState.Closed:
        return 0;
      case CircuitState.HalfOpen:
        return 0.5;
      case CircuitState.Open:
        return 1;
    }
  }
}
