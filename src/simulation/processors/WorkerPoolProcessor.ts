/**
 * Worker_Pool Processor — Requirement 25
 *
 * Fixed-concurrency job consumer with retry policy, prefetch buffer, and epoch-based
 * timeout invalidation.
 *
 * PRNG draw order per attempt: processing time → failure test.
 * The routing draw (Weighted) comes AFTER all of these.
 *
 * Three disjoint Job populations:
 * - executing: currently occupying a concurrency slot
 * - prefetch: FIFO buffer awaiting a free slot
 * - retryWaiting: failed Jobs awaiting their backoff delay
 */
import type { WorkerPoolConfig } from '@/types/nodes';
import { RetryBackoff, NodeType } from '@/types/nodes';
import type { UtilizationReading } from '@/types/metrics';
import type { NodeProcessor, SimEvent, SimRequest, ProcessorContext } from '../types';
import { SimEventType, RequestStatus } from '../types';

/** BackpressureAwareConsumer interface — implemented by consumers that accept from upstream MQ. */
export interface BackpressureAwareConsumer {
  /** How many items the consumer will accept right now. 0 means stop consuming. */
  admissionCapacity(): number;
}

/** Type guard for BackpressureAwareConsumer. */
export function isBackpressureAware(
  processor: unknown,
): processor is BackpressureAwareConsumer {
  return (
    processor != null &&
    typeof processor === 'object' &&
    'admissionCapacity' in processor &&
    typeof (processor as BackpressureAwareConsumer).admissionCapacity === 'function'
  );
}

interface ExecutingEntry {
  attemptNo: number;
  startedAt: number;
  epoch: number;
}

interface RetryWaitingEntry {
  jobId: string;
  readyAt: number;
  attemptNo: number;
}

export class WorkerPoolProcessor implements NodeProcessor, BackpressureAwareConsumer {
  private config: WorkerPoolConfig;

  // Three disjoint populations
  private executing: Map<string, ExecutingEntry> = new Map();
  private prefetch: string[] = []; // FIFO, ≤ prefetchBufferDepth
  private retryWaiting: RetryWaitingEntry[] = []; // sorted by readyAt

  // Epoch map: requestId → current epoch (invalidates stale timeout events)
  private epochMap: Map<string, number> = new Map();
  // Attempts map: requestId → total attempts
  private attempts: Map<string, number> = new Map();
  // Enqueue times for backlog age
  private enqueueTimes: Map<string, number> = new Map();

  // Per-window counters
  private windowJobsCompleted = 0;
  private windowJobsAdmitted = 0;
  private windowRetries = 0;
  private windowRetryExhausted = 0;
  private windowArrivalCount = 0;

  constructor(config: WorkerPoolConfig) {
    this.config = { ...config };
  }

  /**
   * BackpressureAwareConsumer implementation:
   * Room left across executing and prefetch.
   */
  admissionCapacity(): number {
    const executingRoom = this.config.concurrency - this.executing.size;
    const prefetchRoom = this.config.prefetchBufferDepth - this.prefetch.length;
    return Math.max(0, executingRoom + prefetchRoom);
  }

  onRequestArrived(
    event: SimEvent,
    request: SimRequest,
    context: ProcessorContext,
  ): void {
    const state = context.getNodeState(event.nodeId);
    if (!state) return;

    context.recordArrival(event.nodeId, request.id, event.timestamp);
    this.windowArrivalCount++;

    // R26.12: if this is a redriven Job, reset the attempt counter to zero
    if (event.payload.isRedrive) {
      this.attempts.set(request.id, 0);
      this.epochMap.set(request.id, 0);
    }

    // Initialize attempt tracking for new Jobs
    if (!this.attempts.has(request.id)) {
      this.attempts.set(request.id, 0);
      this.epochMap.set(request.id, 0);
    }

    // Record enqueue time for backlog age
    this.enqueueTimes.set(request.id, event.timestamp);

    // Try to admit directly if there's concurrency room
    if (this.executing.size < this.config.concurrency) {
      this.admitJob(request.id, event.nodeId, event.timestamp, context);
    } else if (this.prefetch.length < this.config.prefetchBufferDepth) {
      // Buffer in prefetch
      this.prefetch.push(request.id);
      state.queuedRequests = [...this.prefetch];
    } else {
      // No room — drop
      request.status = RequestStatus.Dropped;
      request.completedAt = event.timestamp;
      state.totalDropped++;
      context.recordDeparture(event.nodeId, request.id, event.timestamp);
    }
  }

  /**
   * Called by the engine when a JobAdmit event fires.
   * Used to admit retry-waiting and prefetch Jobs when concurrency frees up.
   */
  onJobAdmit(
    event: SimEvent,
    context: ProcessorContext,
  ): void {
    this.tryAdmitNext(event.nodeId, event.timestamp, context);
  }

