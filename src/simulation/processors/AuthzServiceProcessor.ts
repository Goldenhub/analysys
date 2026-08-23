/**
 * Authz_Service Processor — Requirement 24
 *
 * Policy evaluation with slot-and-queue admission, policy latency sampling,
 * policy cache, lookup dispatches (SubRequestPolicy.AuthzLookup), and deny test.
 *
 * PRNG draw order: policy latency → policy cache test → deny test.
 * The routing draw (Weighted) comes AFTER all of these.
 */
import type { AuthzServiceConfig } from '@/types/nodes';
import type { UtilizationReading } from '@/types/metrics';
import type { NodeProcessor, SimEvent, SimRequest, ProcessorContext } from '../types';
import { SimEventType, RequestStatus, SubRequestPolicy } from '../types';
import { dispatchBranches } from '../subRequests';

export class AuthzServiceProcessor implements NodeProcessor {
  private config: AuthzServiceConfig;

  // Slot tracking: requestId → { startedAt }
  private slots: Map<string, { startedAt: number }> = new Map();
  // Arrival-order queue of waiting request IDs
  private queue: string[] = [];
  // Track arrival times for queue wait calculation
  private arrivalTimes: Map<string, number> = new Map();

  // Per-window counters
  private windowRequestsAdmitted = 0;
  private windowLookupCallsIssued = 0;
  private windowCacheHits = 0;
  private windowCacheMisses = 0;
  private windowLookupUnavailable = 0;
  private windowDenied = 0;

