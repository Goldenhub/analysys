/**
 * Object_Store Processor — Requirement 27
 *
 * Size- and bandwidth-bound object storage whose per-request latency is
 * baseLatency + transferTime, where transferTime is dynamically shared among
 * concurrent transfers via reprice().
 *
 * PRNG draw order per request: read/write classification → object size → base latency.
 *
 * Write multiplier encoded as scaled remainingWorkKB = sizeKB × writeLatencyMultiplier
 * for writes (R27.7), so the multiplier stays exact under repricing while the sum of
 * active bandwidth shares still equals the configured capacity.
 *
 * 1 MB = 1,024 KB, 1 second = 1,000 ms.
 */
import type { ObjectStoreConfig } from '@/types/nodes';
import type { UtilizationReading } from '@/types/metrics';
import type { NodeProcessor, SimEvent, SimRequest, ProcessorContext } from '../types';
import { SimEventType, RequestStatus } from '../types';

/** An active transfer occupying a concurrency slot. */
export interface ActiveTransfer {
  requestId: string;
  remainingWorkKB: number;
  actualSizeKB: number;
  lastUpdateMs: number;
  epoch: number;
  isWrite: boolean;
}

export class ObjectStoreProcessor implements NodeProcessor {
  private config: ObjectStoreConfig;

  /** Active transfers in progress. */
  private active: Map<string, ActiveTransfer> = new Map();
  /** FIFO queue of waiting requests. */
  private transferQueue: string[] = [];
  /** Track when requests entered the queue for wait-time accounting. */
  private queueEntryTimes: Map<string, number> = new Map();

  /** Current per-transfer share in MB/s (recalculated on reprice). */
  private currentShareMBps = 0;

  // Per-window counters
  private windowTransferredKB = 0;
  private windowTransferCount = 0;
  private windowTransferTimeMs = 0;
  private windowDrops = 0;
  private windowReads = 0;
  private windowWrites = 0;

  constructor(config: ObjectStoreConfig) {
    this.config = { ...config };
  }

  onRequestArrived(event: SimEvent, request: SimRequest, context: ProcessorContext): void {
    const state = context.getNodeState(event.nodeId);
    if (!state) return;

    context.recordArrival(event.nodeId, request.id, event.timestamp);

    // Check queue overflow: beyond transferQueueDepth + maxConcurrentTransfers → Dropped
    if (
      this.active.size >= this.config.maxConcurrentTransfers &&
      this.transferQueue.length >= this.config.transferQueueDepth
    ) {
      // Terminate Dropped with latency accumulated BEFORE reaching this node
      request.status = RequestStatus.Dropped;
      request.completedAt = event.timestamp;
      state.totalDropped++;
      this.windowDrops++;
      context.recordDeparture(event.nodeId, request.id, event.timestamp);
      return;
    }

    const rng = context.getRNG();

    // Draw 1: read/write classification
    const isWrite = rng.next() >= this.config.readFraction;

    // Draw 2: object size (normal distribution, clamped to [1, 10,485,760] KB)
    let sizeKB = rng.normalPositive(this.config.objectSizeMeanKB, this.config.objectSizeStdDevKB);
    sizeKB = Math.max(1, Math.min(10_485_760, sizeKB));

    // Draw 3: base latency (normal distribution, clamped at 0, unscaled by write multiplier)
    const baseLatency = Math.max(
      0,
      rng.normalPositive(this.config.baseLatencyMeanMs, this.config.baseLatencyStdDevMs),
    );

    // Add base latency to accumulated latency
    request.accumulatedLatencyMs += baseLatency;

    if (isWrite) {
      this.windowWrites++;
    } else {
      this.windowReads++;
    }

    // If concurrency is full, queue the request
    if (this.active.size >= this.config.maxConcurrentTransfers) {
      this.transferQueue.push(request.id);
      this.queueEntryTimes.set(request.id, event.timestamp);
      state.queuedRequests = [...this.transferQueue];
      // Store transfer params on the request payload for later use
      (request as unknown as Record<string, unknown>).__osTransfer = {
        sizeKB,
        isWrite,
      };
      return;
    }

    // Start the transfer immediately
    this.startTransfer(request.id, sizeKB, isWrite, event.nodeId, event.timestamp, context);
  }

