
# Design: Analysys — System Architecture & Data Structures

#[[file:.kiro/specs/requirements.md]]

---

## Overview

Analysys is a browser-based discrete-event simulation tool for modeling distributed system architectures. Users compose topology graphs of infrastructure components (traffic generators, load balancers, app servers, caches, databases, message queues) on a visual canvas, configure each node's parameters, and run simulations that produce real-time telemetry including throughput, latency percentiles, queue depths, and Little's Law validation metrics. The simulation runs in a Web Worker using a min-heap priority queue, seeded PRNG for determinism, and batched event processing for responsiveness.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        MAIN THREAD (React)                       │
│                                                                  │
│  ┌────────────┐  ┌─────────────────┐  ┌──────────────────────┐  │
│  │   Node     │  │  Canvas Engine  │  │  Telemetry Dashboard │  │
│  │  Palette   │  │  (@xyflow/react)│  │  (Recharts)          │  │
│  └────────────┘  └────────┬────────┘  └──────────┬───────────┘  │
│                           │                       │              │
│  ┌────────────────────────┴───────────────────────┴───────────┐  │
│  │               Zustand Store (TopologyStore)                │  │
│  │  • nodes[]  • edges[]  • simState  • metrics  • eventLog  │  │
│  └────────────────────────┬───────────────────────────────────┘  │
│                           │ postMessage                          │
├───────────────────────────┼──────────────────────────────────────┤
│                           ▼                                      │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              WEB WORKER (simulation.worker.ts)             │  │
│  │                                                            │  │
│  │  ┌──────────────┐  ┌───────────────┐  ┌───────────────┐  │  │
│  │  │  Event Loop  │  │  Min-Heap PQ  │  │  PRNG Engine  │  │  │
│  │  └──────┬───────┘  └───────────────┘  └───────────────┘  │  │
│  │         │                                                  │  │
│  │  ┌──────┴──────────────────────────────────────────────┐  │  │
│  │  │  Node Processors (per-type simulation logic)        │  │  │
│  │  │  • TrafficGeneratorProcessor                        │  │  │
│  │  │  • LoadBalancerProcessor                            │  │  │
│  │  │  • AppServerProcessor                               │  │  │
│  │  │  • CacheProcessor                                   │  │  │
│  │  │  • DatabaseProcessor                                │  │  │
│  │  │  • MessageQueueProcessor                            │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  │                                                            │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  Metrics Collector & Little's Law Parser            │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Components and Interfaces

### Canvas Node Data Structures

### Node Type Discriminated Union

All canvas nodes extend a shared base and are discriminated by the `nodeType` field. This enables exhaustive pattern matching in both the UI configuration panel and the simulation engine.

```typescript
// ─── Enumerations ────────────────────────────────────────────────

export enum NodeType {
  TrafficGenerator = 'TRAFFIC_GENERATOR',
  LoadBalancer = 'LOAD_BALANCER',
  AppServer = 'APP_SERVER',
  Cache = 'CACHE',
  Database = 'DATABASE',
  MessageQueue = 'MESSAGE_QUEUE',
}

export enum Distribution {
  Poisson = 'POISSON',
  Uniform = 'UNIFORM',
}

export enum LBAlgorithm {
  RoundRobin = 'ROUND_ROBIN',
  LeastConnections = 'LEAST_CONNECTIONS',
}

export enum EvictionPolicy {
  LRU = 'LRU',
  LFU = 'LFU',
  TTL = 'TTL',
}

export enum DatabaseType {
  Relational = 'RELATIONAL',
  NoSQL = 'NOSQL',
}

export enum BackpressureStrategy {
  DropOldest = 'DROP_OLDEST',
  BlockProducer = 'BLOCK_PRODUCER',
  RejectNew = 'REJECT_NEW',
}

// ─── Base Node ───────────────────────────────────────────────────

export interface BaseNodeData {
  id: string;                   // UUID v4
  nodeType: NodeType;
  label: string;                // User-editable display name
  position: { x: number; y: number };
}

// ─── Per-Type Configuration Interfaces ───────────────────────────

export interface TrafficGeneratorConfig {
  rps: number;                  // 1–100,000
  distribution: Distribution;
  spikeMultiplier: number;      // 1–20
  spikeDurationSec: number;     // seconds of spike when triggered
}

export interface LoadBalancerConfig {
  algorithm: LBAlgorithm;
  healthCheckIntervalMs: number;     // ms between health checks
  evictionThreshold: number;         // consecutive failures before eviction
}

export interface AppServerConfig {
  workerThreadPoolSize: number;      // 1–1,000
  requestQueueDepth: number;         // 0–10,000
  processingTimeMeanMs: number;      // mean processing time
  processingTimeStdDevMs: number;    // std deviation
}

export interface CacheConfig {
  hitRatio: number;                  // 0.0–1.0
  evictionPolicy: EvictionPolicy;
  accessLatencyMs: number;           // fixed lookup cost
}

export interface DatabaseConfig {
  connectionPoolSize: number;        // 1–500
  queryLatencyMeanMs: number;
  queryLatencyStdDevMs: number;
  lockTimeoutMs: number;
  dbType: DatabaseType;
}

export interface MessageQueueConfig {
  consumerBatchSize: number;         // 1–10,000
  bufferCapacity: number;            // max messages in buffer
  backpressureThresholdPct: number;  // 0–100, triggers backpressure
  backpressureStrategy: BackpressureStrategy;
}

// ─── Composed Node Types (Discriminated Union) ───────────────────

export interface TrafficGeneratorNode extends BaseNodeData {
  nodeType: NodeType.TrafficGenerator;
  config: TrafficGeneratorConfig;
}

export interface LoadBalancerNode extends BaseNodeData {
  nodeType: NodeType.LoadBalancer;
  config: LoadBalancerConfig;
}

export interface AppServerNode extends BaseNodeData {
  nodeType: NodeType.AppServer;
  config: AppServerConfig;
}

export interface CacheNode extends BaseNodeData {
  nodeType: NodeType.Cache;
  config: CacheConfig;
}

export interface DatabaseNode extends BaseNodeData {
  nodeType: NodeType.Database;
  config: DatabaseConfig;
}

export interface MessageQueueNode extends BaseNodeData {
  nodeType: NodeType.MessageQueue;
  config: MessageQueueConfig;
}

export type SimulationNode =
  | TrafficGeneratorNode
  | LoadBalancerNode
  | AppServerNode
  | CacheNode
  | DatabaseNode
  | MessageQueueNode;
```