  constructor(config: AuthzServiceConfig) {
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
      this.admit(request, event.timestamp, event.nodeId, context);
    } else if (this.queue.length < this.config.queueDepth) {
      this.queue.push(request.id);
      state.queuedRequests = [...this.queue];
    } else {
      // Queue full — drop
      request.status = RequestStatus.Dropped;
      request.completedAt = event.timestamp;
      state.totalDropped++;
      context.recordDeparture(event.nodeId, request.id, event.timestamp);
    }
  }

  /**
   * Called by the engine when a PolicyEvaluated event fires.
   */
  onPolicyEvaluated(
    event: SimEvent,
    request: SimRequest,
    context: ProcessorContext,
  ): void {
    const rng = context.getRNG();

    // Draw 2 — policy cache hit test
    const hit = rng.next() < this.config.policyCacheHitRatio;
    if (hit) {
      this.windowCacheHits++;
      // Cache hit — apply deny test directly
      this.applyDenyTest(request, event, context);
    } else {
      this.windowCacheMisses++;
      // Cache miss — check for outgoing edges
      const edges = context.getOutgoingEdges(event.nodeId);
      if (edges.length === 0) {
        // No outgoing edge — record as lookup-unavailable evaluation (R24.5)
        this.windowLookupUnavailable++;
        // Apply deny test (no lookups available, treated as if lookups settled)
        this.applyDenyTest(request, event, context);
      } else {
        // Dispatch exactly lookupsPerRequest sub-requests at one simulated timestamp
        // Each target selected by the node's routing policy
        const resolvedEdges: import('@/types/edges').EdgeData[] = [];
        for (let i = 0; i < this.config.lookupsPerRequest; i++) {
          const targets = context.resolveTargets(event.nodeId, request);
          if (targets.length > 0) {
            resolvedEdges.push(targets[0]!);
          }
        }
        if (resolvedEdges.length === 0) {
          // Could not resolve any targets
          this.windowLookupUnavailable++;
          this.applyDenyTest(request, event, context);
          return;
        }
        this.windowLookupCallsIssued += resolvedEdges.length;
        // Dispatch branches under AuthzLookup policy
        dispatchBranches({
          parent: request,
          dispatchNodeId: event.nodeId,
          edges: resolvedEdges,
          policy: SubRequestPolicy.AuthzLookup,
          timestamp: event.timestamp,
          context,
          requestMap: this.getRequestMap(context),
          getNextRequestId: this.getNextRequestIdFn(context),
        });
        // Parent is suspended until all lookups settle
        return;
      }
    }
  }

  /**
   * Called by the engine when all sub-request lookups settle for this parent.
   */
  onSubRequestSettled(
    parent: SimRequest,
    branchSuccess: boolean,
    failedBranchStatus: RequestStatus | undefined,
    event: SimEvent,
    context: ProcessorContext,
  ): void {
    if (branchSuccess) {
      // All lookups settled successfully — apply deny test (R24.6)
      this.applyDenyTest(parent, event, context);
    } else {
      // A lookup failed — propagate that lookup's terminal status to the parent (R24.7)
      const terminalStatus = failedBranchStatus ?? RequestStatus.Dropped;
      parent.status = terminalStatus;
      parent.completedAt = event.timestamp;
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
   * Draw 3 — deny test (R24.6). Applied only after all lookups have settled successfully.
   */
  private applyDenyTest(
    request: SimRequest,
    event: SimEvent,
    context: ProcessorContext,
  ): void {
    const rng = context.getRNG();
    // Draw 3 — deny rate
    if (rng.next() < this.config.denyRate) {
      // Terminate Forbidden (R24.6)
      request.status = RequestStatus.Forbidden;
      request.completedAt = event.timestamp;
      this.windowDenied++;
      this.releaseSlotAndAdmitNext(request.id, event.nodeId, event.timestamp, context);
      context.recordDeparture(event.nodeId, request.id, event.timestamp);
      const state = context.getNodeState(event.nodeId);
      if (state) {
        state.totalProcessed++;
        state.latencySamples.push(request.accumulatedLatencyMs);
      }
    } else {
      // Allowed — forward downstream
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
    request.accumulatedLatencyMs += queueWait;

    this.slots.set(request.id, { startedAt: timestamp });
    this.windowRequestsAdmitted++;

    // Draw 1 — policy evaluation latency, clamped at 0 ms
    const rng = context.getRNG();
    const latency = Math.max(
      0,
      rng.normalPositive(this.config.policyLatencyMeanMs, this.config.policyLatencyStdDevMs),
    );
    request.accumulatedLatencyMs += latency;

    // Schedule PolicyEvaluated
    context.scheduleEvent({
      type: SimEventType.PolicyEvaluated,
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

    if (this.queue.length > 0) {
      const nextId = this.queue.shift()!;
      const state = context.getNodeState(nodeId);
      if (state) {
        state.queuedRequests = [...this.queue];
      }
      const nextRequest = this.getRequest(nextId, context);
      if (nextRequest && nextRequest.status === RequestStatus.InFlight) {
        this.admit(nextRequest, timestamp, nodeId, context);
      }
    }
  }

  private getRequestMap(context: ProcessorContext): Map<string, SimRequest> {
    return context.getRequestMap();
  }

  private getNextRequestIdFn(context: ProcessorContext): () => string {
    return context.getNextRequestId;
  }

  private getRequest(requestId: string, context: ProcessorContext): SimRequest | undefined {
    return context.getRequestMap().get(requestId);
  }

  /**
   * Per-window amplification ratio: lookup calls issued / requests admitted.
   * Reported as not-applicable when no request was admitted (R24.10).
   */
  getAmplificationRatio(): { kind: 'value'; value: number } | { kind: 'not-applicable'; reason: string } {
    if (this.windowRequestsAdmitted === 0) {
      return { kind: 'not-applicable', reason: 'no requests admitted this window' };
    }
    return { kind: 'value', value: this.windowLookupCallsIssued / this.windowRequestsAdmitted };
  }

  onChaosApplied(): void {}
  onChaosReverted(): void {}

  onNodeDisabled(_context: ProcessorContext): string[] {
    return []; // Authz service is stateless
  }

  onNodeRestored(_context: ProcessorContext): void {
    // No-op
  }

  resetWindowCounters(): void {
    this.windowRequestsAdmitted = 0;
    this.windowLookupCallsIssued = 0;
    this.windowCacheHits = 0;
    this.windowCacheMisses = 0;
    this.windowLookupUnavailable = 0;
    this.windowDenied = 0;
  }

  getUtilization(): UtilizationReading {
    if (this.config.concurrencyLimit === 0) {
      return { kind: 'not-applicable', reason: 'concurrencyLimit is zero' };
    }
    const value = this.slots.size / this.config.concurrencyLimit;
    return { kind: 'value', value, idle: value === 0 };
  }
}
