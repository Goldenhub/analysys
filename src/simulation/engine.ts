import { NodeType } from '@/types/nodes';
import type { SimulationNode } from '@/types/nodes';
import type { EdgeData } from '@/types/edges';
import type { SimulationEngineConfig, ChaosEventPayload } from '@/types/messages';
import type { MetricsBatchPayload } from '@/types/metrics';
import { MinHeap } from './eventQueue';
import { SeededRNG } from './prng';
import type { SimEvent, SimRequest, NodeRuntimeState, ProcessorContext, NodeProcessor } from './types';
import { SimEventType, SimState, RequestStatus } from './types';
import { TrafficGeneratorProcessor } from './processors/TrafficGeneratorProcessor';
import { LoadBalancerProcessor } from './processors/LoadBalancerProcessor';
import { AppServerProcessor } from './processors/AppServerProcessor';
import { CacheProcessor } from './processors/CacheProcessor';
import { DatabaseProcessor } from './processors/DatabaseProcessor';
import { MessageQueueProcessor } from './processors/MessageQueueProcessor';
import { MetricsCollector } from './metrics/MetricsCollector';

export class SimulationEngine {
  private eventQueue: MinHeap<SimEvent>;
  private virtualClockMs = 0;
  private state: SimState = SimState.Idle;
  private rng: SeededRNG;
  private requests: Map<string, SimRequest> = new Map();
  private nodeStates: Map<string, NodeRuntimeState> = new Map();
  private nodeConfigs: Map<string, SimulationNode> = new Map();
  private adjacency: Map<string, EdgeData[]> = new Map();
  private eventCounter = 0;
  private requestCounter = 0;
  private config: SimulationEngineConfig;
  private metricsCollector: MetricsCollector;
  private startWallTime = 0;

  // Callback for sending messages back to main thread
  private onMetricsBatch: ((payload: MetricsBatchPayload) => void) | null = null;
  private onNodeStatus: ((nodeId: string, status: 'green' | 'yellow' | 'red') => void) | null = null;
  private onEventLog: ((entries: Array<{ id: number; timestamp: number; type: string; nodeId: string; requestId?: string; message: string }>) => void) | null = null;
  private onComplete: ((summary: { totalEvents: number; totalRequests: number; successRate: number; avgEndToEndLatencyMs: number; simulatedDurationMs: number; wallClockDurationMs: number; eventsPerSecond: number }) => void) | null = null;

  // Batch control
  private readonly BATCH_SIZE = 200;

  constructor(config: SimulationEngineConfig) {
    this.config = config;
    this.rng = new SeededRNG(config.seed);
    this.eventQueue = new MinHeap<SimEvent>((a, b) => a.timestamp - b.timestamp);
    this.metricsCollector = new MetricsCollector(config.topology.nodes, 5000);

    this.buildAdjacency(config.topology.edges);
    this.initializeNodeStates(config.topology.nodes);
    this.scheduleInitialEvents(config.topology.nodes);
  }

  // ─── Public API ──────────────────────────────────────────────

  setCallbacks(callbacks: {
    onMetricsBatch?: (payload: MetricsBatchPayload) => void;
    onNodeStatus?: (nodeId: string, status: 'green' | 'yellow' | 'red') => void;
    onEventLog?: (entries: Array<{ id: number; timestamp: number; type: string; nodeId: string; requestId?: string; message: string }>) => void;
    onComplete?: (summary: { totalEvents: number; totalRequests: number; successRate: number; avgEndToEndLatencyMs: number; simulatedDurationMs: number; wallClockDurationMs: number; eventsPerSecond: number }) => void;
  }): void {
    this.onMetricsBatch = callbacks.onMetricsBatch ?? null;
    this.onNodeStatus = callbacks.onNodeStatus ?? null;
    this.onEventLog = callbacks.onEventLog ?? null;
    this.onComplete = callbacks.onComplete ?? null;
  }

  async run(): Promise<void> {
    this.state = SimState.Running;
    this.startWallTime = Date.now();

    while (this.state === SimState.Running) {
      let processed = 0;

      while (processed < this.BATCH_SIZE && this.eventQueue.size > 0) {
        const event = this.eventQueue.extractMin()!;

        if (event.timestamp > this.config.maxSimulatedTimeMs) {
          this.state = SimState.Complete;
          this.handleMetricsSnapshot();
          this.emitComplete();
          return;
        }

        this.virtualClockMs = event.timestamp;
        this.processEvent(event);
        processed++;
      }

      // Yield to event loop so postMessage handlers can fire
      await this.yieldToMacroTask();

      if (this.eventQueue.size === 0) {
        this.state = SimState.Complete;
        this.handleMetricsSnapshot();
        this.emitComplete();
        return;
      }
    }
  }