### React Flow Integration

React Flow requires its own `Node` type. We wrap `SimulationNode` as the generic data payload:

```typescript
import type { Node as RFNode, Edge as RFEdge } from '@xyflow/react';

export type AnalysysNode = RFNode<SimulationNode>;
export type AnalysysEdge = RFEdge<EdgeData>;
```

---

### Edge Connection Data Structures & Validation

#### Edge Data Model

```typescript
export enum EdgeProtocol {
  Sync = 'SYNC',     // HTTP, gRPC — blocking, request/response
  Async = 'ASYNC',   // AMQP, Kafka — fire-and-forget or eventual
}

export interface EdgeData {
  id: string;                // UUID v4
  source: string;            // Source node ID
  target: string;            // Target node ID
  protocol: EdgeProtocol;
}
```

#### Connection Validation Rules

Edge creation is validated at interaction time (before persisting to the store) and again during simulation initialization for imported topologies.

```typescript
export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validates whether a proposed edge connection is allowed.
 * Called on drag-connect in the canvas and during JSON import.
 */
export function validateEdgeConnection(
  source: SimulationNode,
  target: SimulationNode,
  existingEdges: EdgeData[],
): ValidationResult {
  // Rule 1: No self-referencing edges
  if (source.id === target.id) {
    return { valid: false, reason: 'Self-referencing edges are not allowed.' };
  }

  // Rule 2: No duplicate edges (same source → same target)
  const duplicate = existingEdges.some(
    (e) => e.source === source.id && e.target === target.id,
  );
  if (duplicate) {
    return { valid: false, reason: 'A connection already exists between these nodes.' };
  }

  // Rule 3: Protocol compatibility matrix
  //   - Async edges may only TARGET a MessageQueue node
  //   - MessageQueue nodes may only EMIT async edges
  // (Sync edges have no target-type restriction.)
  // Handled implicitly by the handle configuration below.

  return { valid: true };
}

/**
 * Connection compatibility matrix.
 * Defines which (source type, target type) pairs are valid and under which protocols.
 */
export const CONNECTION_RULES: Record<NodeType, { allowedTargets: NodeType[]; allowedProtocols: EdgeProtocol[] }> = {
  [NodeType.TrafficGenerator]: {
    allowedTargets: [NodeType.LoadBalancer, NodeType.AppServer, NodeType.MessageQueue],
    allowedProtocols: [EdgeProtocol.Sync, EdgeProtocol.Async],
  },
  [NodeType.LoadBalancer]: {
    allowedTargets: [NodeType.AppServer],
    allowedProtocols: [EdgeProtocol.Sync],
  },
  [NodeType.AppServer]: {
    allowedTargets: [NodeType.Cache, NodeType.Database, NodeType.MessageQueue, NodeType.AppServer],
    allowedProtocols: [EdgeProtocol.Sync, EdgeProtocol.Async],
  },
  [NodeType.Cache]: {
    allowedTargets: [NodeType.Database],
    allowedProtocols: [EdgeProtocol.Sync],
  },
  [NodeType.Database]: {
    allowedTargets: [],  // Terminal node (sink)
    allowedProtocols: [],
  },
  [NodeType.MessageQueue]: {
    allowedTargets: [NodeType.AppServer],  // Consumer pulls from queue
    allowedProtocols: [EdgeProtocol.Async],
  },
};
```

#### Cycle Detection (Graph Validation)

Used before simulation start and during import to warn about circular topologies:

```typescript
/**
 * Detects cycles in the topology graph using iterative DFS.
 * Returns an array of node ID arrays representing each cycle found.
 * Empty array = acyclic graph.
 */
export function detectCycles(
  nodes: SimulationNode[],
  edges: EdgeData[],
): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();
  const cycles: string[][] = [];

  for (const node of nodes) {
    if (visited.has(node.id)) continue;

    const stack: { nodeId: string; path: string[] }[] = [
      { nodeId: node.id, path: [node.id] },
    ];

    while (stack.length > 0) {
      const { nodeId, path } = stack.pop()!;

      if (inStack.has(nodeId)) {
        // Extract the cycle portion of the path
        const cycleStart = path.indexOf(nodeId);
        cycles.push(path.slice(cycleStart));
        continue;
      }

      visited.add(nodeId);
      inStack.add(nodeId);

      const neighbors = adjacency.get(nodeId) ?? [];
      for (const neighbor of neighbors) {
        stack.push({ nodeId: neighbor, path: [...path, neighbor] });
      }

      // Note: For production, use Tarjan's or Kahn's for O(V+E).
      // This simplified DFS suffices for ≤200 nodes.
    }
    inStack.clear();
  }

  return cycles;
}
```

---

### Web Worker Discrete-Event Loop Algorithm

#### Core Data Structures

