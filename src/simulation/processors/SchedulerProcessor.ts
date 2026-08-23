/**
 * Scheduler Processor — Requirement 28
 *
 * Source node that emits a fixed batch of Jobs at a fixed interval.
 * Drift-freedom from separating the schedule from the fire time:
 *   scheduledTime(n) = startOffsetMs + n * intervalMs   (never adjusted)
 *   fireTime(n) = scheduledTime(n) + uniform[0, min(jitterMs, intervalMs)]
 *
 * Jitter for trigger n+1 drawn when trigger n fires — fixed draw position for reproducibility.
 *
 * PRNG draw order: jitter offset for the NEXT trigger index, drawn when the current fires.
 */
import type { SchedulerConfig } from '@/types/nodes';
import { OverlapPolicy } from '@/types/nodes';
import type { UtilizationReading } from '@/types/metrics';
import type { NodeProcessor, SimEvent, SimRequest, ProcessorContext } from '../types';
import { SimEventType, RequestStatus } from '../types';

export class SchedulerProcessor implements NodeProcessor {
  private config: SchedulerConfig;

  /** Jobs emitted by this node, not yet terminal. */
  private outstanding: Set<string> = new Set();
  /** Deferred trigger indices, ≤ maxDeferredTriggers. */
  private deferred: number[] = [];

  // Per-window counters
  private windowTriggered = 0;
  private windowSkipped = 0;
  private windowJobsEmitted = 0;
  private windowDeferredOverflows = 0;

  // Cumulative counters
  private cumulativeTriggered = 0;
  private cumulativeSkipped = 0;
  private cumulativeJobsEmitted = 0;
  private cumulativeDeferred = 0;

  // Completion state
  private unfinishedJobCount = 0;
  private discardedDeferredCount = 0;
  private completed = false;

  /** Last batch of emitted job IDs — consumed by the engine after each trigger. */
  lastEmittedIds: string[] = [];

  constructor(config: SchedulerConfig) {
    this.config = { ...config };
  }

  /**
   * Schedule the first trigger event.
   * Called by the engine during initialization.
   */
  scheduleFirstTrigger(nodeId: string, context: ProcessorContext): void {
    const rng = context.getRNG();
    const effectiveJitter = Math.min(this.config.jitterMs, this.config.intervalMs);
    const jitterOffset = rng.next() * effectiveJitter;
    const scheduledTime = this.config.startOffsetMs;
    const fireTime = scheduledTime + jitterOffset;

    context.scheduleEvent({
      type: SimEventType.SchedulerTrigger,
      timestamp: fireTime,
      nodeId,
      requestId: '',
      payload: { triggerIndex: 0 },
    });
  }

  /**
   * Called by the engine when a SchedulerTrigger event fires.
   */
  onSchedulerTrigger(event: SimEvent, context: ProcessorContext): void {
    const triggerIdx = event.payload.triggerIndex as number;
    this.lastEmittedIds = [];

    // Schedule the NEXT trigger (draw jitter for n+1 when n fires)
    this.scheduleNextTrigger(event.nodeId, triggerIdx + 1, context);

    // Apply overlap policy
    if (this.outstanding.size === 0) {
      this.lastEmittedIds = this.emit(triggerIdx, event.nodeId, event.timestamp, context);
    } else {
      switch (this.config.overlapPolicy) {
        case OverlapPolicy.Allow:
          this.lastEmittedIds = this.emit(triggerIdx, event.nodeId, event.timestamp, context);
          break;

        case OverlapPolicy.Skip: {
          this.windowSkipped++;
          this.cumulativeSkipped++;
          // Log skipped-trigger event
          const nodeLabel = context.getNodeConfig(event.nodeId)?.label ?? event.nodeId;
          context.scheduleEvent({
            type: SimEventType.RequestDrop,
            timestamp: event.timestamp,
            nodeId: event.nodeId,
            requestId: '',
            payload: { reason: `skipped-trigger at ${nodeLabel}` },
          });
          break;
        }

        case OverlapPolicy.Queue:
          if (this.deferred.length >= this.config.maxDeferredTriggers) {
            // Overflow — count as skipped, log event
            this.windowSkipped++;
            this.cumulativeSkipped++;
            this.windowDeferredOverflows++;
            const label = context.getNodeConfig(event.nodeId)?.label ?? event.nodeId;
            context.scheduleEvent({
              type: SimEventType.RequestDrop,
              timestamp: event.timestamp,
              nodeId: event.nodeId,
              requestId: '',
              payload: {
                reason: `deferred-trigger-overflow at ${label} (fire time: ${event.timestamp})`,
              },
            });
          } else {
            this.deferred.push(triggerIdx);
            this.cumulativeDeferred++;
          }
          break;
      }
    }
  }

  /**
   * Called by the engine when one of this node's emitted Jobs reaches a terminal status.
   */
  onJobTerminal(jobId: string, nodeId: string, timestamp: number, context: ProcessorContext): void {
    this.outstanding.delete(jobId);

    // Under Queue policy: when outstanding becomes empty, emit the earliest deferred entry
    if (this.outstanding.size === 0 && this.deferred.length > 0 && !this.completed) {
      const deferredTriggerIdx = this.deferred.shift()!;
      this.lastEmittedIds = this.emit(deferredTriggerIdx, nodeId, timestamp, context);
    }
  }

  /**
   * On entering Complete — R28.13
   */
  onSimulationComplete(): void {
    this.completed = true;
    this.unfinishedJobCount = this.outstanding.size;
    this.discardedDeferredCount = this.deferred.length;
    this.deferred = []; // Discard remaining deferred entries without emitting
  }

