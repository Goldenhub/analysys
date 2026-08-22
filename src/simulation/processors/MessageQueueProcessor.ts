import type { MessageQueueConfig } from '@/types/nodes';
import { BackpressureStrategy } from '@/types/nodes';
import type { UtilizationReading } from '@/types/metrics';
import type { NodeProcessor, SimEvent, SimRequest, ProcessorContext } from '../types';
import { SimEventType, RequestStatus } from '../types';

export class MessageQueueProcessor implements NodeProcessor {
  private config: MessageQueueConfig;
  private buffer: string[] = []; // request IDs in buffer
  private consumerScheduled = false;

  constructor(config: MessageQueueConfig) {
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

    // Check buffer capacity
    if (this.buffer.length >= this.config.bufferCapacity) {
      // Apply backpressure strategy
      switch (this.config.backpressureStrategy) {
        case BackpressureStrategy.DropOldest: {
          const evictedId = this.buffer.shift(); // Remove oldest
          this.buffer.push(request.id);
          state.bufferedMessages = this.buffer.length;
          state.queuedRequests = [...this.buffer];
          // The evicted message must reach a terminal state. Otherwise it stays
          // InFlight forever and permanently holds a slot in the engine's
          // in-flight counter. The processor doesn't hold the evicted SimRequest,
          // so signal the engine with a drop event.
          if (evictedId) {
            state.totalDropped++;
            context.scheduleEvent({
              type: SimEventType.RequestDrop,
              timestamp: event.timestamp,
              nodeId: event.nodeId,
              requestId: evictedId,
              payload: { reason: 'BUFFER_EVICTION' },
            });
          }
          break;
        }
        case BackpressureStrategy.RejectNew:
          request.status = RequestStatus.Dropped;
          request.completedAt = event.timestamp;
          state.totalDropped++;
          context.recordDeparture(event.nodeId, request.id, event.timestamp);
          return;
        case BackpressureStrategy.BlockProducer:
          // In simulation, blocking = timeout after a delay
          request.status = RequestStatus.Timeout;
          request.completedAt = event.timestamp;
          state.totalTimedOut++;
          context.recordDeparture(event.nodeId, request.id, event.timestamp);
          return;
      }
    } else {
      this.buffer.push(request.id);
      state.bufferedMessages = this.buffer.length;
      state.queuedRequests = [...this.buffer];

      const enqueueLatency = 0.2;
      request.accumulatedLatencyMs += enqueueLatency;
      state.latencySamples.push(enqueueLatency);
    }

    state.totalProcessed++;

    // The request stays InFlight while buffered — it hasn't been handled yet.
    // The consumer poll routes it downstream, and that path owns completion.
    // If there's no downstream, the enqueue itself is terminal.
    // recordDeparture is still correct here: the request is leaving this node's
    // own arrival/departure accounting for Little's Law purposes.
    context.recordDeparture(event.nodeId, request.id, event.timestamp);

    const hasDownstream = context.getOutgoingEdges(event.nodeId).length > 0;
    if (!hasDownstream) {
      request.status = RequestStatus.Success;
      context.scheduleEvent({
        type: SimEventType.RequestComplete,
        timestamp: event.timestamp,
        nodeId: event.nodeId,
        requestId: request.id,
        payload: { enqueued: true, terminal: true },
      });
    }

    // Ensure consumer polling is scheduled
    if (!this.consumerScheduled) {
      this.scheduleConsumerPoll(event.nodeId, event.timestamp, context);
    }
  }

  /**
   * Consumer poll: drain batch of messages and route to downstream.
   */
  onConsumerPoll(
    event: SimEvent,
    context: ProcessorContext,
  ): void {
    const state = context.getNodeState(event.nodeId);
    if (!state) return;

    const batchSize = Math.min(this.config.consumerBatchSize, this.buffer.length);
    const batch = this.buffer.splice(0, batchSize);
    state.bufferedMessages = this.buffer.length;
    state.queuedRequests = [...this.buffer];

    // Route each consumed message downstream
    const edges = context.getOutgoingEdges(event.nodeId);
    if (edges.length > 0) {
      const target = edges[0]!.target;
      for (let i = 0; i < batch.length; i++) {
        context.scheduleEvent({
          type: SimEventType.RequestRoute,
          timestamp: event.timestamp + i * 0.01, // slight stagger
          nodeId: target,
          requestId: batch[i]!,
          payload: { fromNodeId: event.nodeId, batchIndex: i },
        });
      }
    }

    // Schedule next poll if buffer still has messages
    if (this.buffer.length > 0) {
      // scheduleConsumerPoll already adds the poll interval to the base timestamp
      this.scheduleConsumerPoll(event.nodeId, event.timestamp, context);
    } else {
      this.consumerScheduled = false;
    }
  }

  /** Consumer poll interval in simulated milliseconds. */
  private static readonly POLL_INTERVAL_MS = 100;

  private scheduleConsumerPoll(
    nodeId: string,
    timestamp: number,
    context: ProcessorContext,
  ): void {
    this.consumerScheduled = true;
    context.scheduleEvent({
      type: SimEventType.ConsumerPoll,
      timestamp: timestamp + MessageQueueProcessor.POLL_INTERVAL_MS,
      nodeId,
      requestId: '',
      payload: {},
    });
  }

  onChaosApplied(_chaosType: string, _params: Record<string, unknown>): void {
    // MQ doesn't directly respond to current chaos types
  }

  onChaosReverted(): void {
    // No-op
  }

  getUtilization(): UtilizationReading {
    const value =
      this.config.bufferCapacity === 0 ? 0 : this.buffer.length / this.config.bufferCapacity;
    // TODO(task 392): `idle` mirrors the pre-existing `utilization === 0` derivation because
    // there is no per-window arrival counter here, so a queue whose consumer keeps pace reads
    // as idle just like one that saw no traffic. Refine once an arrival count exists.
    return { kind: 'value', value, idle: value === 0 };
  }
}
