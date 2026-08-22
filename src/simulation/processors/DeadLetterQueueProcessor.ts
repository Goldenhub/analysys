/**
 * Dead_Letter_Queue Processor — Requirement 26
 *
 * Retains Jobs that have exhausted their retry budget for inspection or Redrive.
 * `retained` is append-ordered (ascending retentionStartMs); overflow discards
 * index 0 (R26.4) and redrive selects a prefix in ascending retention order (R26.6).
 *
 * Expiry in `onMetricsWindowBoundary`, called from `handleMetricsSnapshot` before
 * the per-window counter reset, so a message cannot expire unobserved on access.
 *
 * PRNG draw order: none. DLQ consumes no randomness.
 */
import type { DeadLetterQueueConfig } from '@/types/nodes';
import { RedriveMode } from '@/types/nodes';
import type { UtilizationReading } from '@/types/metrics';
import type { NodeProcessor, SimEvent, SimRequest, ProcessorContext } from '../types';
import { SimEventType, RequestStatus } from '../types';

/** A message retained in the Dead_Letter_Queue. */
export interface RetainedMessage {
  jobId: string;
  retentionStartMs: number;
  exhaustedAtNodeId: string;
  attemptCount: number;
  redriveAttempts: number;
}

export class DeadLetterQueueProcessor implements NodeProcessor {
  private config: DeadLetterQueueConfig;

  /** Append-ordered (ascending retentionStartMs). */
  private retained: RetainedMessage[] = [];

  // Per-window counters
  private windowArrivals = 0;
  private windowOverflowDiscards = 0;
  private windowExpiryDiscards = 0;
  private windowRedrives = 0;

  // Cumulative counters
  private cumulativeRedrives = 0;
  private cumulativeOverflowDiscards = 0;
  private cumulativeExpiryDiscards = 0;

  // Auto-redrive scheduling
  private nextRedriveScheduled = false;

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

    // Extract metadata from the routing payload
    const attemptCount = (event.payload.attemptCount as number) ?? 0;
    const exhaustedAtNodeId = (event.payload.exhaustedAtNodeId as string) ?? event.nodeId;
    const redriveAttempts = (event.payload.redriveAttempts as number) ?? 0;

    // Check if this is a re-retention (R26.13): same Job returning after a failed redrive
    const existingIdx = this.retained.findIndex((m) => m.jobId === request.id);
    if (existingIdx >= 0) {
      // Re-retention: fresh retentionStartMs, carry forward redriveAttempts
      this.retained.splice(existingIdx, 1);
    }

    // Handle overflow: discard index 0 (earliest retentionStartMs) before inserting
    if (this.retained.length >= this.config.capacity) {
      const discarded = this.retained.shift()!;
      this.windowOverflowDiscards++;
      this.cumulativeOverflowDiscards++;

      // Log overflow event
      const nodeLabel = context.getNodeConfig(event.nodeId)?.label ?? event.nodeId;
      context.scheduleEvent({
        type: SimEventType.RequestDrop,
        timestamp: event.timestamp,
        nodeId: event.nodeId,
        requestId: discarded.jobId,
        payload: { reason: `dead-letter-overflow at ${nodeLabel}` },
      });
    }

    // Retain this message in append order
    const msg: RetainedMessage = {
      jobId: request.id,
      retentionStartMs: event.timestamp,
      exhaustedAtNodeId,
      attemptCount,
      redriveAttempts,
    };
    this.retained.push(msg);

    // Terminal status: Dead_Lettered
    request.status = RequestStatus.DeadLettered;
    request.completedAt = event.timestamp;

    // Error accounting
    state.totalProcessed++;
    state.latencySamples.push(request.accumulatedLatencyMs);
    this.windowArrivals++;

    context.recordDeparture(event.nodeId, request.id, event.timestamp);