  pause(): void {
    this.state = SimState.Paused;
  }

  resume(speedMultiplier: number): void {
    this.config.speedMultiplier = speedMultiplier;
    this.state = SimState.Running;
    this.run();
  }

  reset(): void {
    this.state = SimState.Idle;
    this.virtualClockMs = 0;
    this.eventQueue.clear();
    this.requests.clear();
    this.eventCounter = 0;
    this.requestCounter = 0;
    this.metricsCollector.reset();
    this.initializeNodeStates(this.config.topology.nodes);
    this.scheduleInitialEvents(this.config.topology.nodes);
  }

  injectChaos(payload: ChaosEventPayload): void {
    const { chaosType, targetNodeId, durationMs } = payload;

    const logEntries: Array<{ id: number; timestamp: number; type: string; nodeId: string; requestId?: string; message: string }> = [];

    // Apply chaos to relevant nodes
    for (const [nodeId, state] of this.nodeStates) {
      const node = this.nodeConfigs.get(nodeId);
      if (!node) continue;

      let applies = false;
      if (chaosType === 'FLUSH_CACHE' && node.nodeType === NodeType.Cache) applies = true;
      if (chaosType === 'DROP_DB' && node.nodeType === NodeType.Database) {
        applies = !targetNodeId || targetNodeId === nodeId;
      }
      if (chaosType === 'SPIKE_TRAFFIC' && node.nodeType === NodeType.TrafficGenerator) applies = true;

      if (applies) {
        state.processor.onChaosApplied(chaosType, payload.params);
        logEntries.push({
          id: this.eventCounter,
          timestamp: this.virtualClockMs,
          type: 'CHAOS_START',
          nodeId,
          message: `Chaos "${chaosType}" applied to ${node.label} for ${durationMs}ms`,
        });
        // Schedule revert
        this.scheduleEvent({
          type: SimEventType.ChaosEnd,
          timestamp: this.virtualClockMs + durationMs,
          nodeId,
          requestId: '',
          payload: { chaosType },
        });

        // For SPIKE_TRAFFIC, immediately inject burst arrivals to make the spike feel instant
        if (chaosType === 'SPIKE_TRAFFIC') {
          const burstCount = 20;
          for (let i = 0; i < burstCount; i++) {
            this.scheduleEvent({
              type: SimEventType.RequestArrival,
              timestamp: this.virtualClockMs + i * 0.1,
              nodeId,
              requestId: '',
              payload: {},
            });
          }
        }
      }
    }

    if (logEntries.length > 0) {
      this.onEventLog?.(logEntries);
    }
  }

  updateNodeConfig(nodeId: string, config: Record<string, unknown>): void {
    const node = this.nodeConfigs.get(nodeId);
    if (node) {
      Object.assign(node.config, config);
    }
  }

  getState(): SimState {
    return this.state;
  }

  getVirtualTime(): number {
    return this.virtualClockMs;
  }

  // ─── Event Processing ────────────────────────────────────────

  private processEvent(event: SimEvent): void {
    switch (event.type) {
      case SimEventType.RequestArrival:
        this.handleRequestArrival(event);
        break;
      case SimEventType.RequestRoute:
        this.handleRequestRoute(event);
        break;
      case SimEventType.RequestEnqueue:
        // Informational event — no action needed
        break;
      case SimEventType.RequestProcess:
        this.handleRequestProcess(event);
        break;
      case SimEventType.RequestComplete:
        this.handleRequestComplete(event);
        break;
      case SimEventType.RequestTimeout:
        this.handleRequestTimeout(event);
        break;
      case SimEventType.MetricsSnapshot:
        this.handleMetricsSnapshot();
        break;
      case SimEventType.ChaosEnd:
        this.handleChaosEnd(event);
        break;
      case SimEventType.ConsumerPoll:
        this.handleConsumerPoll(event);
        break;
      default:
        break;
    }
  }