  /**
   * Called by the engine when a JobAttemptComplete event fires.
   */
  onJobAttemptComplete(
    event: SimEvent,
    context: ProcessorContext,
  ): void {
    const requestId = event.requestId;
    const eventEpoch = event.payload.epoch as number;

    // Epoch check — discard stale events
    const currentEpoch = this.epochMap.get(requestId) ?? 0;
    if (eventEpoch !== currentEpoch) return; // Stale — timeout already fired

    // Increment epoch to invalidate the corresponding timeout
    this.epochMap.set(requestId, currentEpoch + 1);

    const state = context.getNodeState(event.nodeId);
    if (!state) return;

    // Draw failure test
    const rng = context.getRNG();
    const failed = rng.next() < this.config.jobFailureRate;

    if (failed) {
      const attemptCount = this.attempts.get(requestId) ?? 1;
      if (attemptCount < this.config.maxRetries + 1) {
        // Retry — release slot FIRST, then schedule retry (R25.16)
        this.executing.delete(requestId);
        state.activeConnections = this.executing.size;
        this.windowRetries++;

        // Compute backoff delay
        const delay = this.computeBackoffDelay(attemptCount);

        // Schedule JobRetryReady
        this.retryWaiting.push({
          jobId: requestId,
          readyAt: event.timestamp + delay,
          attemptNo: attemptCount + 1,
        });
        // Keep sorted by readyAt
        this.retryWaiting.sort((a, b) => a.readyAt - b.readyAt);

        context.scheduleEvent({
          type: SimEventType.JobRetryReady,
          timestamp: event.timestamp + delay,
          nodeId: event.nodeId,
          requestId,
          payload: { attemptNo: attemptCount + 1 },
        });

        // Try to admit next from prefetch/retry
        this.tryAdmitNext(event.nodeId, event.timestamp, context);
      } else {
        // Retry exhausted — release slot
        this.executing.delete(requestId);
        state.activeConnections = this.executing.size;
        this.windowRetryExhausted++;

        const request = this.getRequest(requestId, context);
        if (request) {
          // Route to Dead_Letter_Queue if edge exists (R25.8-R25.9)
          const edges = context.getOutgoingEdges(event.nodeId);
          const dlqEdge = edges.find((e) => {
            const targetConfig = context.getNodeConfig(e.target);
            return targetConfig?.nodeType === NodeType.DeadLetterQueue;
          });

          if (dlqEdge) {
            context.scheduleEvent({
              type: SimEventType.RequestRoute,
              timestamp: event.timestamp,
              nodeId: dlqEdge.target,
              requestId,
              payload: {
                fromNodeId: event.nodeId,
                attemptCount,
                exhaustedAtNodeId: event.nodeId,
              },
            });
          } else {
            // No DLQ — terminate RetryExhausted
            request.status = RequestStatus.RetryExhausted;
            request.completedAt = event.timestamp;
          }
          context.recordDeparture(event.nodeId, requestId, event.timestamp);
          state.totalProcessed++;
          state.latencySamples.push(request.accumulatedLatencyMs);
        }

        this.cleanupJob(requestId);
        this.tryAdmitNext(event.nodeId, event.timestamp, context);
      }
    } else {
      // Success — release slot
      this.executing.delete(requestId);
      state.activeConnections = this.executing.size;
      this.windowJobsCompleted++;

      const request = this.getRequest(requestId, context);
      if (request) {
        // Route downstream (excluding DLQ edges)
        const edges = context.getOutgoingEdges(event.nodeId);
        const nonDlqEdges = edges.filter((e) => {
          const targetConfig = context.getNodeConfig(e.target);
          return targetConfig?.nodeType !== NodeType.DeadLetterQueue;
        });

        if (nonDlqEdges.length > 0) {
          const resolved = context.resolveTargets(event.nodeId, request);
          const nonDlqResolved = resolved.filter((e) => {
            const targetConfig = context.getNodeConfig(e.target);
            return targetConfig?.nodeType !== NodeType.DeadLetterQueue;
          });
          if (nonDlqResolved.length > 0) {
            request.status = RequestStatus.Success;
            request.completedAt = event.timestamp;
            context.scheduleEvent({
              type: SimEventType.RequestRoute,
              timestamp: event.timestamp,
              nodeId: nonDlqResolved[0]!.target,
              requestId,
              payload: { fromNodeId: event.nodeId },
            });
          } else {
            // Terminal success
            request.status = RequestStatus.Success;
            request.completedAt = event.timestamp;
          }
        } else {
          // Terminal success — no downstream
          request.status = RequestStatus.Success;
          request.completedAt = event.timestamp;
        }
        context.recordDeparture(event.nodeId, requestId, event.timestamp);
        state.totalProcessed++;
        state.latencySamples.push(request.accumulatedLatencyMs);
      }

      this.cleanupJob(requestId);
      this.tryAdmitNext(event.nodeId, event.timestamp, context);
    }
  }