```typescript
// ─── Simulation Event ────────────────────────────────────────────

export enum SimEventType {
  RequestArrival = 'REQUEST_ARRIVAL',
  RequestEnqueue = 'REQUEST_ENQUEUE',
  RequestProcess = 'REQUEST_PROCESS',
  RequestRoute = 'REQUEST_ROUTE',
  RequestComplete = 'REQUEST_COMPLETE',
  RequestTimeout = 'REQUEST_TIMEOUT',
  RequestDrop = 'REQUEST_DROP',
  RequestLoopDetected = 'REQUEST_LOOP_DETECTED',
  ChaosStart = 'CHAOS_START',
  ChaosEnd = 'CHAOS_END',
  MetricsSnapshot = 'METRICS_SNAPSHOT',
}

export interface SimEvent {
  id: number;                // Monotonic event counter
  timestamp: number;         // Virtual time in milliseconds
  type: SimEventType;
  nodeId: string;            // Target node for this event
  requestId: string;         // Associated request (if applicable)
  payload: Record<string, unknown>;  // Event-specific data
}

// ─── Request Object ──────────────────────────────────────────────

export enum RequestStatus {
  InFlight = 'IN_FLIGHT',
  Success = 'SUCCESS',
  Timeout = 'TIMEOUT',
  Dropped = 'DROPPED',
  LoopDetected = 'LOOP_DETECTED',
  NoRoute = 'NO_ROUTE',
}

export interface SimRequest {
  id: string;                    // UUID
  originNodeId: string;          // Traffic Generator that spawned it
  createdAt: number;             // Virtual timestamp of creation
  completedAt?: number;          // Virtual timestamp of completion
  status: RequestStatus;
  hopCount: number;              // Incremented at each node traversal
  maxHops: number;               // Cycle guard (default 20)
  path: string[];                // Ordered list of node IDs visited
  accumulatedLatencyMs: number;  // Total latency so far
}

// ─── Min-Heap Priority Queue ─────────────────────────────────────

export class MinHeap<T> {
  private heap: T[] = [];

  constructor(private compareFn: (a: T, b: T) => number) {}

  get size(): number {
    return this.heap.length;
  }

  insert(item: T): void {
    this.heap.push(item);
    this.bubbleUp(this.heap.length - 1);
  }

  extractMin(): T | undefined {
    if (this.heap.length === 0) return undefined;
    const min = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.sinkDown(0);
    }
    return min;
  }

  peek(): T | undefined {
    return this.heap[0];
  }

  clear(): void {
    this.heap = [];
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parent = (index - 1) >>> 1;
      if (this.compareFn(this.heap[index], this.heap[parent]) >= 0) break;
      [this.heap[index], this.heap[parent]] = [this.heap[parent], this.heap[index]];
      index = parent;
    }
  }

  private sinkDown(index: number): void {
    const length = this.heap.length;
    while (true) {
      let smallest = index;
      const left = 2 * index + 1;
      const right = 2 * index + 2;
      if (left < length && this.compareFn(this.heap[left], this.heap[smallest]) < 0) {
        smallest = left;
      }
      if (right < length && this.compareFn(this.heap[right], this.heap[smallest]) < 0) {
        smallest = right;
      }
      if (smallest === index) break;
      [this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]];
      index = smallest;
    }
  }
}
```

#### Seeded PRNG (Deterministic Randomness)

Uses a 32-bit xoshiro128** algorithm for speed and determinism:

```typescript
/**
 * Seeded PRNG using xoshiro128** algorithm.
 * Produces deterministic float sequences in [0, 1) given a seed.
 */
export class SeededRNG {
  private state: Uint32Array;

  constructor(seed: number) {
    // SplitMix32 to initialize state from a single seed
    this.state = new Uint32Array(4);
    let s = seed >>> 0;
    for (let i = 0; i < 4; i++) {
      s += 0x9e3779b9;
      let t = s ^ (s >>> 16);
      t = Math.imul(t, 0x21f0aaad);
      t ^= t >>> 15;
      t = Math.imul(t, 0x735a2d97);
      t ^= t >>> 15;
      this.state[i] = t >>> 0;
    }
  }

  /** Returns a float in [0, 1) */
  next(): number {
    const result = this.rotl(this.state[1] * 5, 7) * 9;
    const t = this.state[1] << 9;
    this.state[2] ^= this.state[0];
    this.state[3] ^= this.state[1];
    this.state[1] ^= this.state[2];
    this.state[0] ^= this.state[3];
    this.state[2] ^= t;
    this.state[3] = this.rotl(this.state[3], 11);
    return (result >>> 0) / 0x100000000;
  }

  /** Poisson-distributed sample using inverse transform */
  poisson(lambda: number): number {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1.0;
    do {
      k++;
      p *= this.next();
    } while (p > L);
    return k - 1;
  }

  /** Normal distribution via Box-Muller transform */
  normal(mean: number, stdDev: number): number {
    const u1 = this.next();
    const u2 = this.next();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z * stdDev;
  }

  private rotl(x: number, k: number): number {
    return (x << k) | (x >>> (32 - k));
  }
}
```

#### Simulation Engine — Event Loop