  private handleRequestArrival(event: SimEvent): void {
    const node = this.nodeConfigs.get(event.nodeId);
    if (!node || node.nodeType !== NodeType.TrafficGenerator) return;

    // Create new request
    const requestId = `req-${this.requestCounter++}`;
    const request: SimRequest = {
      id: requestId,
      originNodeId: event.nodeId,
      createdAt: event.timestamp,
      status: RequestStatus.InFlight,
      hopCount: 0,
      maxHops: this.config.maxHopsPerRequest,
      path: [event.nodeId],
      accumulatedLatencyMs: 0,
    };
    this.requests.set(requestId, request);

    // Route to first downstream node
    const outEdges = this.getOutgoingEdges(event.nodeId);
    if (outEdges.length === 0) {
      request.status = RequestStatus.NoRoute;
      request.completedAt = event.timestamp;
      this.metricsCollector.recordCompletion(request);
    } else {
      const target = outEdges[0]!.target;
      this.scheduleEvent({
        type: SimEventType.RequestRoute,
        timestamp: event.timestamp,
        nodeId: target,
        requestId,
        payload: { fromNodeId: event.nodeId },
      });
    }

    // Schedule next arrival
    const processor = this.nodeStates.get(event.nodeId)?.processor as TrafficGeneratorProcessor | undefined;
    if (processor) {
      processor.scheduleNextArrival(event.nodeId, event.timestamp, this.getProcessorContext());
    }
  }

  private handleRequestRoute(event: SimEvent): void {
    const request = this.requests.get(event.requestId);
    if (!request || request.status !== RequestStatus.InFlight) return;

    request.hopCount++;
    request.path.push(event.nodeId);

    // Cycle guard
    if (request.hopCount > request.maxHops) {
      request.status = RequestStatus.LoopDetected;
      request.completedAt = event.timestamp;
      this.metricsCollector.recordCompletion(request);
      return;
    }

    // Delegate to node processor
    const state = this.nodeStates.get(event.nodeId);
    if (state) {
      state.processor.onRequestArrived(event, request, this.getProcessorContext());
    }
  }

  private handleRequestProcess(event: SimEvent): void {
    const request = this.requests.get(event.requestId);
    if (!request) return;

    const node = this.nodeConfigs.get(event.nodeId);
    if (!node) return;

    const state = this.nodeStates.get(event.nodeId);
    if (!state) return;

    // Delegate to processor's onProcessComplete
    if (node.nodeType === NodeType.AppServer) {
      (state.processor as AppServerProcessor).onProcessComplete(event, request, this.getProcessorContext());
    } else if (node.nodeType === NodeType.Database) {
      (state.processor as DatabaseProcessor).onProcessComplete(event, request, this.getProcessorContext());
    }

    // If request is now complete, record it
    if (request.status === RequestStatus.Success || request.status === RequestStatus.Timeout) {
      this.metricsCollector.recordCompletion(request);
    }
  }

  private handleRequestComplete(event: SimEvent): void {
    const request = this.requests.get(event.requestId);
    if (!request) return;
    if (request.status === RequestStatus.InFlight) {
      request.status = RequestStatus.Success;
      request.completedAt = event.timestamp;
    }
    this.metricsCollector.recordCompletion(request);
  }

  private handleRequestTimeout(event: SimEvent): void {
    const request = this.requests.get(event.requestId);
    if (!request) return;
    if (request.status === RequestStatus.InFlight) {
      request.status = RequestStatus.Timeout;
      request.completedAt = event.timestamp;
      const state = this.nodeStates.get(event.nodeId);
      if (state) {
        state.totalTimedOut++;
        // Remove from queue if still queued
        const idx = state.queuedRequests.indexOf(request.id);
        if (idx >= 0) state.queuedRequests.splice(idx, 1);
      }
      this.metricsCollector.recordCompletion(request);
      this.metricsCollector.recordDeparture(event.nodeId, request.id, event.timestamp);
    }
  }

  private handleMetricsSnapshot(): void {
    const activeRequestCount = [...this.requests.values()].filter(
      (r) => r.status === RequestStatus.InFlight,
    ).length;

    const batch = this.metricsCollector.generateBatch(
      this.virtualClockMs,
      this.nodeStates,
      activeRequestCount,
    );
    this.onMetricsBatch?.(batch);

    // Emit node statuses
    for (const nodeSnapshot of batch.nodes) {
      this.onNodeStatus?.(nodeSnapshot.nodeId, nodeSnapshot.healthStatus);
    }

    // Reset per-window counters
    for (const state of this.nodeStates.values()) {
      state.totalProcessed = 0;
      state.totalDropped = 0;
      state.totalTimedOut = 0;
      state.latencySamples = [];
    }

    // Schedule next snapshot
    this.scheduleEvent({
      type: SimEventType.MetricsSnapshot,
      timestamp: this.virtualClockMs + this.config.metricsIntervalMs,
      nodeId: '',
      requestId: '',
      payload: {},
    });
  }

  private handleChaosEnd(event: SimEvent): void {
    const state = this.nodeStates.get(event.nodeId);
    if (state) {
      state.processor.onChaosReverted();
    }
  }