  /**
   * Called by the engine when a TransferComplete event fires.
   */
  onTransferComplete(event: SimEvent, context: ProcessorContext): void {
    const transfer = this.active.get(event.requestId);
    if (!transfer) return;

    // Epoch check — discard stale events from before a reprice
    const eventEpoch = event.payload.epoch as number;
    if (eventEpoch !== transfer.epoch) return;

    const state = context.getNodeState(event.nodeId);
    if (!state) return;

    // Complete the transfer
    const transferTimeMs =
      event.timestamp - ((event.payload.transferStartMs as number) ?? transfer.lastUpdateMs);
    this.windowTransferredKB += transfer.actualSizeKB;
    this.windowTransferCount++;
    this.windowTransferTimeMs += transferTimeMs;

    // Add transfer time to request's accumulated latency
    const request = context.getRequestMap().get(event.requestId);
    if (request) {
      const totalTransferTime = event.timestamp - (event.payload.transferStartMs as number);
      request.accumulatedLatencyMs += totalTransferTime;

      // Object_Store is always terminal (R30.10 — no outgoing edges)
      request.status = RequestStatus.Success;
      request.completedAt = event.timestamp;
      state.totalProcessed++;
      state.latencySamples.push(request.accumulatedLatencyMs);
      context.recordDeparture(event.nodeId, request.id, event.timestamp);
    }

    // Remove from active
    this.active.delete(event.requestId);
    state.activeConnections = this.active.size;

    // Reprice remaining active transfers
    if (this.active.size > 0) {
      this.reprice(event.timestamp, event.nodeId, context);
    }

    // Admit next from queue
    this.admitFromQueue(event.nodeId, event.timestamp, context);
  }

  /**
   * reprice(now) — Requirement 27.5–27.6:
   * 1. Charge elapsed progress against each active transfer
   * 2. Re-divide throughputCapacityMBps equally among active transfers
   * 3. Reschedule each TransferComplete from remaining work and the new share with fresh epoch
   */
  private reprice(now: number, nodeId: string, context: ProcessorContext): void {
    if (this.active.size === 0) {
      this.currentShareMBps = 0;
      return;
    }

    // Step 1: Charge elapsed progress against each active transfer
    for (const transfer of this.active.values()) {
      const elapsedMs = now - transfer.lastUpdateMs;
      if (elapsedMs > 0 && this.currentShareMBps > 0) {
        // Progress in KB: share (MB/s) × elapsed (s) × 1024 (KB/MB)
        const progressKB = this.currentShareMBps * (elapsedMs / 1000) * 1024;
        transfer.remainingWorkKB = Math.max(0, transfer.remainingWorkKB - progressKB);
      }
      transfer.lastUpdateMs = now;
    }

    // Step 2: Re-divide bandwidth equally
    this.currentShareMBps = this.config.throughputCapacityMBps / this.active.size;

    // Step 3: Reschedule each TransferComplete with fresh epoch
    for (const transfer of this.active.values()) {
      transfer.epoch++;
      if (transfer.remainingWorkKB <= 0) {
        // Transfer is done — schedule immediate completion
        context.scheduleEvent({
          type: SimEventType.TransferComplete,
          timestamp: now,
          nodeId,
          requestId: transfer.requestId,
          payload: {
            epoch: transfer.epoch,
            transferStartMs:
              (
                context.getRequestMap().get(transfer.requestId) as unknown as Record<
                  string,
                  unknown
                >
              )?.__osTransferStart ?? now,
          },
        });
      } else {
        // Calculate remaining time: (remainingWorkKB / 1024) / shareMBps * 1000 ms
        const remainingMs = (transfer.remainingWorkKB / 1024 / this.currentShareMBps) * 1000;
        context.scheduleEvent({
          type: SimEventType.TransferComplete,
          timestamp: now + remainingMs,
          nodeId,
          requestId: transfer.requestId,
          payload: {
            epoch: transfer.epoch,
            transferStartMs:
              (
                context.getRequestMap().get(transfer.requestId) as unknown as Record<
                  string,
                  unknown
                >
              )?.__osTransferStart ?? now,
          },
        });
      }
    }
  }

  private startTransfer(
    requestId: string,
    sizeKB: number,
    isWrite: boolean,
    nodeId: string,
    timestamp: number,
    context: ProcessorContext,
  ): void {
    // Encode write multiplier as scaled remaining work
    const remainingWorkKB = isWrite ? sizeKB * this.config.writeLatencyMultiplier : sizeKB;

    const transfer: ActiveTransfer = {
      requestId,
      remainingWorkKB,
      actualSizeKB: sizeKB,
      lastUpdateMs: timestamp,
      epoch: 0,
      isWrite,
    };

    this.active.set(requestId, transfer);

    // Store transfer start time on request
    const request = context.getRequestMap().get(requestId);
    if (request) {
      (request as unknown as Record<string, unknown>).__osTransferStart = timestamp;
    }

    const state = context.getNodeState(nodeId);
    if (state) {
      state.activeConnections = this.active.size;
    }

    // Reprice to divide bandwidth among all active transfers (including this new one)
    this.reprice(timestamp, nodeId, context);
  }

