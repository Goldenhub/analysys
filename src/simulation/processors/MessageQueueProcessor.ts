import type { MessageQueueConfig } from '@/types/nodes';
import { BackpressureStrategy } from '@/types/nodes';
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
        case BackpressureStrategy.DropOldest:
          this.buffer.shift(); // Remove oldest
          this.buffer.push(request.id);
          state.bufferedMessages = this.buffer.length;
          state.queuedRequests = [...this.buffer];
          break;
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

    // The request is now "in the queue" — success from the producer's perspective.
    // The consumer drains it asynchronously.
    request.status = RequestStatus.Success;
    context.recordDeparture(event.nodeId, request.id, event.timestamp);
    // Schedule a completion event so the MQ follows the same lifecycle as every
    // other terminal path. The engine sets `completedAt` when the response completes.
    context.scheduleEvent({
      type: SimEventType.RequestComplete,
      timestamp: event.timestamp,
      nodeId: event.nodeId,
      requestId: request.id,
      payload: { enqueued: true },
    });

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
      this.scheduleConsumerPoll(event.nodeId, event.timestamp + 100, context); // 100ms poll interval
    } else {
      this.consumerScheduled = false;
    }
  }

  private scheduleConsumerPoll(
    nodeId: string,
    timestamp: number,
    context: ProcessorContext,
  ): void {
    this.consumerScheduled = true;
    context.scheduleEvent({
      type: SimEventType.ConsumerPoll,
      timestamp: timestamp + 100, // 100ms poll interval
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

  getUtilization(): number {
    if (this.config.bufferCapacity === 0) return 0;
    return this.buffer.length / this.config.bufferCapacity;
  }
}