    // Schedule auto-redrive if in Automatic mode and not already scheduled
    if (this.config.redriveMode === RedriveMode.Automatic && !this.nextRedriveScheduled) {
      this.scheduleNextRedrive(event.nodeId, event.timestamp, context);
    }
  }

  /**
   * R26.5 — retention expiry evaluated in onMetricsWindowBoundary,
   * called from handleMetricsSnapshot BEFORE per-window counter reset.
   */
  onMetricsWindowBoundary(context: ProcessorContext): void {
    const now = context.currentTime();
    const expired: RetainedMessage[] = [];

    // Find all messages whose retention has expired
    let i = 0;
    while (i < this.retained.length) {
      const msg = this.retained[i]!;
      if (now - msg.retentionStartMs >= this.config.retentionPeriodMs) {
        expired.push(msg);
        this.retained.splice(i, 1);
        // don't increment i — the array shifted
      } else {
        i++;
      }
    }

    // Count expired messages
    this.windowExpiryDiscards += expired.length;
    this.cumulativeExpiryDiscards += expired.length;
  }

  /**
   * Automatic redrive on the redrive interval (R26.6).
   * Called from the engine's DlqRedrive event handler.
   */
  onDlqRedrive(
    event: SimEvent,
    context: ProcessorContext,
  ): void {
    this.nextRedriveScheduled = false;
    this.performRedrive(event.nodeId, event.timestamp, context);

    // Schedule next auto-redrive if there are still retained messages
    if (this.config.redriveMode === RedriveMode.Automatic && this.retained.length > 0) {
      this.scheduleNextRedrive(event.nodeId, event.timestamp, context);
    }
  }

  /**
   * Manual redrive from Chaos_Panel control (R26.8).
   * Triggered via onChaosApplied with chaosType 'DLQ_REDRIVE'.
   */
  onChaosApplied(chaosType: string, params: Record<string, unknown>): void {
    // Manual redrive is handled via a chaos event that schedules a DlqRedrive
    // The engine will invoke onDlqRedrive when the event fires.
    void chaosType;
    void params;
  }

  /**
   * Trigger a manual redrive (called by the engine when DLQ_REDRIVE chaos is applied).
   */
  triggerManualRedrive(nodeId: string, timestamp: number, context: ProcessorContext): void {
    this.performRedrive(nodeId, timestamp, context);
  }

  onChaosReverted(): void {}

  /**
   * Perform the actual redrive: route up to redriveBatchSize retained messages
   * whose redriveAttempts < maxRedriveAttempts in ascending retention start order.
   */
  private performRedrive(
    nodeId: string,
    timestamp: number,
    context: ProcessorContext,
  ): void {
    const targets = context.resolveTargets(nodeId, {
      id: '',
      originNodeId: '',
      createdAt: 0,
      status: RequestStatus.InFlight,
      hopCount: 0,
      maxHops: 20,
      path: [nodeId],
      accumulatedLatencyMs: 0,
      fanOutDepth: 0,
      emittedByNodeId: nodeId,
    });

    if (targets.length === 0) return;

    let redriveCount = 0;
    const toRemove: number[] = [];

    for (let i = 0; i < this.retained.length && redriveCount < this.config.redriveBatchSize; i++) {
      const msg = this.retained[i]!;
      if (msg.redriveAttempts >= this.config.maxRedriveAttempts) continue;

      toRemove.push(i);
      redriveCount++;

      // Increment redrive attempts
      msg.redriveAttempts++;

      // Get the actual request from the engine's request map
      const requestMap = context.getRequestMap();
      const request = requestMap.get(msg.jobId);
      if (!request) continue;

      // R26.11: clear Dead_Lettered status, return to InFlight
      request.status = RequestStatus.InFlight;
      request.completedAt = undefined;

      // Decrement cumulative Dead_Lettered count on this node
      const state = context.getNodeState(nodeId);
      if (state) {
        if (state.cumulativeTerminalCounts[RequestStatus.DeadLettered] > 0) {
          state.cumulativeTerminalCounts[RequestStatus.DeadLettered]--;
        }
        if (state.terminalCounts[RequestStatus.DeadLettered] > 0) {
          state.terminalCounts[RequestStatus.DeadLettered]--;
        }
      }

      // R26.11: call engine.unmarkRequestDone to return the Job to InFlight
      context.unmarkRequestDone(msg.jobId);

      // Route the Job to the target node
      context.scheduleEvent({
        type: SimEventType.RequestRoute,
        timestamp,
        nodeId: targets[0]!.target,
        requestId: msg.jobId,
        payload: {
          fromNodeId: nodeId,
          isRedrive: true,
          redriveAttempts: msg.redriveAttempts,
          attemptCount: msg.attemptCount,
        },
      });

      this.windowRedrives++;
      this.cumulativeRedrives++;
    }

    // Remove redriven messages from retained (in reverse to preserve indices)
    for (let i = toRemove.length - 1; i >= 0; i--) {
      this.retained.splice(toRemove[i]!, 1);
    }
  }

  private scheduleNextRedrive(
    nodeId: string,
    timestamp: number,
    context: ProcessorContext,
  ): void {
    this.nextRedriveScheduled = true;
    context.scheduleEvent({
      type: SimEventType.DlqRedrive,
      timestamp: timestamp + this.config.redriveIntervalMs,
      nodeId,
      requestId: '',
      payload: {},
    });
  }

  resetWindowCounters(): void {
    this.windowArrivals = 0;
    this.windowOverflowDiscards = 0;
    this.windowExpiryDiscards = 0;
    this.windowRedrives = 0;
  }

  getUtilization(): UtilizationReading {
    if (this.config.capacity === 0) {
      return { kind: 'not-applicable', reason: 'capacity is zero' };
    }
    const value = this.retained.length / this.config.capacity;
    return { kind: 'value', value, idle: value === 0 };
  }

  // ─── Metrics accessors (task 377) ─────────────────────────────

  /** Current retained count. */
  getRetainedCount(): number {
    return this.retained.length;
  }

  /** Fill fraction: retained / capacity. */
  getFillFraction(): number {
    if (this.config.capacity === 0) return 0;
    return this.retained.length / this.config.capacity;
  }

  /** Dead-letter arrival rate (per window). */
  getArrivalRate(): number {
    return this.windowArrivals;
  }

  /** Oldest message age in ms. */
  getOldestMessageAge(currentTime: number): number {
    if (this.retained.length === 0) return 0;
    return currentTime - this.retained[0]!.retentionStartMs;
  }

  /** Retained count grouped by exhaustedAtNodeId. */
  getRetainedByUpstream(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const msg of this.retained) {
      counts[msg.exhaustedAtNodeId] = (counts[msg.exhaustedAtNodeId] ?? 0) + 1;
    }
    return counts;
  }

  /** Cumulative redrives. */
  getCumulativeRedrives(): number {
    return this.cumulativeRedrives;
  }

  /** Cumulative discards by overflow. */
  getCumulativeOverflowDiscards(): number {
    return this.cumulativeOverflowDiscards;
  }

  /** Cumulative discards by expiry. */
  getCumulativeExpiryDiscards(): number {
    return this.cumulativeExpiryDiscards;
  }

  /** Per-window redrives. */
  getWindowRedrives(): number {
    return this.windowRedrives;
  }
}