```typescript
export enum SimState {
  Idle = 'IDLE',
  Running = 'RUNNING',
  Paused = 'PAUSED',
  Complete = 'COMPLETE',
}

export interface SimulationEngineConfig {
  topology: { nodes: SimulationNode[]; edges: EdgeData[] };
  seed: number;
  speedMultiplier: number;           // 1x, 2x, 5x, 10x, 50x
  maxSimulatedTimeMs: number;        // When to auto-stop (e.g., 10 min = 600,000ms)
  metricsIntervalMs: number;         // How often to emit metrics (simulated time)
  maxHopsPerRequest: number;         // Cycle guard (default 20)
}

/**
 * Core discrete-event simulation loop.
 * Runs inside a Web Worker. Communicates with main thread via postMessage.
 * 
 * Algorithm (simplified pseudocode):
 * 
 *   1. Initialize event queue with initial RequestArrival events from all TrafficGenerators.
 *   2. Schedule periodic MetricsSnapshot events at metricsIntervalMs intervals.
 *   3. LOOP:
 *      a. Extract the event with the smallest timestamp from the min-heap.
 *      b. Advance the virtual clock to that event's timestamp.
 *      c. Dispatch the event to the appropriate NodeProcessor.
 *      d. The processor may:
 *         - Modify node state (queue depth, pool occupancy, etc.)
 *         - Emit zero or more new events (enqueue, process, route, timeout)
 *         - Update the request's accumulated latency and path
 *      e. If the event is MetricsSnapshot, collect and postMessage metrics to main thread.
 *      f. Check termination conditions (empty queue, max sim time, or pause signal).
 *   4. On PAUSE: break loop, retain all state.
 *   5. On RESET: clear heap, requests map, node states, clock.
 */
export class SimulationEngine {
  private eventQueue: MinHeap<SimEvent>;
  private virtualClockMs: number = 0;
  private state: SimState = SimState.Idle;
  private rng: SeededRNG;
  private requests: Map<string, SimRequest> = new Map();
  private nodeStates: Map<string, NodeRuntimeState> = new Map();
  private eventCounter: number = 0;
  private config: SimulationEngineConfig;
  private metricsCollector: MetricsCollector;

  // Batch control: yield to message handling every N events
  private readonly BATCH_SIZE = 200;

  constructor(config: SimulationEngineConfig) {
    this.config = config;
    this.rng = new SeededRNG(config.seed);
    this.eventQueue = new MinHeap<SimEvent>((a, b) => a.timestamp - b.timestamp);
    this.metricsCollector = new MetricsCollector(config.topology.nodes);
    this.initializeNodeStates();
    this.scheduleInitialEvents();
  }

  /**
   * Main loop — processes events in batches, yielding control between batches
   * to allow the Worker to handle incoming postMessage commands (PAUSE, CHAOS, etc).
   */
  async run(): Promise<void> {
    this.state = SimState.Running;

    while (this.state === SimState.Running) {
      let processed = 0;

      while (processed < this.BATCH_SIZE && this.eventQueue.size > 0) {
        const event = this.eventQueue.extractMin()!;

        // Termination: exceeded max simulation time
        if (event.timestamp > this.config.maxSimulatedTimeMs) {
          this.state = SimState.Complete;
          this.postComplete();
          return;
        }

        this.virtualClockMs = event.timestamp;
        this.processEvent(event);
        processed++;
      }

      // Yield to event loop so postMessage handlers can run
      // This prevents PAUSE/RESET from being starved
      await this.yieldToMacroTask();

      // If queue is empty and all requests have resolved, simulation is complete
      if (this.eventQueue.size === 0) {
        this.state = SimState.Complete;
        this.postComplete();
        return;
      }
    }
  }

  private processEvent(event: SimEvent): void {
    switch (event.type) {
      case SimEventType.RequestArrival:
        this.handleRequestArrival(event);
        break;
      case SimEventType.RequestEnqueue:
        this.handleRequestEnqueue(event);
        break;
      case SimEventType.RequestProcess:
        this.handleRequestProcess(event);
        break;
      case SimEventType.RequestRoute:
        this.handleRequestRoute(event);
        break;
      case SimEventType.RequestComplete:
        this.handleRequestComplete(event);
        break;
      case SimEventType.RequestTimeout:
        this.handleRequestTimeout(event);
        break;
      case SimEventType.MetricsSnapshot:
        this.handleMetricsSnapshot(event);
        break;
      case SimEventType.ChaosStart:
      case SimEventType.ChaosEnd:
        this.handleChaosEvent(event);
        break;
    }
  }

  // ─── Event Handlers (sketched) ───────────────────────────────

  private handleRequestArrival(event: SimEvent): void {
    const node = this.getNodeConfig(event.nodeId) as TrafficGeneratorNode;
    const request: SimRequest = {
      id: event.requestId,
      originNodeId: event.nodeId,
      createdAt: event.timestamp,
      status: RequestStatus.InFlight,
      hopCount: 0,
      maxHops: this.config.maxHopsPerRequest,
      path: [event.nodeId],
      accumulatedLatencyMs: 0,
    };
    this.requests.set(request.id, request);

    // Route to first downstream node
    const outEdges = this.getOutgoingEdges(event.nodeId);
    if (outEdges.length === 0) {
      request.status = RequestStatus.NoRoute;
      request.completedAt = event.timestamp;
      this.metricsCollector.recordCompletion(request);
      return;
    }

    // Schedule route event to downstream
    this.scheduleEvent({
      type: SimEventType.RequestRoute,
      timestamp: event.timestamp, // No latency at generator
      nodeId: outEdges[0].target,
      requestId: request.id,
      payload: { fromEdge: outEdges[0].id },
    });

    // Schedule next arrival from this generator
    const interArrivalMs = this.computeInterArrival(node.config);
    this.scheduleEvent({
      type: SimEventType.RequestArrival,
      timestamp: event.timestamp + interArrivalMs,
      nodeId: event.nodeId,
      requestId: crypto.randomUUID(),
      payload: {},
    });
  }

  private handleRequestRoute(event: SimEvent): void {
    const request = this.requests.get(event.requestId)!;
    request.hopCount++;
    request.path.push(event.nodeId);

    // Cycle guard
    if (request.hopCount > request.maxHops) {
      request.status = RequestStatus.LoopDetected;
      request.completedAt = event.timestamp;
      this.metricsCollector.recordCompletion(request);
      return;
    }

    // Delegate to node-type-specific processor
    const nodeState = this.nodeStates.get(event.nodeId)!;
    nodeState.processor.onRequestArrived(event, request, this);
  }

  // ... Additional handlers follow the same delegation pattern ...

  // ─── Scheduling Helpers ──────────────────────────────────────

  scheduleEvent(partial: Omit<SimEvent, 'id'>): void {
    this.eventQueue.insert({
      ...partial,
      id: this.eventCounter++,
    });
  }

  private computeInterArrival(config: TrafficGeneratorConfig): number {
    const meanInterArrival = 1000 / config.rps; // ms
    switch (config.distribution) {
      case Distribution.Poisson:
        // Exponential inter-arrival (memoryless)
        return -meanInterArrival * Math.log(1 - this.rng.next());
      case Distribution.Uniform:
        return meanInterArrival;
    }
  }

  private yieldToMacroTask(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  // ─── Lifecycle ───────────────────────────────────────────────

  pause(): void {
    this.state = SimState.Paused;
  }

  resume(speedMultiplier: number): void {
    this.config.speedMultiplier = speedMultiplier;
    this.state = SimState.Running;
    this.run(); // Re-enters loop
  }

  reset(): void {
    this.state = SimState.Idle;
    this.virtualClockMs = 0;
    this.eventQueue.clear();
    this.requests.clear();
    this.eventCounter = 0;
    this.metricsCollector.reset();
    this.initializeNodeStates();
  }
}
```