  private admitFromQueue(nodeId: string, timestamp: number, context: ProcessorContext): void {
    while (this.active.size < this.config.maxConcurrentTransfers && this.transferQueue.length > 0) {
      const nextId = this.transferQueue.shift()!;
      const state = context.getNodeState(nodeId);
      if (state) {
        state.queuedRequests = [...this.transferQueue];
      }

      const request = context.getRequestMap().get(nextId);
      if (!request || request.status !== RequestStatus.InFlight) {
        this.queueEntryTimes.delete(nextId);
        continue;
      }

      // Add wait time to accumulated latency
      const entryTime = this.queueEntryTimes.get(nextId) ?? timestamp;
      const waitTime = timestamp - entryTime;
      request.accumulatedLatencyMs += waitTime;
      this.queueEntryTimes.delete(nextId);

      // Retrieve stored transfer params
      const transferParams = (request as unknown as Record<string, unknown>).__osTransfer as
        { sizeKB: number; isWrite: boolean } | undefined;
      const sizeKB = transferParams?.sizeKB ?? this.config.objectSizeMeanKB;
      const isWrite = transferParams?.isWrite ?? false;

      this.startTransfer(nextId, sizeKB, isWrite, nodeId, timestamp, context);
    }
  }

  onChaosApplied(): void {}
  onChaosReverted(): void {}

  onNodeDisabled(_context: ProcessorContext): string[] {
    // Return all request IDs in active transfers and transfer queue
    const held: string[] = [];
    for (const [reqId] of this.active) {
      held.push(reqId);
    }
    for (const reqId of this.transferQueue) {
      held.push(reqId);
    }
    this.active.clear();
    this.transferQueue = [];
    this.queueEntryTimes.clear();
    this.currentShareMBps = 0;
    return held;
  }

  onNodeRestored(_context: ProcessorContext): void {
    this.active.clear();
    this.transferQueue = [];
    this.queueEntryTimes.clear();
    this.currentShareMBps = 0;
  }
  resetWindowCounters(): void {
    this.windowTransferredKB = 0;
    this.windowTransferCount = 0;
    this.windowTransferTimeMs = 0;
    this.windowDrops = 0;
    this.windowReads = 0;
    this.windowWrites = 0;
  }

  getUtilization(): UtilizationReading {
    if (this.config.maxConcurrentTransfers === 0) {
      return { kind: 'not-applicable', reason: 'maxConcurrentTransfers is zero' };
    }
    const value = this.active.size / this.config.maxConcurrentTransfers;
    return { kind: 'value', value, idle: value === 0 };
  }

  // ─── Metrics accessors (task 384) ─────────────────────────────

  /** Aggregate transfer rate from actualSizeKB (not scaled work). */
  getTransferRateKBps(windowDurationMs: number): number {
    if (windowDurationMs <= 0) return 0;
    return this.windowTransferredKB / (windowDurationMs / 1000);
  }

  /** Rate as a fraction of capacity. */
  getBandwidthUtilization(windowDurationMs: number): number {
    if (windowDurationMs <= 0 || this.config.throughputCapacityMBps <= 0) return 0;
    const rateMBps = this.getTransferRateKBps(windowDurationMs) / 1024;
    return rateMBps / this.config.throughputCapacityMBps;
  }

  /** Whether bandwidth is the limiting resource (at or above 0.85 of capacity). */
  isBandwidthLimiting(windowDurationMs: number): boolean {
    return this.getBandwidthUtilization(windowDurationMs) >= 0.85;
  }

  /** Number of active transfers. */
  getActiveTransfers(): number {
    return this.active.size;
  }

  /** Number of queued requests. */
  getQueuedRequests(): number {
    return this.transferQueue.length;
  }

  /** Mean transfer time in ms. */
  getMeanTransferTime(): number {
    if (this.windowTransferCount === 0) return 0;
    return this.windowTransferTimeMs / this.windowTransferCount;
  }

  /** Drop rate (per window). */
  getDropRate(): number {
    return this.windowDrops;
  }

  /** Read count (per window). */
  getReadCount(): number {
    return this.windowReads;
  }

  /** Write count (per window). */
  getWriteCount(): number {
    return this.windowWrites;
  }
}
