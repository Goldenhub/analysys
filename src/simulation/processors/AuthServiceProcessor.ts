/**
 * Auth_Service Processor — Requirement 23
 *
 * Identity verification with slot-and-queue admission, verification latency sampling,
 * Local and Introspection modes, and a credential failure test.
 *
 * PRNG draw order: verification latency → token cache test → credential failure test.
 */
import type { AuthServiceConfig } from '@/types/nodes';
import { VerificationMode } from '@/types/nodes';
import type { UtilizationReading } from '@/types/metrics';
import type { NodeProcessor, SimEvent, SimRequest, ProcessorContext } from '../types';
import { SimEventType, RequestStatus, SubRequestPolicy } from '../types';
import { dispatchBranches } from '../subRequests';

export class AuthServiceProcessor implements NodeProcessor {
  private config: AuthServiceConfig;

  // Slot tracking: requestId → { startedAt }
  private slots: Map<string, { startedAt: number }> = new Map();
  // Arrival-order queue of waiting request IDs
  private queue: string[] = [];
  // Track arrival times for queue wait calculation
  private arrivalTimes: Map<string, number> = new Map();

  // Per-window counters
  private windowVerifications = 0;
  private windowCacheHits = 0;
  private windowCacheMisses = 0;
  private windowUnauthenticated = 0;

  constructor(config: AuthServiceConfig) {
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
    this.arrivalTimes.set(request.id, event.timestamp);

    if (this.slots.size < this.config.concurrencyLimit) {
      // Admit immediately
      this.admit(request, event.timestamp, event.nodeId, context);
    } else if (this.queue.length < this.config.queueDepth) {
      // Queue the request
      this.queue.push(request.id);
      state.queuedRequests = [...this.queue];
    } else {
      // Queue full — drop with no verification latency added (R23.8)
      request.status = RequestStatus.Dropped;
      request.completedAt = event.timestamp;
      state.totalDropped++;
      context.recordDeparture(event.nodeId, request.id, event.timestamp);
    }
  }

  /**
   * Called by the engine when a VerificationComplete event fires.
   */
  onVerificationComplete(
    event: SimEvent,
    request: SimRequest,
    context: ProcessorContext,
  ): void {
    this.windowVerifications++;

    if (this.config.verificationMode === VerificationMode.Introspection) {
      const rng = context.getRNG();
      // Draw 2 — token cache hit test (R23.6)
      const hit = rng.next() < this.config.tokenCacheHitRatio;
      if (hit) {
        this.windowCacheHits++;
        // Cache hit — proceed directly to credential test
        this.applyCredentialTest(request, event, context);
      } else {
        this.windowCacheMisses++;
        // Cache miss — dispatch one sub-request for introspection
        const edges = context.getOutgoingEdges(event.nodeId);
        if (edges.length === 0) {
          // No route — terminate NO_ROUTE, release slot (R23.10)
          request.status = RequestStatus.NoRoute;
          request.completedAt = event.timestamp;
          this.releaseSlotAndAdmitNext(request.id, event.nodeId, event.timestamp, context);
          context.recordDeparture(event.nodeId, request.id, event.timestamp);
          return;
        }
        // Dispatch exactly ONE sub-request under AuthIntrospection policy
        // Count as one hop against the parent's maxHops (R23.5)
        request.hopCount++;
        const resolvedEdges = context.resolveTargets(event.nodeId, request);
        if (resolvedEdges.length === 0) {
          request.status = RequestStatus.NoRoute;
          request.completedAt = event.timestamp;
          this.releaseSlotAndAdmitNext(request.id, event.nodeId, event.timestamp, context);
          context.recordDeparture(event.nodeId, request.id, event.timestamp);
          return;
        }
        // Dispatch one branch — slot stays occupied until it settles
        dispatchBranches({
          parent: request,
          dispatchNodeId: event.nodeId,
          edges: [resolvedEdges[0]!],
          policy: SubRequestPolicy.AuthIntrospection,
          timestamp: event.timestamp,
          context,
          requestMap: this.getRequestMap(context),
          getNextRequestId: this.getNextRequestIdFn(context),
        });
        // Parent is suspended — don't proceed to credential test yet
        return;
      }
    } else {
      // Local mode — no downstream call, proceed to credential test
      this.applyCredentialTest(request, event, context);
    }
  }

  /**
   * Called by the engine when a sub-request settles for this parent (introspection result).
   * The engine's handleSubRequestSettled detects that this is an Auth_Service parent
   * and delegates here.
   */
  onSubRequestSettled(
    parent: SimRequest,
    branchSuccess: boolean,
    event: SimEvent,
    context: ProcessorContext,
  ): void {
    if (branchSuccess) {
      // Introspection succeeded — apply credential test (R23.11)
      this.applyCredentialTest(parent, event, context);
    } else {
      // Branch failed — terminate parent as Unauthenticated (R23.11)
      parent.status = RequestStatus.Unauthenticated;
      parent.completedAt = event.timestamp;
      this.windowUnauthenticated++;
      this.releaseSlotAndAdmitNext(parent.id, event.nodeId, event.timestamp, context);
      context.recordDeparture(event.nodeId, parent.id, event.timestamp);
      const state = context.getNodeState(event.nodeId);
      if (state) {
        state.totalProcessed++;
        state.latencySamples.push(parent.accumulatedLatencyMs);
      }
    }
  }