  /**
   * Called by the engine when a JobTimeout event fires.
   */
  onJobTimeout(
    event: SimEvent,
    context: ProcessorContext,
  ): void {
    const requestId = event.requestId;
    const eventEpoch = event.payload.epoch as number;

    // Epoch check — discard stale events
    const currentEpoch = this.epochMap.get(requestId) ?? 0;
    if (eventEpoch !== currentEpoch) return; // Stale — attempt already completed

    // Increment epoch to invalidate the corresponding attempt complete
    this.epochMap.set(requestId, currentEpoch + 1);

    const state = context.getNodeState(event.nodeId);
    if (!state) return;

    // Timeout — release slot
    this.executing.delete(requestId);
    state.activeConnections = this.executing.size;
    state.totalTimedOut++;

    const request = this.getRequest(requestId, context);
    if (request) {
      request.status = RequestStatus.Timeout;
      request.completedAt = event.timestamp;
      context.recordDeparture(event.nodeId, requestId, event.timestamp);
      state.totalProcessed++;
      state.latencySamples.push(request.accumulatedLatencyMs);
    }

    this.cleanupJob(requestId);
    this.tryAdmitNext(event.nodeId, event.timestamp, context);
  }

  /**
   * Called by the engine when a JobRetryReady event fires (backoff has elapsed).
   */
  onJobRetryReady(
    event: SimEvent,
    context: ProcessorContext,
  ): void {
    const requestId = event.requestId;

    // Remove from retryWaiting
    const idx = this.retryWaiting.findIndex((r) => r.jobId === requestId);
    if (idx >= 0) {
      this.retryWaiting.splice(idx, 1);
    }

    // Add elapsed retry delay to accumulated latency (R25.15)
    const request = this.getRequest(requestId, context);
    if (request) {
      // The retry delay is the time from when it was placed in retryWaiting to now
      // This was already computed via the event scheduling, just record it
      const delay = this.computeBackoffDelay((this.attempts.get(requestId) ?? 1) - 1);
      request.accumulatedLatencyMs += delay;
    }

    // Try to admit if there's room
    if (this.executing.size < this.config.concurrency) {
      this.admitJob(requestId, event.nodeId, event.timestamp, context);
    } else {
      // No room — put at front of prefetch (retry-ready takes priority)
      this.prefetch.unshift(requestId);
      const state = context.getNodeState(event.nodeId);
      if (state) {
        state.queuedRequests = [...this.prefetch];
      }
    }
  }

  /**
   * Try to admit the next Job: first any retry-waiting whose readyAt has elapsed,
   * then prefetch in FIFO order (R25.2).
   */
  private tryAdmitNext(
    nodeId: string,
    timestamp: number,
    context: ProcessorContext,
  ): void {
    while (this.executing.size < this.config.concurrency) {
      // First: retry-waiting Jobs whose readyAt has elapsed, in ascending readyAt
      const readyIdx = this.retryWaiting.findIndex((r) => r.readyAt <= timestamp);
      if (readyIdx >= 0) {
        const entry = this.retryWaiting.splice(readyIdx, 1)[0]!;
        // Add elapsed retry delay to accumulated latency
        const request = this.getRequest(entry.jobId, context);
        if (request && request.status === RequestStatus.InFlight) {
          this.admitJob(entry.jobId, nodeId, timestamp, context);
          continue;
        }
      }

      // Then: prefetch in FIFO order
      if (this.prefetch.length > 0) {
        const nextId = this.prefetch.shift()!;
        const state = context.getNodeState(nodeId);
        if (state) {
          state.queuedRequests = [...this.prefetch];
        }
        const request = this.getRequest(nextId, context);
        if (request && request.status === RequestStatus.InFlight) {
          this.admitJob(nextId, nodeId, timestamp, context);
          continue;
        }
      }

      // Nothing to admit
      break;
    }
  }