  /**
   * onRequestArrived — Scheduler is a source node, requests are emitted not received.
   * This is a no-op; if somehow a request routes here, record and release.
   */
  onRequestArrived(event: SimEvent, request: SimRequest, context: ProcessorContext): void {
    const state = context.getNodeState(event.nodeId);
    if (!state) return;
    context.recordArrival(event.nodeId, request.id, event.timestamp);
    state.totalProcessed++;
    state.latencySamples.push(0);
    context.recordDeparture(event.nodeId, request.id, event.timestamp);
  }

  /**
   * Emit exactly jobsPerTrigger Jobs at the fire timestamp, routing each along
   * the node's resolved targets, and set emittedByNodeId on every emitted Job.
   * Returns the emitted job IDs for the engine to manage accounting.
   */
  private emit(
    _triggerIdx: number,
    nodeId: string,
    timestamp: number,
    context: ProcessorContext,
  ): string[] {
    this.windowTriggered++;
    this.cumulativeTriggered++;

    const targets = context.resolveTargets(nodeId, {
      id: '',
      originNodeId: nodeId,
      createdAt: timestamp,
      status: RequestStatus.InFlight,
      hopCount: 0,
      maxHops: 20,
      path: [nodeId],
      accumulatedLatencyMs: 0,
      fanOutDepth: 0,
      emittedByNodeId: nodeId,
    });

    const emittedIds: string[] = [];

    for (let i = 0; i < this.config.jobsPerTrigger; i++) {
      const jobId = context.getNextRequestId();

      const job: SimRequest = {
        id: jobId,
        originNodeId: nodeId,
        createdAt: timestamp,
        status: RequestStatus.InFlight,
        hopCount: 0,
        maxHops: 20,
        path: [nodeId],
        accumulatedLatencyMs: 0,
        fanOutDepth: 0,
        emittedByNodeId: nodeId,
      };

      // Register in the engine's request map
      const requestMap = context.getRequestMap();
      requestMap.set(jobId, job);

      this.outstanding.add(jobId);
      this.windowJobsEmitted++;
      this.cumulativeJobsEmitted++;
      emittedIds.push(jobId);

      if (targets.length === 0) {
        // No outgoing edge — terminate NO_ROUTE immediately (R28.8)
        job.status = RequestStatus.NoRoute;
        job.completedAt = timestamp;
      } else {
        // Route to target
        context.scheduleEvent({
          type: SimEventType.RequestRoute,
          timestamp,
          nodeId: targets[0]!.target,
          requestId: jobId,
          payload: { fromNodeId: nodeId },
        });
      }
    }

    return emittedIds;
  }

  /**
   * Schedule the next trigger: scheduledTime(n) = startOffsetMs + n * intervalMs,
   * fireTime(n) = scheduledTime(n) + uniform[0, min(jitterMs, intervalMs)].
   * Jitter drawn now (when trigger n-1 fires).
   */
  private scheduleNextTrigger(
    nodeId: string,
    nextTriggerIdx: number,
    context: ProcessorContext,
  ): void {
    const rng = context.getRNG();
    const effectiveJitter = Math.min(this.config.jitterMs, this.config.intervalMs);
    const jitterOffset = rng.next() * effectiveJitter;
    const scheduledTime = this.config.startOffsetMs + nextTriggerIdx * this.config.intervalMs;
    const fireTime = scheduledTime + jitterOffset;

    context.scheduleEvent({
      type: SimEventType.SchedulerTrigger,
      timestamp: fireTime,
      nodeId,
      requestId: '',
      payload: { triggerIndex: nextTriggerIdx },
    });
  }

  onChaosApplied(): void {}
  onChaosReverted(): void {}

  onNodeDisabled(_context: ProcessorContext): string[] {
    return []; // Scheduler is a source node, not typically disabled
  }

  onNodeRestored(_context: ProcessorContext): void {
    // No-op
  }

  resetWindowCounters(): void {
    this.windowTriggered = 0;
    this.windowSkipped = 0;
    this.windowJobsEmitted = 0;
    this.windowDeferredOverflows = 0;
  }

  getUtilization(): UtilizationReading {
    // Scheduler holds no bounded resource — not applicable (R28.10)
    return { kind: 'not-applicable', reason: 'Scheduler holds no bounded resource' };
  }

  // ─── Metrics accessors (task 391) ─────────────────────────────

  /** Outstanding Jobs count. */
  getOutstandingCount(): number {
    return this.outstanding.size;
  }

  /** Deferred triggers count. */
  getDeferredCount(): number {
    return this.deferred.length;
  }

  /** Unfinished Jobs count (on completion). */
  getUnfinishedJobCount(): number {
    return this.unfinishedJobCount;
  }

  /** Discarded deferred entries count (on completion). */
  getDiscardedDeferredCount(): number {
    return this.discardedDeferredCount;
  }

  /** Triggers fired this window. */
  getWindowTriggered(): number {
    return this.windowTriggered;
  }

  /** Triggers skipped this window. */
  getWindowSkipped(): number {
    return this.windowSkipped;
  }

  /** Jobs emitted this window. */
  getWindowJobsEmitted(): number {
    return this.windowJobsEmitted;
  }

  /** Cumulative triggers. */
  getCumulativeTriggered(): number {
    return this.cumulativeTriggered;
  }

  /** Cumulative Jobs emitted. */
  getCumulativeJobsEmitted(): number {
    return this.cumulativeJobsEmitted;
  }

  /** Cumulative skipped triggers. */
  getCumulativeSkipped(): number {
    return this.cumulativeSkipped;
  }

  /** Cumulative deferred triggers. */
  getCumulativeDeferred(): number {
    return this.cumulativeDeferred;
  }

  /** Check if this is a source node. */
  isSource(): boolean {
    return true;
  }
}