#### Node Runtime State

Each node maintains mutable simulation state tracked by its processor:

```typescript
export interface NodeRuntimeState {
  nodeId: string;
  processor: NodeProcessor;

  // Resource utilization
  activeConnections: number;    // Database: current pool occupancy
  queuedRequests: string[];     // IDs of requests waiting in queue
  bufferedMessages: number;     // MessageQueue: current buffer fill

  // Metrics accumulators (reset each snapshot window)
  totalProcessed: number;
  totalDropped: number;
  totalTimedOut: number;
  latencySamples: number[];     // For percentile computation
}

/**
 * Interface implemented by each node-type processor.
 * Encapsulates the simulation logic for a specific component type.
 */
export interface NodeProcessor {
  onRequestArrived(event: SimEvent, request: SimRequest, engine: SimulationEngine): void;
  onChaosApplied(chaosType: string, params: Record<string, unknown>): void;
  onChaosReverted(): void;
  getUtilization(): number;  // 0.0–1.0 for health indicator computation
}
```

---

### Little's Law Queue Metrics Parser

#### Theory

Little's Law states that in a stable system:

```
L = λ × W
```

Where:
- **L** = average number of items in the system (queue length + in-service)
- **λ** = average arrival rate (requests/sec entering the node)
- **W** = average time a request spends in the system (wait + service)

We compute these per-node over sliding time windows to validate simulation correctness and surface bottleneck indicators.

#### Data Structures

```typescript
/**
 * Sliding-window metrics for a single node.
 * Maintains arrival/departure timestamps to compute L, λ, W in real-time.
 */
export interface LittlesLawMetrics {
  nodeId: string;

  // Current computed values
  L: number;      // Average queue length (items in system)
  lambda: number; // Arrival rate (requests/sec)
  W: number;      // Average sojourn time (ms)

  // Validation: L vs λ*W deviation (should be < 5% under steady state)
  deviation: number;         // |L - λW| / L as a percentage
  isStable: boolean;         // True if deviation < 5% over last window
}

export interface ArrivalRecord {
  requestId: string;
  arrivedAt: number;    // Virtual timestamp when request entered node
  departedAt?: number;  // Virtual timestamp when request left node
}

/**
 * Per-node metrics collector implementing Little's Law computation.
 * Uses a sliding time window for stability assessment.
 */
export class NodeMetricsAccumulator {
  private windowMs: number;                      // Sliding window size (e.g., 5000ms sim time)
  private arrivals: ArrivalRecord[] = [];        // Ring buffer of recent arrivals
  private currentOccupancy: number = 0;          // L: items currently in system at this node
  private occupancySamples: number[] = [];       // Sampled at each event for time-weighted avg

  // Time-weighted occupancy tracking
  private lastEventTime: number = 0;
  private weightedOccupancySum: number = 0;
  private windowStartTime: number = 0;

  constructor(
    public readonly nodeId: string,
    windowMs: number = 5000,
  ) {
    this.windowMs = windowMs;
  }

  /**
   * Called when a request enters this node (arrival event).
   */
  recordArrival(requestId: string, timestamp: number): void {
    this.updateWeightedOccupancy(timestamp);
    this.currentOccupancy++;
    this.arrivals.push({ requestId, arrivedAt: timestamp });
    this.pruneWindow(timestamp);
  }

  /**
   * Called when a request departs this node (processed, routed downstream, or dropped).
   */
  recordDeparture(requestId: string, timestamp: number): void {
    this.updateWeightedOccupancy(timestamp);
    this.currentOccupancy = Math.max(0, this.currentOccupancy - 1);

    const record = this.arrivals.find((a) => a.requestId === requestId);
    if (record) {
      record.departedAt = timestamp;
    }
  }

  /**
   * Computes Little's Law metrics over the current window.
   * Called at each MetricsSnapshot event.
   */
  compute(currentTime: number): LittlesLawMetrics {
    this.pruneWindow(currentTime);
    this.updateWeightedOccupancy(currentTime);

    const windowDuration = currentTime - this.windowStartTime;
    if (windowDuration <= 0) {
      return this.emptyMetrics();
    }

    // λ (lambda): arrival rate = arrivals in window / window duration (converted to per-sec)
    const arrivalsInWindow = this.arrivals.filter(
      (a) => a.arrivedAt >= this.windowStartTime,
    ).length;
    const lambda = arrivalsInWindow / (windowDuration / 1000);

    // W: average sojourn time of completed requests in window
    const completedInWindow = this.arrivals.filter(
      (a) => a.departedAt !== undefined && a.departedAt >= this.windowStartTime,
    );
    const W =
      completedInWindow.length > 0
        ? completedInWindow.reduce((sum, a) => sum + (a.departedAt! - a.arrivedAt), 0) /
          completedInWindow.length
        : 0;

    // L: time-weighted average occupancy over the window
    const L = windowDuration > 0
      ? this.weightedOccupancySum / windowDuration
      : this.currentOccupancy;

    // Deviation check: |L - λ*W/1000| / max(L, 1)
    // W is in ms, λ is in req/sec, so λ*W needs W in seconds: λ * (W/1000)
    const lambdaW = lambda * (W / 1000);
    const deviation = L > 0 ? Math.abs(L - lambdaW) / L : 0;

    return {
      nodeId: this.nodeId,
      L,
      lambda,
      W,
      deviation,
      isStable: deviation < 0.05, // < 5% deviation = stable
    };
  }

  reset(): void {
    this.arrivals = [];
    this.currentOccupancy = 0;
    this.occupancySamples = [];
    this.weightedOccupancySum = 0;
    this.lastEventTime = 0;
    this.windowStartTime = 0;
  }

  // ─── Private Helpers ─────────────────────────────────────────

  private updateWeightedOccupancy(timestamp: number): void {
    const dt = timestamp - this.lastEventTime;
    if (dt > 0) {
      this.weightedOccupancySum += this.currentOccupancy * dt;
    }
    this.lastEventTime = timestamp;
  }

  private pruneWindow(currentTime: number): void {
    this.windowStartTime = Math.max(0, currentTime - this.windowMs);
    // Remove records that are fully outside the window
    this.arrivals = this.arrivals.filter(
      (a) => (a.departedAt ?? currentTime) >= this.windowStartTime,
    );
    // Reset weighted sum for the new window start
    // (simplified: full recompute; optimize with circular buffer in production)
  }

  private emptyMetrics(): LittlesLawMetrics {
    return { nodeId: this.nodeId, L: 0, lambda: 0, W: 0, deviation: 0, isStable: true };
  }
}
```