  /**
   * Draw 3 — credential failure test (R23.3).
   * Applied after verification (and after successful introspection settle).
   */
  private applyCredentialTest(
    request: SimRequest,
    event: SimEvent,
    context: ProcessorContext,
  ): void {
    const rng = context.getRNG();
    // Draw 3 — credential failure rate (R23.3)
    if (rng.next() < this.config.credentialFailureRate) {
      // Terminate Unauthenticated
      request.status = RequestStatus.Unauthenticated;
      request.completedAt = event.timestamp;
      this.windowUnauthenticated++;
      this.releaseSlotAndAdmitNext(request.id, event.nodeId, event.timestamp, context);
      context.recordDeparture(event.nodeId, request.id, event.timestamp);
      const state = context.getNodeState(event.nodeId);
      if (state) {
        state.totalProcessed++;
        state.latencySamples.push(request.accumulatedLatencyMs);
      }
    } else {
      // Credential valid — forward downstream
      const edges = context.resolveTargets(event.nodeId, request);
      if (edges.length > 0) {
        context.scheduleEvent({
          type: SimEventType.RequestRoute,
          timestamp: event.timestamp,
          nodeId: edges[0]!.target,
          requestId: request.id,
          payload: { fromNodeId: event.nodeId },
        });
      } else {
        // Terminal — no downstream
        request.status = RequestStatus.Success;
        request.completedAt = event.timestamp;
      }
      this.releaseSlotAndAdmitNext(request.id, event.nodeId, event.timestamp, context);
      context.recordDeparture(event.nodeId, request.id, event.timestamp);
      const state = context.getNodeState(event.nodeId);
      if (state) {
        state.totalProcessed++;
        state.latencySamples.push(request.accumulatedLatencyMs);
      }
    }
  }

  private admit(
    request: SimRequest,
    timestamp: number,
    nodeId: string,
    context: ProcessorContext,
  ): void {
    const arrivalTime = this.arrivalTimes.get(request.id) ?? timestamp;
    const queueWait = timestamp - arrivalTime;
    request.accumulatedLatencyMs += queueWait; // R23.7

    this.slots.set(request.id, { startedAt: timestamp });

    // Draw 1 — verification latency (R23.2)
    const rng = context.getRNG();
    const latency = Math.max(
      0,
      rng.normalPositive(this.config.verificationLatencyMeanMs, this.config.verificationLatencyStdDevMs),
    );
    request.accumulatedLatencyMs += latency;

    // Schedule VerificationComplete
    context.scheduleEvent({
      type: SimEventType.VerificationComplete,
      timestamp: timestamp + latency,
      nodeId,
      requestId: request.id,
      payload: {},
    });
  }

  private releaseSlotAndAdmitNext(
    requestId: string,
    nodeId: string,
    timestamp: number,
    context: ProcessorContext,
  ): void {
    this.slots.delete(requestId);
    this.arrivalTimes.delete(requestId);

    // Admit the longest-waiting queued request (FIFO — front of queue)
    if (this.queue.length > 0) {
      const nextId = this.queue.shift()!;
      const state = context.getNodeState(nodeId);
      if (state) {
        state.queuedRequests = [...this.queue];
      }
      // We need the actual SimRequest — get it via the context
      const nextRequest = this.getRequest(nextId, context);
      if (nextRequest && nextRequest.status === RequestStatus.InFlight) {
        this.admit(nextRequest, timestamp, nodeId, context);
      }
    }
  }

  /**
   * Helper: get the request map from context. The engine provides this via
   * ProcessorContext.getRequestMap().
   */
  private getRequestMap(context: ProcessorContext): Map<string, SimRequest> {
    return context.getRequestMap();
  }

  private getNextRequestIdFn(context: ProcessorContext): () => string {
    return context.getNextRequestId;
  }

  private getRequest(requestId: string, context: ProcessorContext): SimRequest | undefined {
    return context.getRequestMap().get(requestId);
  }

  onChaosApplied(): void {}
  onChaosReverted(): void {}

  onNodeDisabled(_context: ProcessorContext): string[] {
    return []; // Auth service is stateless
  }

  onNodeRestored(_context: ProcessorContext): void {
    // No-op
  }

  resetWindowCounters(): void {
    this.windowVerifications = 0;
    this.windowCacheHits = 0;
    this.windowCacheMisses = 0;
    this.windowUnauthenticated = 0;
  }

  getUtilization(): UtilizationReading {
    if (this.config.concurrencyLimit === 0) {
      return { kind: 'not-applicable', reason: 'concurrencyLimit is zero' };
    }
    const value = this.slots.size / this.config.concurrencyLimit;
    return { kind: 'value', value, idle: value === 0 };
  }
}