  private handleConsumerPoll(event: SimEvent): void {
    const state = this.nodeStates.get(event.nodeId);
    if (state) {
      (state.processor as MessageQueueProcessor).onConsumerPoll(event, this.getProcessorContext());
    }
  }

  // ─── Initialization ──────────────────────────────────────────

  private buildAdjacency(edges: EdgeData[]): void {
    this.adjacency.clear();
    for (const edge of edges) {
      const list = this.adjacency.get(edge.source) ?? [];
      list.push(edge);
      this.adjacency.set(edge.source, list);
    }
  }

  private initializeNodeStates(nodes: SimulationNode[]): void {
    this.nodeStates.clear();
    this.nodeConfigs.clear();

    for (const node of nodes) {
      this.nodeConfigs.set(node.id, node);
      const processor = this.createProcessor(node);
      this.nodeStates.set(node.id, {
        nodeId: node.id,
        processor,
        activeConnections: 0,
        queuedRequests: [],
        bufferedMessages: 0,
        totalProcessed: 0,
        totalDropped: 0,
        totalTimedOut: 0,
        latencySamples: [],
      });
    }
  }

  private createProcessor(node: SimulationNode): NodeProcessor {
    switch (node.nodeType) {
      case NodeType.TrafficGenerator:
        return new TrafficGeneratorProcessor(node.config);
      case NodeType.LoadBalancer:
        return new LoadBalancerProcessor(node.config);
      case NodeType.AppServer:
        return new AppServerProcessor(node.config);
      case NodeType.Cache:
        return new CacheProcessor(node.config);
      case NodeType.Database:
        return new DatabaseProcessor(node.config);
      case NodeType.MessageQueue:
        return new MessageQueueProcessor(node.config);
    }
  }

  private scheduleInitialEvents(nodes: SimulationNode[]): void {
    // Schedule first arrival from each TrafficGenerator
    for (const node of nodes) {
      if (node.nodeType === NodeType.TrafficGenerator) {
        const processor = this.nodeStates.get(node.id)?.processor as TrafficGeneratorProcessor;
        processor.scheduleNextArrival(node.id, 0, this.getProcessorContext());
      }
    }

    // Schedule first metrics snapshot
    this.scheduleEvent({
      type: SimEventType.MetricsSnapshot,
      timestamp: this.config.metricsIntervalMs,
      nodeId: '',
      requestId: '',
      payload: {},
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────

  private scheduleEvent(partial: Omit<SimEvent, 'id'>): void {
    this.eventQueue.insert({
      ...partial,
      id: this.eventCounter++,
    });
  }

  private getOutgoingEdges(nodeId: string): EdgeData[] {
    return this.adjacency.get(nodeId) ?? [];
  }

  private getProcessorContext(): ProcessorContext {
    return {
      scheduleEvent: (partial) => this.scheduleEvent(partial),
      getOutgoingEdges: (nodeId) => this.getOutgoingEdges(nodeId),
      getNodeConfig: (nodeId) => this.nodeConfigs.get(nodeId),
      getNodeState: (nodeId) => this.nodeStates.get(nodeId),
      getRNG: () => this.rng,
      currentTime: () => this.virtualClockMs,
      recordArrival: (nodeId, requestId, timestamp) =>
        this.metricsCollector.recordArrival(nodeId, requestId, timestamp),
      recordDeparture: (nodeId, requestId, timestamp) =>
        this.metricsCollector.recordDeparture(nodeId, requestId, timestamp),
    };
  }

  private emitComplete(): void {
    const wallClockMs = Date.now() - this.startWallTime;
    const allRequests = [...this.requests.values()];
    const successful = allRequests.filter((r) => r.status === RequestStatus.Success);
    const totalLatency = successful.reduce((sum, r) => sum + r.accumulatedLatencyMs, 0);

    this.onComplete?.({
      totalEvents: this.eventCounter,
      totalRequests: allRequests.length,
      successRate: allRequests.length > 0 ? successful.length / allRequests.length : 0,
      avgEndToEndLatencyMs: successful.length > 0 ? totalLatency / successful.length : 0,
      simulatedDurationMs: this.virtualClockMs,
      wallClockDurationMs: wallClockMs,
      eventsPerSecond: wallClockMs > 0 ? (this.eventCounter / wallClockMs) * 1000 : 0,
    });
  }

  private yieldToMacroTask(): Promise<void> {
    // At 1x speed, yield for ~50ms between batches to allow UI updates and user interaction
    // At higher speeds, reduce the delay proportionally
    const delayMs = Math.max(1, Math.floor(50 / this.config.speedMultiplier));
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