  private admitJob(
    requestId: string,
    nodeId: string,
    timestamp: number,
    context: ProcessorContext,
  ): void {
    this.windowJobsAdmitted++;
    const attemptNo = (this.attempts.get(requestId) ?? 0) + 1;
    this.attempts.set(requestId, attemptNo);

    const epoch = this.epochMap.get(requestId) ?? 0;
    this.executing.set(requestId, { attemptNo, startedAt: timestamp, epoch });

    const state = context.getNodeState(nodeId);
    if (state) {
      state.activeConnections = this.executing.size;
    }

    // Draw processing time independently per attempt, clamped at 0 ms
    const rng = context.getRNG();
    const processingTime = Math.max(
      0,
      rng.normalPositive(this.config.jobProcessingMeanMs, this.config.jobProcessingStdDevMs),
    );

    // Add processing time to accumulated latency
    const request = this.getRequest(requestId, context);
    if (request) {
      request.accumulatedLatencyMs += processingTime;
    }

    // Schedule JobAttemptComplete with epoch
    context.scheduleEvent({
      type: SimEventType.JobAttemptComplete,
      timestamp: timestamp + processingTime,
      nodeId,
      requestId,
      payload: { epoch, attemptNo },
    });

    // Schedule JobTimeout with same epoch — measured from slot occupancy (R25.10)
    context.scheduleEvent({
      type: SimEventType.JobTimeout,
      timestamp: timestamp + this.config.jobTimeoutMs,
      nodeId,
      requestId,
      payload: { epoch, attemptNo },
    });
  }

  /**
   * Compute backoff delay: Fixed or Exponential.
   * Fixed: retryBaseDelayMs (no growth).
   * Exponential: retryBaseDelayMs * 2^(n-1) capped at 300,000 ms. No jitter.
   */
  private computeBackoffDelay(attemptNumber: number): number {
    if (this.config.retryBackoff === RetryBackoff.Fixed) {
      return this.config.retryBaseDelayMs;
    }
    // Exponential: retryBaseDelayMs * 2^(n-1), capped at 300,000 ms
    const n = Math.max(1, attemptNumber);
    const delay = this.config.retryBaseDelayMs * Math.pow(2, n - 1);
    return Math.min(delay, 300_000);
  }

  private cleanupJob(requestId: string): void {
    this.attempts.delete(requestId);
    this.epochMap.delete(requestId);
    this.enqueueTimes.delete(requestId);
  }

  private getRequest(requestId: string, context: ProcessorContext): SimRequest | undefined {
    return context.getRequestMap().get(requestId);
  }

  onChaosApplied(): void {}
  onChaosReverted(): void {}

  onNodeDisabled(_context: ProcessorContext): string[] {
    // Return all request IDs in executing, prefetch, and retryWaiting
    const held: string[] = [];
    for (const [reqId] of this.executing) {
      held.push(reqId);
    }
    for (const reqId of this.prefetch) {
      held.push(reqId);
    }
    for (const entry of this.retryWaiting) {
      held.push(entry.jobId);
    }
    // Clear all populations
    this.executing.clear();
    this.prefetch = [];
    this.retryWaiting = [];
    this.epochMap.clear();
    return held;
  }

  onNodeRestored(_context: ProcessorContext): void {
    this.executing.clear();
    this.prefetch = [];
    this.retryWaiting = [];
    this.epochMap.clear();
  }

  resetWindowCounters(): void {
    this.windowJobsCompleted = 0;
    this.windowJobsAdmitted = 0;
    this.windowRetries = 0;
    this.windowRetryExhausted = 0;
    this.windowArrivalCount = 0;
  }

  getUtilization(): UtilizationReading {
    if (this.config.concurrency === 0) {
      return { kind: 'not-applicable', reason: 'concurrency is zero' };
    }
    const value = this.executing.size / this.config.concurrency;
    return { kind: 'value', value, idle: value === 0 };
  }

  /**
   * Job_Backlog: upstream buffered Jobs + prefetch.length, excluding executing (R25.11).
   */
  getJobBacklog(): number {
    return this.prefetch.length;
  }

  /**
   * Backlog_Age: now − enqueuedAt(oldest backlog Job), reported as 0 ms while empty (R25.12).
   */
  getBacklogAge(currentTime: number): number {
    if (this.prefetch.length === 0) return 0;
    const oldest = this.prefetch[0]!;
    const enqueueTime = this.enqueueTimes.get(oldest) ?? currentTime;
    return currentTime - enqueueTime;
  }

  /**
   * Drain_Time projection: backlog / (completionRate - arrivalRate).
   * Returns null if not draining (completion <= arrival) (R25.13).
   */
  getDrainTime(windowDurationMs: number): number | null {
    if (windowDurationMs <= 0) return null;
    const completionRate = this.windowJobsCompleted / windowDurationMs;
    const arrivalRate = this.windowArrivalCount / windowDurationMs;
    if (completionRate <= arrivalRate) return null; // Not draining
    const backlog = this.getJobBacklog();
    if (backlog === 0) return 0;
    return backlog / (completionRate - arrivalRate);
  }

  /**
   * Job completion rate: completions per window.
   */
  getCompletionRate(): number {
    return this.windowJobsCompleted;
  }

  /**
   * Retry rate: retries per window.
   */
  getRetryRate(): number {
    return this.windowRetries;
  }

  /**
   * Retry exhaustion rate: exhaustions per window.
   */
  getRetryExhaustionRate(): number {
    return this.windowRetryExhausted;
  }
}