#### Aggregate Metrics Collector

Orchestrates all per-node accumulators and produces the `METRICS_BATCH` payload:

```typescript
export interface PercentileStats {
  p50: number;
  p90: number;
  p99: number;
}

export interface NodeMetricsSnapshot {
  nodeId: string;
  timestamp: number;             // Virtual time of snapshot
  throughput: number;            // Successful requests/sec in window
  errorRate: number;             // (drops + timeouts) / total in window
  latencyPercentiles: PercentileStats;
  queueDepth: number;
  activeConnections: number;
  bufferOccupancy: number;       // For MessageQueue nodes
  utilization: number;           // 0.0–1.0
  littlesLaw: LittlesLawMetrics;
  healthStatus: 'green' | 'yellow' | 'red';
}

export interface MetricsBatchPayload {
  simulatedTimeMs: number;
  nodes: NodeMetricsSnapshot[];
  systemWide: {
    totalThroughput: number;
    endToEndLatency: PercentileStats;
    totalErrorRate: number;
    activeRequests: number;
  };
}

export class MetricsCollector {
  private accumulators: Map<string, NodeMetricsAccumulator> = new Map();
  private completedRequests: SimRequest[] = [];
  private windowMs: number = 5000;

  constructor(nodes: SimulationNode[]) {
    for (const node of nodes) {
      this.accumulators.set(node.id, new NodeMetricsAccumulator(node.id, this.windowMs));
    }
  }

  recordArrival(nodeId: string, requestId: string, timestamp: number): void {
    this.accumulators.get(nodeId)?.recordArrival(requestId, timestamp);
  }

  recordDeparture(nodeId: string, requestId: string, timestamp: number): void {
    this.accumulators.get(nodeId)?.recordDeparture(requestId, timestamp);
  }

  recordCompletion(request: SimRequest): void {
    this.completedRequests.push(request);
  }

  /**
   * Generates a full metrics batch for all nodes at the given simulation time.
   * Called from the MetricsSnapshot event handler.
   */
  generateBatch(
    currentTime: number,
    nodeStates: Map<string, NodeRuntimeState>,
  ): MetricsBatchPayload {
    const nodeSnapshots: NodeMetricsSnapshot[] = [];

    for (const [nodeId, accumulator] of this.accumulators) {
      const state = nodeStates.get(nodeId)!;
      const littlesLaw = accumulator.compute(currentTime);
      const utilization = state.processor.getUtilization();

      const snapshot: NodeMetricsSnapshot = {
        nodeId,
        timestamp: currentTime,
        throughput: state.totalProcessed / (this.windowMs / 1000),
        errorRate: this.computeErrorRate(state),
        latencyPercentiles: this.computePercentiles(state.latencySamples),
        queueDepth: state.queuedRequests.length,
        activeConnections: state.activeConnections,
        bufferOccupancy: state.bufferedMessages,
        utilization,
        littlesLaw,
        healthStatus: this.deriveHealthStatus(utilization, this.computeErrorRate(state)),
      };

      nodeSnapshots.push(snapshot);
    }

    return {
      simulatedTimeMs: currentTime,
      nodes: nodeSnapshots,
      systemWide: this.computeSystemWideMetrics(currentTime),
    };
  }

  reset(): void {
    for (const acc of this.accumulators.values()) {
      acc.reset();
    }
    this.completedRequests = [];
  }

  // ─── Private ─────────────────────────────────────────────────

  private computePercentiles(samples: number[]): PercentileStats {
    if (samples.length === 0) return { p50: 0, p90: 0, p99: 0 };
    const sorted = [...samples].sort((a, b) => a - b);
    return {
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p90: sorted[Math.floor(sorted.length * 0.9)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
    };
  }

  private computeErrorRate(state: NodeRuntimeState): number {
    const total = state.totalProcessed + state.totalDropped + state.totalTimedOut;
    if (total === 0) return 0;
    return (state.totalDropped + state.totalTimedOut) / total;
  }

  private deriveHealthStatus(
    utilization: number,
    errorRate: number,
  ): 'green' | 'yellow' | 'red' {
    if (utilization > 0.9 || errorRate >= 0.05) return 'red';
    if (utilization > 0.7 || errorRate > 0) return 'yellow';
    return 'green';
  }

  private computeSystemWideMetrics(currentTime: number) {
    const recentCompleted = this.completedRequests.filter(
      (r) => r.completedAt !== undefined && r.completedAt >= currentTime - this.windowMs,
    );
    const successful = recentCompleted.filter((r) => r.status === RequestStatus.Success);
    const latencies = successful.map((r) => r.accumulatedLatencyMs);

    return {
      totalThroughput: successful.length / (this.windowMs / 1000),
      endToEndLatency: this.computePercentiles(latencies),
      totalErrorRate:
        recentCompleted.length > 0
          ? recentCompleted.filter((r) => r.status !== RequestStatus.Success).length /
            recentCompleted.length
          : 0,
      activeRequests: [...this.accumulators.values()].reduce(
        (sum, acc) => sum + acc['currentOccupancy'],
        0,
      ),
    };
  }
}
```

---

### Worker Communication Protocol (TypeScript Types)

```typescript
// ─── Main Thread → Worker Messages ──────────────────────────────

export type MainToWorkerMessage =
  | { type: 'INIT'; payload: SimulationEngineConfig }
  | { type: 'START'; payload: { speedMultiplier: number } }
  | { type: 'PAUSE' }
  | { type: 'RESUME'; payload: { speedMultiplier: number } }
  | { type: 'RESET' }
  | { type: 'CHAOS_EVENT'; payload: ChaosEventPayload }
  | { type: 'UPDATE_CONFIG'; payload: { nodeId: string; config: Partial<SimulationNode['config']> } };

export interface ChaosEventPayload {
  chaosType: 'FLUSH_CACHE' | 'DROP_DB' | 'SPIKE_TRAFFIC';
  targetNodeId?: string;   // Optional: specific node, or all of type
  durationMs: number;      // Simulated duration
  params: Record<string, unknown>;
}

// ─── Worker → Main Thread Messages ──────────────────────────────

export type WorkerToMainMessage =
  | { type: 'METRICS_BATCH'; payload: MetricsBatchPayload }
  | { type: 'NODE_STATUS'; payload: { nodeId: string; status: 'green' | 'yellow' | 'red' } }
  | { type: 'EVENT_LOG'; payload: SimEventLogEntry[] }
  | { type: 'SIM_COMPLETE'; payload: SimulationSummary }
  | { type: 'ERROR'; payload: { message: string; stack?: string } };

export interface SimEventLogEntry {
  id: number;
  timestamp: number;       // Virtual time
  type: SimEventType;
  nodeId: string;
  requestId?: string;
  message: string;         // Human-readable description
}

export interface SimulationSummary {
  totalEvents: number;
  totalRequests: number;
  successRate: number;
  avgEndToEndLatencyMs: number;
  simulatedDurationMs: number;
  wallClockDurationMs: number;
  eventsPerSecond: number;     // Performance metric
}
```

---

### File Structure (Proposed)

```
src/
├── main.tsx                           # App entry point
├── App.tsx                            # Root layout
├── components/
│   ├── canvas/
│   │   ├── CanvasEditor.tsx           # React Flow wrapper
│   │   ├── NodePalette.tsx            # Drag source sidebar
│   │   ├── nodes/                     # Custom React Flow node components
│   │   │   ├── TrafficGeneratorNode.tsx
│   │   │   ├── LoadBalancerNode.tsx
│   │   │   ├── AppServerNode.tsx
│   │   │   ├── CacheNode.tsx
│   │   │   ├── DatabaseNode.tsx
│   │   │   └── MessageQueueNode.tsx
│   │   └── edges/
│   │       ├── SyncEdge.tsx
│   │       └── AsyncEdge.tsx
│   ├── config/
│   │   └── NodeConfigPanel.tsx        # Configuration sidebar
│   ├── controls/
│   │   ├── SimulationToolbar.tsx      # Start/Pause/Reset/Speed
│   │   └── ChaosPanel.tsx            # Chaos injection buttons
│   ├── telemetry/
│   │   ├── TelemetryDashboard.tsx     # Chart container
│   │   ├── LatencyChart.tsx
│   │   ├── ThroughputChart.tsx
│   │   ├── QueueGauge.tsx
│   │   └── EventLog.tsx
│   └── presets/
│       └── PresetSelector.tsx
├── store/
│   ├── topologyStore.ts               # Zustand: nodes, edges, canvas state
│   ├── simulationStore.ts             # Zustand: sim state, metrics, event log
│   └── persistenceStore.ts            # Zustand: save/load/export
├── simulation/
│   ├── simulation.worker.ts           # Web Worker entry point
│   ├── engine.ts                      # SimulationEngine class
│   ├── eventQueue.ts                  # MinHeap implementation
│   ├── prng.ts                        # SeededRNG
│   ├── processors/
│   │   ├── NodeProcessor.ts           # Interface
│   │   ├── TrafficGeneratorProcessor.ts
│   │   ├── LoadBalancerProcessor.ts
│   │   ├── AppServerProcessor.ts
│   │   ├── CacheProcessor.ts
│   │   ├── DatabaseProcessor.ts
│   │   └── MessageQueueProcessor.ts
│   ├── metrics/
│   │   ├── MetricsCollector.ts
│   │   ├── NodeMetricsAccumulator.ts  # Little's Law per-node
│   │   └── percentiles.ts
│   └── types.ts                       # All simulation type definitions
├── validation/
│   ├── edgeValidation.ts              # validateEdgeConnection, CONNECTION_RULES
│   ├── cycleDetection.ts             # detectCycles
│   └── configValidation.ts            # Per-node config validators
├── presets/
│   ├── dbExhaustion.json
│   ├── queueBackpressure.json
│   └── cacheStampede.json
├── types/
│   ├── nodes.ts                       # SimulationNode union, configs
│   ├── edges.ts                       # EdgeData, EdgeProtocol
│   ├── messages.ts                    # Worker protocol types
│   └── metrics.ts                     # MetricsBatchPayload, etc.
└── utils/
    ├── uuid.ts
    └── localStorage.ts                # Schema-versioned persistence helpers
```

---

## Data Models

The core data models are defined above in the Components and Interfaces section. Here is a summary of the key model relationships:

- **SimulationNode** — discriminated union of 6 node types, each with a type-specific config interface
- **EdgeData** — directed connection between nodes with a protocol discriminator (Sync/Async)
- **SimEvent** — the unit of work in the discrete-event loop, ordered by virtual timestamp in a min-heap
- **SimRequest** — tracks a single request's lifecycle across the topology graph, accumulating latency and hop path
- **NodeRuntimeState** — mutable per-node state (queue depth, pool occupancy, buffered messages, metrics accumulators)
- **MetricsBatchPayload** — periodic snapshot emitted from worker to main thread with per-node and system-wide metrics
- **LittlesLawMetrics** — per-node computed values (L, λ, W) with stability deviation tracking

All models use TypeScript interfaces/enums for compile-time safety. The discriminated union pattern on `nodeType` enables exhaustive matching in both the UI config panel and simulation processors.

---

## Correctness Properties

- **Determinism**: Given the same seed and topology, the simulation produces identical event sequences and metrics. Guaranteed by the seeded xoshiro128** PRNG and deterministic min-heap ordering (timestamp-based, tie-broken by monotonic event ID).
- **Little's Law Validation**: For each node in steady state, the deviation |L - λW| / L must remain below 5%. This validates that the simulation's queuing behavior is internally consistent.
- **Cycle Guard**: Requests traversing more than `maxHops` (default 20) are terminated with `LoopDetected` status, preventing infinite loops in cyclic topologies.
- **Event Ordering**: The min-heap guarantees events are always processed in non-decreasing timestamp order. Events with equal timestamps are processed in insertion order (FIFO via monotonic ID).
- **Resource Conservation**: Active connections never exceed pool size; buffer occupancy never exceeds capacity. Overflow triggers backpressure or drop behavior per node configuration.
- **Graph Validity**: Edges must conform to the connection compatibility matrix. Self-referencing edges and duplicate connections are rejected. Cycle detection warns users before simulation start.

---

## Error Handling

- **Worker Errors**: Uncaught exceptions in the Web Worker are caught and forwarded to the main thread via `{ type: 'ERROR', payload: { message, stack } }`. The simulation transitions to `Complete` state and surfaces the error in the UI.
- **Invalid Topology**: If the graph has no traffic generators or disconnected components, simulation initialization rejects with a descriptive validation error before entering the event loop.
- **Queue Overflow**: When a node's request queue exceeds `requestQueueDepth`, incoming requests are dropped with `RequestDrop` events and counted in the error rate metric.
- **Connection Pool Exhaustion**: When all database connections are occupied, requests are queued up to `requestQueueDepth`. If the queue is also full, requests are dropped. Lock timeouts produce `RequestTimeout` events.
- **Message Queue Backpressure**: When buffer occupancy exceeds `backpressureThresholdPct`, the configured strategy is applied (DROP_OLDEST removes the oldest buffered message, BLOCK_PRODUCER delays the producer event, REJECT_NEW drops the incoming message).
- **No Route**: If a traffic generator has no outgoing edges, requests are immediately marked `NoRoute` and recorded as errors.
- **Import Validation**: JSON topology imports are validated against the connection rules and config constraints. Invalid imports surface specific validation errors without corrupting the store.

---

## Testing Strategy

- **Unit Tests**: Each processor, the MinHeap, SeededRNG, NodeMetricsAccumulator, and edge/cycle validators are tested in isolation using Vitest. Tests verify deterministic output given fixed seeds and inputs.
- **Integration Tests**: The SimulationEngine is tested end-to-end with small topologies (2-5 nodes), verifying that metrics converge to expected steady-state values and that Little's Law deviation stays below threshold.
- **PRNG Determinism Tests**: Run the same seed twice and assert byte-identical event sequences.
- **Boundary Tests**: Zero RPS, max pool size, empty topology, single-node topology, fully saturated queues, and maximum hop count scenarios.
- **Performance Benchmarks**: Verify that the engine processes ≥1,000 events/sec (wall clock) for topologies up to 200 nodes, measured via `eventsPerSecond` in `SimulationSummary`.
- **Worker Communication Tests**: Mock `postMessage` to verify the correct message sequence (INIT → START → METRICS_BATCH* → SIM_COMPLETE) and that PAUSE/RESUME/RESET commands are handled within one batch cycle.

---

## Design Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| Discriminated union for nodes (`nodeType` field) | Enables exhaustive `switch` in processors; TypeScript narrows config type automatically. |
| Min-heap over sorted array | O(log n) insert/extract vs O(n) for insertion sort; critical at 1,000+ events/sec. |
| xoshiro128** PRNG over `Math.random()` | Seedable and deterministic; Math.random is implementation-defined and non-reproducible. |
| Batch processing with `setTimeout(0)` yield | Prevents Worker message starvation; allows PAUSE/CHAOS to be handled between batches. |
| Sliding-window metrics (not cumulative) | Reflects current system behavior, not historical averages; surfaces transient bottlenecks. |
| Time-weighted average for L (Little's Law) | Queue length changes discretely; simple average over events would bias toward brief spikes. |
| Edge validation at creation time AND import time | Dual enforcement: interactive UX prevents mistakes, import validation guards against external corruption. |
| Separate `types/` directory from `simulation/` | Keeps type definitions importable by both main thread (React) and Worker without pulling in engine logic. |
| Zustand over Redux | Lower ceremony for pub-sub patterns; selectors prevent unnecessary re-renders of canvas during metric updates. |

---

## Traceability Matrix

| Requirement | Design Section | Key Types/Functions |
|-------------|---------------|---------------------|
| US-1 (Node Placement) | §2.1, §7 (components/canvas) | `SimulationNode`, `BaseNodeData` |
| US-2 (Edge Connections) | §3.1, §3.2 | `EdgeData`, `validateEdgeConnection()` |
| US-3 (Node Configuration) | §2.1 (config interfaces) | `TrafficGeneratorConfig`, etc. |
| US-4 (Sim Lifecycle) | §4.3 (engine lifecycle) | `SimulationEngine.pause/resume/reset` |
| US-5 (Priority Queue) | §4.1, §4.3 | `MinHeap<SimEvent>`, event loop |
| US-6 (Little's Law) | §5 | `NodeMetricsAccumulator.compute()` |
| US-7 (Telemetry Charts) | §5.3 | `MetricsBatchPayload`, `PercentileStats` |
| US-8 (Health Indicators) | §5.3 | `deriveHealthStatus()` |
| US-10 (Chaos Injection) | §6 | `ChaosEventPayload`, `MainToWorkerMessage` |
| EC-1 (Circular Loops) | §3.3 | `detectCycles()`, `maxHops` guard |
| EC-3 (Zero Pool Size) | §3.2, validation | `configValidation.ts` |
| PB-1 (1,000 events/sec) | §4.3 (batch processing) | `BATCH_SIZE`, `yieldToMacroTask()` |
| PB-4 (Determinism) | §4.2 | `SeededRNG` |
