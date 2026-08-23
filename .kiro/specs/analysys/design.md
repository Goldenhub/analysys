
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
│  │  │  • ApiGatewayProcessor                              │  │  │
│  │  │  • RateLimiterProcessor                             │  │  │
│  │  │  • LoadBalancerProcessor                            │  │  │
│  │  │  • CircuitBreakerProcessor                          │  │  │
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
  ApiGateway = 'API_GATEWAY',
  RateLimiter = 'RATE_LIMITER',
  LoadBalancer = 'LOAD_BALANCER',
  CircuitBreaker = 'CIRCUIT_BREAKER',
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

export interface ApiGatewayConfig {
  authLatencyMeanMs: number;         // 0–60,000
  authLatencyStdDevMs: number;       // 0–30,000
  rejectionRate: number;             // 0.0–1.0, fraction rejected as unauthorized
}

export interface RateLimiterConfig {
  bucketCapacity: number;            // 1–1,000,000, the maximum burst admitted
  refillRatePerSec: number;          // 1–1,000,000, the sustained rate allowed
}

export interface LoadBalancerConfig {
  algorithm: LBAlgorithm;
  healthCheckIntervalMs: number;     // ms between health checks
  evictionThreshold: number;         // consecutive failures before eviction
}

export interface CircuitBreakerConfig {
  errorThreshold: number;            // 0.0–1.0 downstream error rate that trips
  openDurationMs: number;            // 100–300,000 before probing resumes
  probeCount: number;                // 1–1,000 requests allowed while half-open
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

export interface ApiGatewayNode extends BaseNodeData {
  nodeType: NodeType.ApiGateway;
  config: ApiGatewayConfig;
}

export interface RateLimiterNode extends BaseNodeData {
  nodeType: NodeType.RateLimiter;
  config: RateLimiterConfig;
}

export interface LoadBalancerNode extends BaseNodeData {
  nodeType: NodeType.LoadBalancer;
  config: LoadBalancerConfig;
}

export interface CircuitBreakerNode extends BaseNodeData {
  nodeType: NodeType.CircuitBreaker;
  config: CircuitBreakerConfig;
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
  | ApiGatewayNode
  | RateLimiterNode
  | LoadBalancerNode
  | CircuitBreakerNode
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
    allowedTargets: [
      NodeType.ApiGateway,
      NodeType.RateLimiter,
      NodeType.CircuitBreaker,
      NodeType.LoadBalancer,
      NodeType.AppServer,
      NodeType.MessageQueue,
    ],
    allowedProtocols: [EdgeProtocol.Sync, EdgeProtocol.Async],
  },
  [NodeType.ApiGateway]: {
    allowedTargets: [
      NodeType.RateLimiter,
      NodeType.CircuitBreaker,
      NodeType.LoadBalancer,
      NodeType.AppServer,
    ],
    allowedProtocols: [EdgeProtocol.Sync],
  },
  [NodeType.RateLimiter]: {
    allowedTargets: [NodeType.CircuitBreaker, NodeType.LoadBalancer, NodeType.AppServer],
    allowedProtocols: [EdgeProtocol.Sync],
  },
  [NodeType.LoadBalancer]: {
    allowedTargets: [NodeType.AppServer, NodeType.CircuitBreaker],
    allowedProtocols: [EdgeProtocol.Sync],
  },
  [NodeType.CircuitBreaker]: {
    allowedTargets: [
      NodeType.AppServer,
      NodeType.Database,
      NodeType.Cache,
      NodeType.MessageQueue,
    ],
    allowedProtocols: [EdgeProtocol.Sync, EdgeProtocol.Async],
  },
  [NodeType.AppServer]: {
    allowedTargets: [
      NodeType.Cache,
      NodeType.Database,
      NodeType.MessageQueue,
      NodeType.AppServer,
      NodeType.CircuitBreaker,
    ],
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

### Complete-Architecture Extension — Change Surface (Requirements 23–43)

Requirements 1–22 are implemented and shipped. Everything from this subsection to the end of
Components and Interfaces describes the extension that adds six node types, multi-target routing,
subsystem grouping, and the analysis layer. The sections above remain the authoritative description
of the existing engine; this extension is written against that engine as it actually behaves.

#### Exhaustive-Match Sites

`NodeType` is a discriminated-union tag matched exhaustively in several places. Growing the union
from 9 to 15 members produces a compile error at each site, which is the intended mechanism: the
type checker enumerates the work. These are the sites, and each must be extended for all six new
types before the build passes.

| Site | Shape | What must be added |
|------|-------|--------------------|
| `src/simulation/engine.ts` → `createProcessor` | `switch (node.nodeType)` with no `default` | One `case` per new type returning its processor |
| `src/validation/edgeValidation.ts` → `CONNECTION_RULES` | `Record<NodeType, {allowedTargets, allowedProtocols}>` | One entry per new type (see Requirement 30 subsection) |
| `src/validation/configValidation.ts` → `validateNodeConfig` | `switch` over all types | One `case` per new type calling its validator |
| `src/validation/configValidation.ts` → `normalizeConfig` | `switch` over all types | One `case` per new type clamping every numeric parameter |
| `src/types/nodeDefaults.ts` → `createDefaultNodeData` | `switch` over all types | One `case` per new type returning defaults inside the R23–R28 ranges |
| `src/components/config/NodeConfigPanel.tsx` → `NODE_TYPE_LABELS` | `Record<NodeType, string>` | Display label per new type |
| `src/components/config/NodeConfigPanel.tsx` → `NodeTypeIcon` | `switch` returning SVG | Distinct icon per new type |
| `src/components/config/NodeConfigPanel.tsx` → `UTILIZATION_NOTES` | `Record<NodeType, string>` | Plain-language note on what Utilization measures (R29.10–13) |
| `src/components/canvas/CanvasEditor.tsx` → `nodeTypes` | `NodeTypes` registry | Custom React Flow node component per new type |
| `src/components/canvas/NodePalette.tsx` → `PALETTE_CATEGORIES` | Array of categories | Regroup into the five R29.1 groups and add the six items |
| `src/validation/edgeValidation.test.ts` → `makeNode` | `switch` building a fixture per type | Fixture config per new type |

`NodeConfigPanel` additionally renders one `<XForm>` per type through a chain of
`nodeData.nodeType === …` guards rather than a `switch`, so it will *not* fail to compile when the
union grows. Six new form components must be added and wired there deliberately; the same applies
to `VALIDATION_RULES`, which is keyed `Record<string, …>` and so is also not exhaustiveness-checked.
Both are called out here because the compiler will not.

#### Design Constraints Inherited From the Existing Engine

These are properties of the shipped engine that the extension must not break.

- **Response traversal is linear over `SimRequest.path`.** `startResponseTraversal` walks `path`
  backwards one index per `ResponseRoute` event, adding `rng.normalPositive(2, 0.5)` ms per hop.
  Fan-out turns the request lineage into a tree; the design keeps the *parent's* traversal linear by
  giving each branch its own `path` rooted at the fan-out node (see Requirement 32 subsection).
- **`ResponseComplete` owns the in-flight decrement on every success path;
  `handleRequestRoute` decrements only failures.** `markRequestDone` is idempotent via
  `countedAsComplete`. Branch accounting must not route branches through either decrement point.
- **A final metrics snapshot is emitted before `emitComplete()` on both exit paths** (max-sim-time
  exceeded and empty queue). That final window is usually shorter than `metricsIntervalMs`.
- **Per-node counters reset at every window boundary** (`totalProcessed`, `totalDropped`,
  `totalTimedOut`, `latencySamples`, plus `processor.resetWindowCounters?.()`), and throughput
  divides by `elapsedSinceLastBatch`. The window is `metricsIntervalMs`, which callers set
  independently: `SimulationToolbar` sends 500 ms and `PresetSelector` sends 1,000 ms, so no rule
  may assume a fixed window length — the reference presets of Requirement 42 must therefore set a
  duration and interval whose product spans at least 3 completed windows.
  `CircuitBreakerProcessor.MIN_OBSERVATIONS = 10` exists
  precisely because a freshly reset window leaves `total === 0` and acting on that made the breaker
  flap. Every new per-window rate carries the same hazard; the Analysis Engine subsection states the
  minimum-sample rule that answers it.
- **Engine tests must pass `disablePacing: true`.** Without it `yieldToMacroTask` sleeps
  `max(1, 50 / speedMultiplier)` ms per 200-event batch for UI pacing, and the events-per-second
  benchmark fails in CI.
- **`buildAdjacency` preserves serialized edge order.** `adjacency.get(nodeId)` is already the
  node's outgoing edges in ascending stored index order, which is what the routing policies of
  Requirement 32 are defined over. Persistence must therefore preserve edge array order.

---

### Six New Node Types (Requirements 23–28)

#### Enum and Union Additions

```typescript
// src/types/nodes.ts — additions to the existing enum
export enum NodeType {
  // …existing nine…
  AuthService = 'AUTH_SERVICE',
  AuthzService = 'AUTHZ_SERVICE',
  WorkerPool = 'WORKER_POOL',
  DeadLetterQueue = 'DEAD_LETTER_QUEUE',
  ObjectStore = 'OBJECT_STORE',
  Scheduler = 'SCHEDULER',
}

export enum VerificationMode { Local = 'LOCAL', Introspection = 'INTROSPECTION' }
export enum RetryBackoff { Fixed = 'FIXED', Exponential = 'EXPONENTIAL' }
export enum RedriveMode { Manual = 'MANUAL', Automatic = 'AUTOMATIC' }
export enum OverlapPolicy { Allow = 'ALLOW', Skip = 'SKIP', Queue = 'QUEUE' }

/** Per-node downstream routing policy (Requirement 32). Lives on BaseNodeData, not on config,
 *  because it is cross-cutting: the engine applies it, not the node processor. */
export enum RoutingPolicy {
  First = 'FIRST',
  RoundRobin = 'ROUND_ROBIN',
  Weighted = 'WEIGHTED',
  FanOut = 'FAN_OUT',
}

export interface BaseNodeData {
  id: string;
  nodeType: NodeType;
  label: string;
  position: { x: number; y: number };
  /** R32.1 — defaults to First on placement; defaulted to First on schema v1 load (R32.13). */
  routingPolicy: RoutingPolicy;
}
```

`routingPolicy` is added to `BaseNodeData` rather than to each config interface so that a single
engine-side resolver reads it for every node type, and so `UPDATE_CONFIG` (which merges into
`node.config`) cannot silently change routing mid-run.

#### Configuration Interfaces

```typescript
export interface AuthServiceConfig {
  verificationMode: VerificationMode;
  verificationLatencyMeanMs: number;    // 0–60,000
  verificationLatencyStdDevMs: number;  // 0–30,000
  concurrencyLimit: number;             // 1–10,000
  queueDepth: number;                   // 0–10,000
  tokenCacheHitRatio: number;           // 0.0–1.0, applied only in Introspection mode
  credentialFailureRate: number;        // 0.0–1.0
}

export interface AuthzServiceConfig {
  policyLatencyMeanMs: number;          // 0–60,000
  policyLatencyStdDevMs: number;        // 0–30,000
  policyCacheHitRatio: number;          // 0.0–1.0
  lookupsPerRequest: number;            // 1–50
  denyRate: number;                     // 0.0–1.0
  concurrencyLimit: number;             // 1–10,000
  queueDepth: number;                   // 0–10,000
}

export interface WorkerPoolConfig {
  concurrency: number;                  // 1–10,000
  jobProcessingMeanMs: number;          // 0–600,000
  jobProcessingStdDevMs: number;        // 0–300,000
  prefetchBufferDepth: number;          // 0–10,000
  jobFailureRate: number;               // 0.0–1.0
  maxRetries: number;                   // 0–10
  retryBackoff: RetryBackoff;
  retryBaseDelayMs: number;             // 1–300,000
  jobTimeoutMs: number;                 // 1–600,000
}

export interface DeadLetterQueueConfig {
  capacity: number;                     // 1–1,000,000
  retentionPeriodMs: number;            // 1–2,592,000,000
  redriveMode: RedriveMode;
  redriveIntervalMs: number;            // 1–300,000
  redriveBatchSize: number;             // 1–10,000
  maxRedriveAttempts: number;           // 0–10
}

export interface ObjectStoreConfig {
  objectSizeMeanKB: number;             // 1–10,485,760
  objectSizeStdDevKB: number;           // 0–10,485,760
  throughputCapacityMBps: number;       // 0.1–100,000
  baseLatencyMeanMs: number;            // 0–60,000
  baseLatencyStdDevMs: number;          // 0–30,000
  maxConcurrentTransfers: number;       // 1–100,000
  transferQueueDepth: number;           // 0–10,000
  readFraction: number;                 // 0.0–1.0
  writeLatencyMultiplier: number;       // 1.0–100.0
}

export interface SchedulerConfig {
  intervalMs: number;                   // 100–86,400,000
  jobsPerTrigger: number;               // 1–100,000
  startOffsetMs: number;                // 0–86,400,000
  jitterMs: number;                     // 0–86,400,000
  overlapPolicy: OverlapPolicy;
  maxDeferredTriggers: number;          // 1–1,000
}
```

Each gets a `…Node extends BaseNodeData` member added to the `SimulationNode` union, a validator in
`configValidation.ts`, a clamping branch in `normalizeConfig`, and a `createDefaultNodeData` case.
`createDefaultNodeData` is the single source of defaults, already shared by the canvas drop handler
and the palette's keyboard path, which is what satisfies R29.4 for free.

Defaults are chosen so that R29.5 holds — a lone new node wired to a default source runs 60
simulated seconds and terminates at least one request without saturating:

| Type | Defaults |
|------|----------|
| Auth_Service | Local, 3 ms ± 1, concurrency 64, queue 100, token cache 0.9, credential failure 0.01 |
| Authz_Service | 4 ms ± 1.5, policy cache 0.9, 1 lookup, deny 0.01, concurrency 64, queue 100 |
| Worker_Pool | concurrency 8, 200 ms ± 50, prefetch 100, failure 0.02, 3 retries, Exponential, 1,000 ms base, 30,000 ms timeout |
| Dead_Letter_Queue | capacity 10,000, retention 86,400,000 ms, Manual, 60,000 ms interval, batch 10, 3 max redrives |
| Object_Store | 256 KB ± 64, 100 MB/s, 10 ms ± 3, 64 concurrent, queue 100, read 0.8, write ×1.5 |
| Scheduler | 60,000 ms interval, 50 jobs, 0 offset, 0 jitter, Skip, 10 max deferred |

#### Utilization Mapping (Requirement 29.10–29.15)

`getUtilization()` already exists on `NodeProcessor` and returns a plain `number`. R29.11–13 require
*not applicable* to be distinguishable from `0.0`, which a bare number cannot express. The return
type widens:

```typescript
export type UtilizationReading =
  | { kind: 'value'; value: number; idle: boolean }      // idle: bound > 0 but no arrivals this window
  | { kind: 'not-applicable'; reason: string };          // plain-language, names the zero/missing bound

export interface NodeProcessor {
  onRequestArrived(event: SimEvent, request: SimRequest, context: ProcessorContext): void;
  onChaosApplied(chaosType: string, params: Record<string, unknown>): void;
  onChaosReverted(): void;
  getUtilization(): UtilizationReading;
  resetWindowCounters?(): void;
  /** R26.5 — retention expiry is evaluated on the window schedule, before counters reset. */
  onMetricsWindowBoundary?(context: ProcessorContext): void;
  /** R39.9 / R39.11 — DISABLE_NODE chaos. Returns the request IDs the node was holding. */
  onNodeDisabled?(context: ProcessorContext): string[];
  onNodeRestored?(context: ProcessorContext): void;
}
```

`NodeMetricsSnapshot.utilization` becomes `UtilizationReading`, and the nine existing processors
return `{ kind: 'value', value, idle }`. Bounded resource per new type: occupied concurrency slots
over `concurrencyLimit` (Auth_Service, Authz_Service), executing Jobs over `concurrency`
(Worker_Pool), retained messages over `capacity` (Dead_Letter_Queue), aggregate transfer rate over
`throughputCapacityMBps` (Object_Store), and `not-applicable` for Scheduler, which holds no bounded
resource. Health status derives from the reading and the error rate through the existing
`deriveHealthStatus` thresholds; where the reading is `not-applicable`, health derives from the
error rate alone (R29.15).

#### Auth_Service Processor (Requirement 23)

State: `slots: Map<requestId, {startedAt}>` bounded by `concurrencyLimit`; `queue: string[]`
bounded by `queueDepth`; per-window `cacheHits`, `cacheMisses`, `verifications`,
`unauthenticatedCount`.

```
onRequestArrived(request):
  recordArrival
  if slots.size < concurrencyLimit:  admit(request, now)
  else if queue.length < queueDepth: queue.push(request.id)          # waiting time added on admit
  else: terminate Dropped at this node, add no verification latency  # R23.8

admit(request, t):
  slots.set(request.id, { startedAt: t })
  request.accumulatedLatencyMs += (t - arrivalTime(request))         # queue wait, R23.7
  latency = max(0, rng.normalPositive(mean, stdDev))                 # draw 1 — R23.2
  request.accumulatedLatencyMs += latency
  schedule VerificationComplete at t + latency

onVerificationComplete(request):
  if mode is Introspection:
    hit = rng.next() < tokenCacheHitRatio                            # draw 2 — R23.6
    if not hit:
      if no outgoing edge: terminate NO_ROUTE, release slot          # R23.10
      else: dispatch ONE sub-request along the routed edge, keep slot occupied,
            count it as one hop against the parent's maxHops         # R23.5
            return                                                   # credential test deferred
  applyCredentialTest(request)

applyCredentialTest(request):
  if rng.next() < credentialFailureRate:                             # draw 3 — R23.3
    terminate Unauthenticated at this node
  else:
    forward along the routed edge (or terminate NO_ROUTE)
  release slot; admit longest-waiting queued request

onSubRequestSettled(parent, branch):
  release nothing yet — slot stays occupied
  if branch.status is Success: applyCredentialTest(parent)
  else: terminate parent Unauthenticated, record an error here       # R23.11
```

The PRNG draw order is fixed at verification latency, then token cache test, then credential test
(R23.12). The introspection call is *not* a bespoke mechanism: it is one sub-request dispatched
through the shared sub-request machinery described in the Requirement 32 subsection, with a policy
that maps a failed branch to `Unauthenticated` instead of propagating the branch's status.

#### Authz_Service Processor (Requirement 24)

Same slot-and-queue shape as Auth_Service. The difference is fan-out width and failure mapping:
on a policy cache miss with at least one outgoing edge it dispatches exactly `lookupsPerRequest`
sub-requests at one simulated timestamp, each target selected by the node's routing policy, and
resumes only when all have settled, adding the *greatest* settle interval to the parent
(R24.4 — identical arithmetic to R32.9). With no outgoing edge, a miss is recorded as a
*lookup-unavailable evaluation*, counted separately from cache hits (R24.5). A non-success lookup
propagates that lookup's terminal status to the parent along with the lookup target's identifier
(R24.7). The deny test runs only after every lookup has settled successfully (R24.6), so a denied
request has already paid the policy latency and the lookup latency.

Amplification ratio for the window is `lookupCallsIssued / requestsAdmitted`, reported as
*not applicable* rather than `0` when no request was admitted (R24.10) — the same
zero-versus-missing distinction `UtilizationReading` makes.

#### Worker_Pool Processor (Requirement 25)

This is the most stateful of the six. It holds three disjoint populations of Jobs, and the
distinction between them is what makes the Job_Backlog and Drain_Time figures meaningful.

```typescript
interface WorkerPoolState {
  executing: Map<string, { attemptNo: number; startedAt: number; epoch: number }>; // ≤ concurrency
  prefetch: string[];                                    // FIFO, ≤ prefetchBufferDepth
  retryWaiting: Array<{ jobId: string; readyAt: number; attemptNo: number }>; // sorted by readyAt
  attempts: Map<string, number>;                         // total attempts per Job
  epoch: Map<string, number>;                            // invalidates stale timeout events
}
```

- **Admission order (R25.2):** first any Job in `retryWaiting` whose `readyAt` has elapsed, in
  ascending `readyAt`; then `prefetch` in ascending enqueue time. Retry-ready Jobs are held *outside*
  `prefetch` so they count against neither `prefetchBufferDepth` nor the Job_Backlog (R25.15), and
  the elapsed retry delay is added to the Job's accumulated latency.
- **Attempt (R25.14):** on admission, draw a processing time independently for that attempt, clamp
  at 0 ms, occupy one slot, and schedule both `JobAttemptComplete` at `t + processing` and
  `JobTimeout` at `t + jobTimeoutMs`. Both carry the attempt's `epoch`; whichever fires first
  increments the epoch, so the loser is discarded as stale. The timeout is measured from slot
  occupancy, excluding prefetch wait and retry delay (R25.10).
- **Failure and backoff (R25.5–R25.7, R25.16):** draw one value per attempt against
  `jobFailureRate`. On failure with attempts `< maxRetries + 1`, **release the slot first**, then
  schedule `JobRetryReady` at `t + delay`, where delay is `retryBaseDelayMs` for Fixed and
  `retryBaseDelayMs * 2^(n-1)` capped at 300,000 ms for Exponential, no jitter in either case.
  Releasing before the delay is what lets a pool with a large retry budget still make progress.
- **Retry exhaustion (R25.8–R25.9):** route to a Dead_Letter_Queue along the outgoing edge to one
  if present, carrying the total attempt count and this node's identifier; otherwise terminate
  `Retry_Exhausted` and record an error here.
- **Upstream consumption stop (R25.4):** when `executing.size === concurrency` and
  `prefetch.length === prefetchBufferDepth`, the pool stops consuming. This is not something the
  pool can do alone — the upstream `MessageQueueProcessor.onConsumerPoll` currently splices its
  batch unconditionally. It gains a capacity check:

```typescript
/** Implemented by processors that consume from an upstream Message_Queue. */
export interface BackpressureAwareConsumer {
  /** How many items the consumer will accept right now. 0 means stop consuming. */
  admissionCapacity(): number;
}

// MessageQueueProcessor.onConsumerPoll, revised
const consumer = context.getNodeState(edges[0].target)?.processor;
const downstreamRoom = isBackpressureAware(consumer)
  ? consumer.admissionCapacity()
  : Number.POSITIVE_INFINITY;
const batchSize = Math.min(this.config.consumerBatchSize, this.buffer.length, downstreamRoom);
// …splice and route batchSize items…
// Reschedule the poll whenever the buffer is non-empty, even if batchSize was 0,
// so consumption resumes when the pool drains. The existing `consumerScheduled`
// latch already handles the empty-buffer case.
```

The undelivered remainder therefore accumulates in the queue's buffer and is bounded by that
queue's configured capacity, which is exactly what R25.4 asks for and what keeps Worker Pool
backlog growth visible on the queue's own gauge.

- **Reported figures (R25.11–R25.13):** Job_Backlog is upstream buffered Jobs plus `prefetch.length`,
  excluding `executing`. Backlog_Age is `now − enqueuedAt(oldest backlog Job)`, reported as 0 ms
  while the backlog is empty. Drain_Time is reported only while completion rate exceeds arrival
  rate; otherwise the pool reports *not draining* rather than a negative or infinite figure.

#### Dead_Letter_Queue Processor (Requirement 26)

```typescript
interface RetainedMessage {
  jobId: string;
  retentionStartMs: number;   // set on arrival, reset on re-arrival (R26.13)
  exhaustedAtNodeId: string;  // where Retry_Exhaustion occurred, for R26.9 attribution
  attemptCount: number;       // cumulative across all attempts
  redriveAttempts: number;    // carried forward across re-retention (R26.13)
}
```

`retained` is append-ordered, which is ascending `retentionStartMs`, so overflow discards index 0
(R26.4) and redrive selects a prefix (R26.6). Retention expiry is evaluated in
`onMetricsWindowBoundary`, called from `handleMetricsSnapshot` *before* the per-window counter reset
(R26.5); it is deliberately not evaluated on access, so a message cannot expire unobserved.

Redrive is the one place where a terminal status is *un*-assigned. `Dead_Lettered` is a terminal
status (R31.1), so routing a message back out must decrement that node's cumulative
`Dead_Lettered` count and return the Job to `In_Flight` at the instant it is routed (R26.11, R31.3).
The engine gains the inverse of `markRequestDone`:

```typescript
/** Returns a Job to In_Flight after a Redrive. Keeps the time-weighted in-flight
 *  figure honest: the Job was decremented when it was dead-lettered. */
private unmarkRequestDone(requestId: string): void {
  if (!this.countedAsComplete.delete(requestId)) return;
  this.updateInFlightWeightedSum();
  this.inFlightCount++;
}
```

A redriven message is removed from `retained` at the instant it is routed, so an in-flight redrive
is subject to neither overflow discard nor retention expiry (R26.6). On arrival at a Worker_Pool the
Job's attempt count resets to zero, granting a full `maxRetries + 1` budget for that round (R26.12),
while `redriveAttempts` carries forward so the redrive budget is not also reset.

#### Object_Store Processor (Requirement 27)

Latency is `baseLatency + transferTime`, and `transferTime` is not fixed at admission: bandwidth is
shared equally among active transfers and re-divided whenever a transfer starts or finishes
(R27.5–R27.6). The processor therefore tracks remaining work rather than a completion time.

```typescript
interface ActiveTransfer {
  requestId: string;
  remainingWorkKB: number;   // sizeKB × (isWrite ? writeLatencyMultiplier : 1)
  actualSizeKB: number;      // unscaled — the aggregate-transfer-rate metric uses this
  lastUpdateMs: number;
  epoch: number;             // invalidates the previously scheduled TransferComplete
}

function reprice(now: number): void {
  for (const t of active) {                       // 1. charge elapsed progress
    t.remainingWorkKB -= (share * (now - t.lastUpdateMs) / 1000) * 1024;
    t.lastUpdateMs = now;
  }
  share = config.throughputCapacityMBps / active.size;   // 2. re-divide (MB/s)
  for (const t of active) {                       // 3. reschedule
    const ms = (t.remainingWorkKB / 1024) / share * 1000;
    schedule TransferComplete at now + ms with epoch = ++t.epoch;
  }
}
```

Encoding the write multiplier as scaled *work* rather than as a post-hoc multiplication on a
computed duration is what makes R27.7 well-defined under repricing: with a constant share the
result is exactly `multiplier × transferTime`, and the sum of active shares still equals the
configured capacity while any transfer is active (CP-16). The aggregate transfer rate reported for
the window uses `actualSizeKB`, not scaled work, so a write-heavy window does not report more
bytes than it moved. Object size is clamped to [1, 10,485,760] KB before use (R27.3); the read/write
classification draw precedes the size draw, which precedes the base-latency draw.

Requests beyond `maxConcurrentTransfers` wait in the transfer queue in arrival order with their wait
added to accumulated latency; beyond `transferQueueDepth` they terminate `Dropped` with the latency
they had accumulated *before* reaching this node (R27.9). While the aggregate rate is at or above
0.85 of capacity, the node names bandwidth as its limiting resource in the Activity view (R27.11).

#### Scheduler Processor (Requirement 28)

The Scheduler is the second source node type, and R28.8 makes it behave like a Traffic_Generator
for the purposes of Requirement 14: no incoming edge required, and an emitted Job with no outgoing
edge terminates `NO_ROUTE` immediately.

Drift-freedom (R28.2–R28.3) comes from separating the *schedule* from the *fire time*:

```
scheduledTime(n) = startOffsetMs + n * intervalMs        # never adjusted by anything
effectiveJitter  = min(jitterMs, intervalMs)
fireTime(n)      = scheduledTime(n) + uniform[0, effectiveJitter]   # one draw per trigger
```

Because `effectiveJitter ≤ intervalMs`, `fireTime(n) ≤ scheduledTime(n+1) ≤ fireTime(n+1)`, so fire
times are non-decreasing in trigger index and jitter can never accumulate as drift. When trigger `n`
is handled, trigger `n+1`'s jitter is drawn and its `SchedulerTrigger` event scheduled — a fixed
draw position that keeps the sequence reproducible.

Overlap handling needs to know whether any Job from an earlier trigger of *this* node is still
in flight. `SimRequest` gains `emittedByNodeId`, and the engine notifies the emitting source node
when one of its Jobs reaches a terminal status:

```
outstanding: Set<jobId>        # Jobs emitted by this node, not yet terminal
deferred: number[]             # trigger indices, ≤ maxDeferredTriggers

onTrigger(n):
  if outstanding is empty: emit(n)
  else switch overlapPolicy:
    Allow: emit(n)                                                  # R28.7
    Skip:  count skipped; log skipped-trigger event                 # R28.5
    Queue: if deferred.length === maxDeferredTriggers:
             count skipped; log deferred-trigger-overflow           # R28.12
           else deferred.push(n)                                    # R28.6, one entry per trigger

onJobTerminal(jobId):
  outstanding.delete(jobId)
  if outstanding is empty and deferred.length > 0:
    emit(deferred.shift())      # exactly one entry, remainder retained — R28.11
```

On entering `Complete` with Jobs outstanding, the node retains that count as its unfinished Job
count and discards every remaining deferred entry without emitting it (R28.13). Latency percentiles
and Little's Law figures are reported *not applicable* for a Scheduler, as they already are for a
Traffic_Generator (R28.10) — the existing `isSource` branch in `ActivityPanel` widens to cover both.

---

### Connection Rules for the New Node Types (Requirement 30)

`CONNECTION_RULES` gains six entries, and the three pre-existing entries that acquire new permitted
targets are widened: `TrafficGenerator` → `AuthService`; `ApiGateway` → `AuthService`,
`AuthzService`; `AppServer` → `AuthService`, `AuthzService`, `ObjectStore`; `MessageQueue` →
`WorkerPool`.

```typescript
[NodeType.AuthService]:  { allowedTargets: [NodeType.Cache, NodeType.Database],
                           allowedProtocols: [EdgeProtocol.Sync] },
[NodeType.AuthzService]: { allowedTargets: [NodeType.Cache, NodeType.Database],
                           allowedProtocols: [EdgeProtocol.Sync] },
[NodeType.WorkerPool]:   { allowedTargets: [NodeType.Database, NodeType.Cache,
                                            NodeType.ObjectStore, NodeType.AppServer,
                                            NodeType.MessageQueue, NodeType.DeadLetterQueue],
                           allowedProtocols: [EdgeProtocol.Sync, EdgeProtocol.Async] },
[NodeType.DeadLetterQueue]: { allowedTargets: [NodeType.MessageQueue, NodeType.WorkerPool],
                           allowedProtocols: [EdgeProtocol.Async] },
[NodeType.ObjectStore]:  { allowedTargets: [], allowedProtocols: [] },   // terminal, R30.10
[NodeType.Scheduler]:    { allowedTargets: [NodeType.MessageQueue, NodeType.WorkerPool,
                                            NodeType.AppServer, NodeType.ApiGateway],
                           allowedProtocols: [EdgeProtocol.Sync, EdgeProtocol.Async] },
```

`allowedProtocols` is per source type, but R30.7 and R30.8 specify protocol *per pair* — a
Worker_Pool reaches a Database synchronously and a Message_Queue asynchronously. The flat shape
cannot express that, so a per-pair override table sits alongside it and `getValidProtocols`
consults the override first:

```typescript
/** Pairs whose permitted protocol is narrower than the source type's allowedProtocols. */
const PROTOCOL_OVERRIDES: Partial<Record<`${NodeType}->${NodeType}`, EdgeProtocol[]>> = {
  [`${NodeType.WorkerPool}->${NodeType.Database}`]:        [EdgeProtocol.Sync],
  [`${NodeType.WorkerPool}->${NodeType.MessageQueue}`]:    [EdgeProtocol.Async],
  [`${NodeType.WorkerPool}->${NodeType.DeadLetterQueue}`]: [EdgeProtocol.Async],
  [`${NodeType.Scheduler}->${NodeType.MessageQueue}`]:     [EdgeProtocol.Async],
  [`${NodeType.Scheduler}->${NodeType.AppServer}`]:        [EdgeProtocol.Sync],
  // …one entry per pair whose protocol R30.1–R30.9 pins…
};
```

`validateEdgeConnection` gains two rules beyond the existing self-loop, duplicate, and pair checks:

- **Protocol mismatch (R30.13):** the selected protocol must be in the pair's permitted set; the
  rejection message names the source type, target type, and the permitted protocol.
- **Worker_Pool → Dead_Letter_Queue cardinality (R30.11):** at most one such outgoing edge per
  Worker_Pool. Several distinct Worker_Pools may target the same Dead_Letter_Queue. The rejection
  names the Worker_Pool's label and the label of the DLQ its existing edge already targets. This
  needs the full node list, so the validator's signature widens to take
  `(source, target, protocol, existingEdges, nodesById)`.
- **Worker_Pool → Worker_Pool** is rejected by the pair table alone: `WorkerPool` is absent from its
  own `allowedTargets` (R30.7).

Cycles remain permitted (R30.15): `detectCycles` still badges participating nodes and the
`maxHops` guard still terminates offenders `LOOP_DETECTED`. Import applies the same validator and
rejects the whole file on the first violating edge, leaving the Canvas unmodified (R30.16).

---

### Terminal Status Partition and Event Types (Requirement 31)

```typescript
export enum RequestStatus {
  InFlight = 'IN_FLIGHT',          // non-terminal, counted under none of the nine
  Success = 'SUCCESS',
  Timeout = 'TIMEOUT',
  Dropped = 'DROPPED',
  LoopDetected = 'LOOP_DETECTED',
  NoRoute = 'NO_ROUTE',
  Unauthenticated = 'UNAUTHENTICATED',   // R23.3, R23.11
  Forbidden = 'FORBIDDEN',               // R24.6
  RetryExhausted = 'RETRY_EXHAUSTED',    // R25.9
  DeadLettered = 'DEAD_LETTERED',        // R26.2 — the only reversible one
}

export const TERMINAL_STATUSES = [ /* the nine, excluding InFlight */ ] as const;

export enum FailureClass {
  Admission = 'ADMISSION',        // Unauthenticated, Forbidden
  CapacityReliability = 'CAPACITY_RELIABILITY', // Timeout, Dropped, RetryExhausted, DeadLettered
  TopologyConfiguration = 'TOPOLOGY_CONFIG',    // LOOP_DETECTED, NO_ROUTE
}                                 // Success belongs to no class — R31.5
```

Existing processors that set `Dropped` for an admission decision keep doing so: `ApiGatewayProcessor`
models an *unauthorized* rejection under Requirement 22, which predates this taxonomy and is
unchanged so that Requirement 22's metrics do not move. `Unauthenticated` is produced only by
Auth_Service and `Forbidden` only by Authz_Service.

Counting moves from the three ad-hoc counters to an explicit partition. `NodeRuntimeState` gains
`terminalCounts: Record<RequestStatus, number>` (per window, reset with the others) and
`cumulativeTerminalCounts` (never reset, and the only counter a cumulative Finding may read).
`totalProcessed`, `totalDropped`, and `totalTimedOut` remain because
`CircuitBreakerProcessor.downstreamErrorRate` and `deriveHealthStatus` read them; the new counters
are additive rather than a replacement.

The partition invariant (R31.2–R31.3, R31.7, CP-5) is maintained at four points:

1. **Assignment.** Every terminal assignment goes through one engine helper that records the status
   and the node identifier together, and asserts the request was `In_Flight`.
2. **Redrive.** `Dead_Lettered` is decremented on the retaining DLQ node and the Job returns to
   `In_Flight` via `unmarkRequestDone`, so the nine cumulative counts continue to sum to the number
   of requests and Jobs that have left the system.
3. **Branches.** A branch's terminal status is recorded against the node where the branch terminated
   but is excluded from the system-wide counts, so a parent and all its branches contribute exactly
   one system-wide termination (R31.6).
4. **Completion.** On entering `Complete`, requests still `In_Flight` are reported as the run's
   unfinished count and excluded from every cumulative count and from the R31.8 percentage
   denominators.

New `SimEventType` members, all dispatched from the existing `processEvent` switch:

```typescript
SubRequestSettled   = 'SUB_REQUEST_SETTLED',    // R32.9, R23.5, R24.4
VerificationComplete = 'VERIFICATION_COMPLETE', // R23.2
PolicyEvaluated     = 'POLICY_EVALUATED',       // R24.2
JobAdmit            = 'JOB_ADMIT',              // R25.2
JobAttemptComplete  = 'JOB_ATTEMPT_COMPLETE',   // R25.5
JobRetryReady       = 'JOB_RETRY_READY',        // R25.6
JobTimeout          = 'JOB_TIMEOUT',            // R25.10
DlqRedrive          = 'DLQ_REDRIVE',            // R26.6, R26.8
TransferComplete    = 'TRANSFER_COMPLETE',      // R27.6
SchedulerTrigger    = 'SCHEDULER_TRIGGER',      // R28.2
NodeDisabled        = 'NODE_DISABLED',          // R39.8
NodeRestored        = 'NODE_RESTORED',          // R39.11
```

---

### Downstream Routing Policies and Fan-Out (Requirement 32)

This is the highest-risk change in the extension: it is the only one that alters the shape of a
request's lineage, and the existing in-flight accounting and reverse-path traversal were both
written for a linear lineage.

#### Where Routing Lives

Every processor today hard-codes `edges[0]!.target`. Those call sites are replaced by one engine
helper so that a single implementation governs all fifteen types and the cursor and weight state
cannot diverge per processor:

```typescript
// ProcessorContext gains:
/** Resolves the next hop(s) for a forwarding decision at `nodeId` under its routing policy.
 *  Returns every edge to dispatch along: one edge for First/Round_Robin/Weighted,
 *  every outgoing edge for Fan_Out below the depth cap. */
resolveTargets(nodeId: string, request: SimRequest): EdgeData[];
```

Cursors and weights are engine state, not processor state:

```typescript
private roundRobinCursors: Map<string, number> = new Map();  // nodeId → index into outgoing edges
```

- **First (R32.2):** lowest stored index. `adjacency.get(nodeId)[0]` already is that, because
  `buildAdjacency` iterates `config.topology.edges` in serialized order. Persistence preserves that
  order, so a node forwards along the same edge before and after a save/load round trip.
- **Round_Robin (R32.3):** one cursor per node, initialised to 0 on construction and on `reset()`,
  advanced by exactly one per forwarding decision, wrapping after the highest index.
  `pause()`/`resume()` only flip `this.state`, so the cursor survives a pause unchanged — the
  requirement is satisfied by not doing anything, which is worth stating so a later refactor does
  not reset cursors in `resume`.
- **Weighted (R32.4–R32.6):** `EdgeData` gains `weight: number` defaulting to 1.0. One PRNG draw per
  decision, compared against cumulative normalised weights accumulated in ascending stored index
  order. A zero or non-finite weight sum falls back to uniform `1/outDegree` and surfaces a
  normalisation warning naming the node's label, so no decision divides by zero and no request is
  lost for want of a weight. Configured weights are never mutated by normalisation, which is what
  makes normalisation idempotent (CP-9).
- **Fan_Out (R32.7–R32.12):** dispatches one branch per outgoing edge at a single timestamp.

#### Branch and Parent Data Model

```typescript
export interface SimRequest {
  // …existing fields…
  fanOutDepth: number;              // 0 at a source; parent + 1 per branch; capped at 4
  emittedByNodeId: string;          // origin source node, for Scheduler overlap accounting

  // Branch-only
  parentRequestId?: string;
  dispatchedAtNodeId?: string;      // the fan-out / lookup node; path[0] for a branch
  dispatchedAtMs?: number;
  settleOnAccept?: boolean;         // Asynchronous edge — settles when the target accepts
  isDiscarded?: boolean;            // sibling of a failed branch; counted nowhere

  // Parent-only
  pendingBranchIds?: Set<string>;
  maxBranchSettleMs?: number;
  branchPolicy?: SubRequestPolicy;  // FanOut | AuthIntrospection | AuthzLookup
}
```

A branch is a full `SimRequest` with `path = [dispatchNodeId]` and `hopCount` copied from the parent
at dispatch. Every node the branch subsequently visits counts as one hop against the shared
`maxHops` budget, so a fan-out inside a cycle is still terminated `LOOP_DETECTED`.

Rooting each branch's `path` at the dispatch node is the mechanism that keeps the response phase
correct without touching `handleResponseRoute`. A successful branch runs the same reverse walk over
its own `path`; when `responseHopIndex` reaches 0 it is already *at* the dispatch node, so the
branch emits `SubRequestSettled` there rather than `ResponseComplete`. It can never walk upstream of
the dispatch node, because the dispatch node is index 0 of its path, and the parent's own `path` is
never appended to by a branch. The parent's reverse traversal after resumption is therefore exactly
the linear walk the shipped engine already performs (R32.10).

```
Parent path:   TG → GW → APP            (linear, unchanged)
                          │  Fan_Out at APP
                          ├── branch A path: [APP, CACHE]      → SubRequestSettled at APP
                          ├── branch B path: [APP, DB]         → SubRequestSettled at APP
                          └── branch C path: [APP, MQ]  (async) → settles on accept at MQ
Parent resumes at APP once A, B, C have settled; adds max(settle − dispatch);
then responds TG ← GW ← APP.
```

#### Settle Semantics

A branch settles when it reaches a terminal status, when its response traversal reaches the dispatch
node, or — on an Asynchronous edge — at the instant its target accepts or terminates it (R32.9).
The asynchronous case matters for a Fan_Out that publishes to a Message_Queue: the parent must not
wait for a downstream consumer to drain the queue, so `settleOnAccept` makes the branch settle
inside `MessageQueueProcessor.onRequestArrived`, at the moment the message is buffered or rejected.

```
onSubRequestSettled(branch):
  parent = requests.get(branch.parentRequestId)
  if parent is not awaiting branches: return                # discarded sibling arriving late
  parent.maxBranchSettleMs = max(parent.maxBranchSettleMs, settleMs − branch.dispatchedAtMs)
  parent.pendingBranchIds.delete(branch.id)

  if branch reached a non-success terminal status:
    apply parent.branchPolicy:
      FanOut            → terminate parent with the branch's status, recording the branch's
                          target node identifier; ties at one timestamp resolve to the branch on
                          the lowest stored index                                    # R32.12
      AuthIntrospection → terminate parent Unauthenticated, error at the Auth node   # R23.11
      AuthzLookup       → terminate parent with the branch's status + lookup node id # R24.7
    mark every unsettled sibling isDiscarded (counted under no status)
    return

  if parent.pendingBranchIds is empty:
    parent.accumulatedLatencyMs += parent.maxBranchSettleMs      # the maximum, nothing else
    resume(parent)   # FanOut: parent is Success at the fan-out node → startResponseTraversal
                     # Auth/Authz: continue the node's own logic (credential test, deny test)
```

#### Depth Cap

`fanOutDepth` is 0 for a request emitted by a Traffic_Generator or a Scheduler, and a branch is its
parent's depth plus 1. A request arriving at a Fan_Out node already at depth 4 is forwarded along
the lowest stored index alone, dispatches no branch, and produces a `fan-out-depth-limit` log entry
naming the node and the request (R32.8). This bounds branch fan-out at 4 levels regardless of
topology, which is what keeps the in-flight and event-queue growth bounded on a cyclic graph.

#### Accounting — the Double-Count Hazard

Branches must be invisible to the system-wide figures while remaining fully visible per node.
Three guards, each at an existing decrement point:

```typescript
// 1. Creation: a branch never increments inFlightCount.
//    The parent is counted once for the whole interval its branches are unsettled (R32.11).

// 2. handleRequestRoute — failure path
if (request.status !== RequestStatus.InFlight) {
  if (request.status !== RequestStatus.Success && !request.parentRequestId) {
    this.markRequestDone(request.id);          // parents only
  }
  if (request.parentRequestId) {
    this.scheduleSubRequestSettled(request);   // branches settle instead of decrementing
  }
}

// 3. Completion recording
if (request.parentRequestId) {
  this.metricsCollector.recordBranchTermination(request);  // per-node aggregates only
} else {
  this.metricsCollector.recordCompletion(request);         // system-wide + per-node
}
```

Because `ResponseComplete` is only ever scheduled for a request whose `path[0]` is a source node,
and a branch's `path[0]` is its dispatch node, branches cannot reach the success decrement point at
all. `markRequestDone` remains idempotent for the parent, so the time-weighted active-request figure
counts each end-to-end request exactly once.

#### Determinism of Draw Order

Determinism (R5.4, CP-1) requires a fixed PRNG consumption order per request per node. The rule:
**a processor draws its own samples first, in its documented order; the routing draw, if the policy
is Weighted, happens last and exactly once per forwarding decision.** First, Round_Robin, and
Fan_Out consume no randomness. Per-type draw order:

| Node type | Draws, in order |
|-----------|-----------------|
| Auth_Service | verification latency → token cache test → credential failure test (R23.12) |
| Authz_Service | policy latency → policy cache test → deny test |
| Worker_Pool | processing time (per attempt) → failure test (per attempt) |
| Object_Store | read/write classification → object size → base latency |
| Scheduler | jitter offset for the *next* trigger index, drawn when the current trigger fires |
| Dead_Letter_Queue | none |

Fan_Out dispatches branches in ascending stored edge index, so any draws the branch targets make
occur in a fixed order too.

#### Reporting and Migration

Per-edge forwarded-request counts (identified by the target node's user-assigned label) and per-node
dispatched-branch counts are added to the metrics snapshot for every node with two or more outgoing
edges (R32.14). A schema version 1 topology loads with every routing policy `First` and every edge
weight 1.0, which reproduces the pre-extension single-target behaviour exactly, so a run at a given
seed produces the metrics it produced before this feature (R32.13, CP-4).

---

### Subsystem Grouping (Requirement 33)

#### Store Shape

```typescript
export interface SubsystemGroup {
  id: string;
  name: string;              // 1–40 chars trimmed, case-insensitively unique
  memberNodeIds: string[];   // 2–50, disjoint across groups, one level deep
  collapsed: boolean;
}

// topologyStore gains:
subsystemGroups: SubsystemGroup[];   // ≤ 20
createGroup(nodeIds: string[]): void;
renameGroup(groupId: string, name: string): void;
setGroupCollapsed(groupId: string, collapsed: boolean): void;
addNodesToGroup(groupId: string, nodeIds: string[]): void;
removeNodesFromGroup(groupId: string, nodeIds: string[]): void;
deleteGroup(groupId: string): void;              // retains every node and edge
dragGroup(groupId: string, dx: number, dy: number): void;
```

Membership is a partition: every mutation re-checks the invariants of CP-20 and rejects the whole
operation on violation, naming the violated limit and the labels of any nodes already in a group
(R33.2, R33.22). `removeNode` in the existing store gains a membership sweep — deleting a node drops
it from its group, and a group left with fewer than 2 members is deleted while every remaining node
and edge stays on the Canvas at its stored position (R33.19–R33.20).

#### Rendering: A Derived View, Not React Flow Parent Nodes

React Flow supports `parentId` with `extent: 'parent'`, which is the obvious way to model a group.
It is the wrong fit here for three reasons that map directly onto requirements:

1. `parentId` makes a child's `position` **relative to its parent**. Grouping and ungrouping would
   have to rewrite every member's stored position, and R33.11 (collapse then expand restores every
   contained node's position) and R33.24 (deleting a group renders every node at its stored
   position) would become arithmetic to get right rather than a no-op.
2. A collapsed group must render **no element per contained node** (R33.9). React Flow parent nodes
   render children; hiding them means unmounting, which loses selection and per-node metric state.
3. Boundary edges must **merge** with an underlying-edge count (R33.7–R33.8). That is a
   transformation of the edge set, which no parent-node feature performs.

Instead the store holds the canonical topology and groups, and a selector derives what React Flow
renders. A collapsed group is a single custom node type `SUBSYSTEM_GROUP` registered in `nodeTypes`.

```typescript
/** Maps the canonical topology + groups onto the node/edge arrays React Flow renders. */
export function useCollapsedTopologyView(): { nodes: AnalysysNode[]; edges: AnalysysEdge[] } {
  // For each collapsed group:
  //   emit one SUBSYSTEM_GROUP node at the bounding-box centre of its members
  //   omit every member node                                              (R33.9)
  //   omit every edge whose source and target are both members            (R33.6)
  //   rewrite each boundary edge's contained endpoint to the group node   (R33.6)
  //   merge boundary edges sharing (groupId, externalNodeId, direction)   (R33.7)
  //     → id `grp:{groupId}:{in|out}:{externalNodeId}`,
  //       data.underlyingEdgeIds[], data.underlyingCount, data.memberLabels[]
}
```

Dragging a collapsed group applies the drag displacement to every member's stored position, leaving
relative positions unchanged (R33.10). Expanding renders each member at its stored position, so a
collapse/expand with no intervening drag is position-preserving (R33.11).

#### Grouping Never Reaches the Engine

`getTopologySnapshot()` returns `{ nodes, edges }` from the canonical store and is not changed by
this feature. `INIT` therefore carries no group information, and the engine has no concept of a
group — which is what makes CP-6 (metrics independent of grouping and collapse state) true by
construction rather than by test. It also makes R33.13 straightforward: create, rename, collapse,
expand, delete, and membership changes are all main-thread store operations that send nothing to the
Worker, so pending events, the virtual clock, and retained metrics are untouched in every simulation
state.

Collapsed-group badges and the per-group Telemetry breakdown are computed on the main thread by
summing member snapshots from the latest `METRICS_BATCH`: summed throughput, summed error count by
terminal status, the least healthy member status under the order red → yellow → green, and the
highest member Utilization *among members whose reading is numeric*, with the label of the member
holding it. Where every member reads `not-applicable`, the group reports `not-applicable` with no
number and no label (R33.16, R33.18) — the `UtilizationReading` discriminant carries this without a
sentinel value.

---

### Schema Version 2 and Migration (Requirement 34)

Two persistence paths exist today and both are versioned at 1: `persistenceStore.ts`
(`SerializedTopology`, localStorage + export/import) and `utils/localStorage.ts`
(`AnalysysFileSchema`, the `.analysys.json` validator). Both move to version 2, and
`utils/localStorage.ts`'s hard-coded `VALID_NODE_TYPES` array — which currently lists only six of
the nine shipped types and would reject every new type — is replaced by `Object.values(NodeType)`.

```typescript
export const CURRENT_SCHEMA_VERSION = 2;

export interface SerializedTopologyV2 {
  schemaVersion: 2;
  nodes: SimulationNode[];      // includes routingPolicy and every R23–R28 parameter
  edges: EdgeData[];            // includes weight; array order is the stored index (R32.2)
  subsystemGroups: SubsystemGroup[];
}
```

A record is written at version 2 whenever it contains a node of one of the six new types, a routing
policy other than `First`, an edge weight, or a Subsystem_Group (R34.3).

Migration replaces the current no-op `migrateIfNeeded`:

```typescript
export interface MigrationWarning {
  nodeOrEdgeLabel: string;
  field: string;
  importedValue?: unknown;
  appliedValue: unknown;
}

/** v1 → v2. Pure: returns a new record plus the warnings to surface. R34.4, R34.8 */
export function migrateV1ToV2(
  v1: SerializedTopology,
): { topology: SerializedTopologyV2; warnings: MigrationWarning[] } {
  // routingPolicy      → RoutingPolicy.First for every node        (R32.13)
  // edge.weight        → 1.0 for every edge                        (R32.4)
  // subsystemGroups    → []
  // absent R23–R28 params (incl. Object_Store transferQueueDepth and
  //   Scheduler maxDeferredTriggers) → createDefaultNodeData value  (R29.3)
  // one warning per applied default, naming label, field, and value
}
```

Three rules govern where defaults versus clamps versus rejections apply:

- **Absent field → default, with a warning, import succeeds.** Applies to routing policy, edge
  weight, the group set, and any R23–R28 parameter, at either schema version (R34.4, R34.8). An
  absent field of this set is never a validation failure.
- **Present but out of range or non-finite → clamp to the nearest bound, with a warning naming the
  node label, parameter, imported value, and applied bound** (R29.9). This is `normalizeConfig`,
  extended to the six new types and made to *report* what it clamped rather than clamping silently
  as it does today.
- **Structurally invalid → reject, Canvas unmodified.** A `schemaVersion` above 2 (R34.6), an
  absent/non-integer/below-1 `schemaVersion` (R34.9), and any edge violating Requirement 30
  (R30.16). Group records are the exception: they are *normalised* rather than rejected —
  truncate a long name to 40 characters, suffix a duplicate name, drop absent and duplicated member
  identifiers, keep the first 50 in stored order, and drop a group left with fewer than 2 (R33.26).

Loading a v1 record from localStorage migrates the **in-memory** topology only. The stored record
keeps its version 1 field values, and version 2 is written on the next save invoked for that
topology (R34.10). This keeps a downgrade non-destructive: opening a build that supports v2 does not
rewrite a user's saved v1 records.

Saving above 4,194,304 bytes of UTF-8 **completes** and warns with the serialized size and the
threshold (R34.7); it is not a failure. The existing `getStorageUsage` measures
`key.length + value.length` in UTF-16 code units, which under-reports multi-byte content; it is
replaced with `new TextEncoder().encode(serialized).length` for the threshold comparison.

---

### Analysis Engine (Requirements 35–37, 41)

The Analysis Engine consumes metrics snapshots and topology structure and emits Findings. It is the
largest new component and the only one with a hard latency budget on the main thread.

```
┌─────────────────────────── MAIN THREAD ───────────────────────────┐
│                                                                    │
│  METRICS_BATCH ──▶ AnalysisWindowStore  (ring buffer, 16 windows)  │
│                            │            + cumulative run totals    │
│  topologyStore ────────────┤                                       │
│  eventLog ─────────────────┤                                       │
│                            ▼                                       │
│                    AnalysisScheduler                               │
│                    • one recomputation per window boundary         │
│                    • slices rules, yields at 33 ms                 │
│                    • aborts at 500 ms, keeps previous set          │
│                            │                                       │
│                   ┌────────┴────────┐                              │
│                   ▼                 ▼                              │
│             RuleRegistry      FindingBuilder (round6, stable id)   │
│             (16 rules)               │                             │
│                   └────────┬─────────┘                             │
│                            ▼                                       │
│                     analysisStore ──▶ Analysis_Panel               │
└────────────────────────────────────────────────────────────────────┘
```

#### Why the Main Thread

The Worker runs a tight event loop that must sustain ≥1,000 events per wall-clock second (R5.5,
R34.2, PB-1). Interleaving a 500 ms analysis pass into that loop would either stall event processing
for the duration or require the analysis to be sliced *inside* `run()`, competing with the
`BATCH_SIZE = 200` yield rhythm that PAUSE and CHAOS delivery already depend on. The analysis also
needs data the Worker does not have: user-assigned labels for R35.9, the event log for R37.8, and the
topology graph including Subsystem_Group state for the Analysis_Panel's node-activation behaviour.
Running on the main thread with cooperative slicing keeps the Worker's throughput guarantee intact
and keeps the ≥30 fps target through the 33 ms slice cap. A second Worker was rejected: it would need
a full copy of the topology and label data per recomputation, and structured-clone cost at 80 nodes
would consume a meaningful share of the 500 ms budget it was meant to protect.

#### The Finding Model

```typescript
export type FindingCategory =
  | 'Bottleneck' | 'Saturation' | 'Instability' | 'Capacity'
  | 'Single_Point_Of_Failure' | 'Reliability' | 'Configuration' | 'Comparison';
// The declaration order above IS the tie-break order of R35.8 and the group order of R43.2.

export type Severity = 'Critical' | 'Warning' | 'Info';
export type Confidence = 'High' | 'Medium' | 'Low';

export interface EvidenceEntry {
  metricName: string;      // 1–100 chars
  value: number;           // finite, rounded to 6 dp half-up before storage
  unit: string;            // 1–20 chars; 'fraction' for 0–1 ratios, 'percent' for 0–100 (R41.11)
  scope: string;           // a subject node identifier, or SYSTEM_WIDE_SCOPE
  primary?: true;          // exactly one entry per Finding carries this (R35.2)
}

export interface RecommendedAction {
  nodeId: string;
  parameter: string;
  direction: 'increase' | 'decrease';
  targetValue?: { value: number; unit: string };
  multiplier?: number;
}

/** R39.7 replaces parameter/direction/target with a structural change for SPOF Findings. */
export interface StructuralAction {
  nodeId: string;
  nodeType: NodeType;
  change: 'add-redundant-instance-behind-a-Load_Balancer-node' | 'add-alternative-path';
  nodesAdded: number;
  edgesAdded: number;
}

export interface Finding {
  id: string;                          // stable, derived — see below
  category: FindingCategory;
  severity: Severity;
  subjectNodeIds: string[];            // 0–200; empty means system-wide scope
  evidence: EvidenceEntry[];           // 1–20, exactly one primary
  constraint: string;                  // 1–500 chars
  action: RecommendedAction | StructuralAction;
  tradeoff: string;                    // 1–500 chars
  confidence: Confidence;
  window: { startMs: number; endMs: number };   // inclusive both ends
}
```

**Stable identifiers (R35.13, CP-21).** `id = \`${ruleId}:${category}:${[...subjectNodeIds].sort().join(',')}\``.
Derived from the rule, the category, and the ascending-sorted subject node identifiers alone, so it
is unchanged by a label edit, by recomputation within a run, and across repeated runs of the same
inputs. The registry emits at most one Finding per identifier per result by keying the output map on
`id`, which also makes "exactly one Finding" requirements (R36.2, R37.1, R37.2) enforced structurally
rather than by each rule remembering to check.

**Rounding (R41.2, CP-1).** Every numeric value is passed through `round6` before it is stored,
displayed, or exported. Half-up at 6 decimal places, and the result is asserted finite:

```typescript
export function round6(x: number): number {
  if (!Number.isFinite(x)) throw new AnalysisError('non-finite value in Finding');
  // Math.round is half-up for positives and half-away-from-zero for negatives, so
  // negatives are handled explicitly to keep the rule uniformly half-up.
  const scaled = x * 1e6;
  return (x < 0 ? -Math.round(-scaled) : Math.round(scaled)) / 1e6;
}
```

Rounding at construction rather than at display is what makes Finding equality testable by exact
numeric comparison — CP-1 compares two independently computed Finding sets, and without a single
canonical rounding point that comparison would depend on floating-point association order.

**Confidence (R35.6, R35.15).** Derived from the lowest completed-request count within the window
among the subject nodes: `High` at ≥200 *and* every subject node in Steady_State throughout;
`Medium` at ≥200 with any subject node outside Steady_State, or at 30–199; `Low` below 30. A Finding
with an empty subject set uses the system-wide completed count against the same boundaries.

#### Rule Registry

Each analysis rule is an independent, individually testable, individually suppressible unit.

```typescript
export interface AnalysisContext {
  windows: readonly NodeMetricsWindow[];   // most recent last; ≥3 required before any Finding
  cumulative: CumulativeRunAggregates;
  topology: { nodes: SimulationNode[]; edges: EdgeData[] };
  labelOf(nodeId: string): string;         // falls back to a shortened id (R35.9)
  eventLog: readonly SimEventLogEntry[];
  serviceObjective?: ServiceObjective;
}

export interface AnalysisRule {
  readonly id: string;                     // e.g. 'bottleneck.rank', 'instability.depth-growth'
  readonly category: FindingCategory;
  /** Metric names this rule reads. If any is not-applicable or absent for a node,
   *  the rule is suppressed for that node and the suppression is reported (R41.5). */
  readonly requiredMetrics: readonly string[];
  /** Yields between chunks of work so the scheduler can hold a slice at ≤33 ms (R41.9). */
  evaluate(ctx: AnalysisContext): Generator<void, Finding[], void>;
}

export const RULE_REGISTRY: readonly AnalysisRule[] = [
  bottleneckRankRule,          // R36.1–R36.5, R36.8
  bottleneckCoLimitingRule,    // R36.6
  bottleneckNoConstraintRule,  // R36.7
  bottleneckNoneEligibleRule,  // R36.11
  saturationRule,              // R37.1
  instabilityDepthGrowthRule,  // R37.2–R37.4, R37.10, R37.11
  instabilityLittlesLawRule,   // R37.5 — also suppresses Capacity rules for its subject
  dlqGrowthRule,               // R37.6
  workerPoolConcurrencyRule,   // R37.7
  schedulerCollisionRule,      // R37.8
  admissionDominatesRule,      // R31.9
  headroomRule,                // R38.1–R38.6
  sweepKneeRule,               // R38.25, R38.26
  spofRule,                    // R39.2–R39.7
  comparisonObjectiveRule,     // R40.11
  comparisonUtilizationRule,   // R40.12
];
```

A `Generator<void, Finding[], void>` is used rather than `async`/`await` so a rule's progress is
resumable at an explicit point of the rule's own choosing — a rule that iterates 80 nodes yields
every N nodes, and the scheduler decides whether to continue in the same slice or hand back the main
thread. `async` would put a microtask boundary at every `await` whether or not the budget needed one.

Suppression is a first-class outcome, not a silent skip. When a required metric is `not-applicable`
under R29.11–13 or absent from the window, the rule emits no Finding for the affected nodes and the
scheduler records `{ ruleId, metricName, affectedNodeLabels[] }` for the panel to display (R41.5).
R37.5 uses the same channel: an Instability-by-Little's-Law Finding suppresses every `Capacity`
Finding for its subject node and states which analysis was suppressed and for which node, while
still reporting per-node and system Headroom annotated as *measured outside Steady_State*.

#### Slicing Scheduler

```typescript
const SLICE_BUDGET_MS = 33;       // R41.9 — one frame at 30 fps
const TOTAL_BUDGET_MS = 500;      // R41.8, R41.10

async function recompute(ctx: AnalysisContext): Promise<RecomputationResult> {
  const startedAt = performance.now();
  const findings = new Map<string, Finding>();
  const incomplete: string[] = [];

  for (const rule of RULE_REGISTRY) {
    const it = rule.evaluate(ctx);
    let sliceStart = performance.now();
    for (;;) {
      const step = it.next();
      if (step.done) { for (const f of step.value) findings.set(f.id, f); break; }
      if (performance.now() - startedAt >= TOTAL_BUDGET_MS) {
        // Stop at the end of the slice in progress. Retain and keep displaying the
        // previously completed set; never show a partial set. (R41.10)
        incomplete.push(rule.id, ...remainingRuleIds(rule));
        return { status: 'aborted', incomplete, stoppedAtWindowMs: ctx.windows.at(-1)!.endMs };
      }
      if (performance.now() - sliceStart >= SLICE_BUDGET_MS) {
        await yieldToFrame();                 // MessageChannel port hop
        sliceStart = performance.now();
      }
    }
  }
  return { status: 'complete', findings: [...findings.values()] };
}
```

A single rule may exceed 33 ms in total — it just may not *occupy* the main thread for more than 33
consecutive milliseconds between two yields (R41.9). `yieldToFrame` uses a `MessageChannel` port
message rather than `setTimeout(0)`, which browsers clamp to ~4 ms after nested timeouts and would
consume roughly 12% of the 500 ms budget across the ~16 yields a full pass performs.

Recomputation runs exactly once per completed metrics window boundary while Running, never between
boundaries, and exactly once more on entering `Complete` over the final analysis window (R41.7).
With fewer than 3 completed windows the panel displays no Finding and states the completed count
against the 3 required (R41.6) — which is a different state from "analysis completed and no Finding
met its conditions" (R43.11), and the panel distinguishes them.

#### Per-Window Rate Hazard

R41.3 forbids deriving a Finding from any per-request record, so every quantity a rule reads comes
from an aggregate in a metrics snapshot. Those aggregates reset every window and their rates divide
by `elapsedSinceLastBatch`. The same failure mode that produced
`CircuitBreakerProcessor.MIN_OBSERVATIONS = 10` applies to every rule, and three conventions answer
it:

1. **No rule reads a single window.** Every threshold in Requirements 36–38 spans 3 or 5 windows —
   Analysis_Utilization is the mean over 3, Saturation requires ≥0.85 in each of 3, Instability
   inspects 5. A one-window spike or a one-window zero can therefore never emit a Finding.
2. **Every rule carries a minimum sample count.** R31.9 requires ≥30 non-Success terminations across
   its 3 windows; R37.7 requires ≥1 completed attempt; R36.9 keeps a node eligible at 0 throughput
   but requires ≥1 arrival. Below the minimum the rule suppresses rather than emitting a Finding
   computed from an empty denominator.
3. **A window with `durationMs <= 0` is unavailable, not zero.** The engine emits a final snapshot
   before `emitComplete()` on both exit paths, and that window is usually shorter than
   `metricsIntervalMs` and can be zero-length if the queue empties exactly on a boundary. The window
   store records each window's actual duration, weights rates by it, and excludes zero-duration
   windows from the "3 completed windows" count.

#### Aggregates the Worker Must Now Emit

Latency_Share (R36.10) and Blast_Radius (R39.4) are both defined over individual request paths, and
R41.3 forbids the analysis layer from seeing those paths. The Worker therefore accumulates them
per node, per window, while the requests are still in hand:

```typescript
export interface NodeMetricsSnapshot {
  // …existing fields, with utilization widened to UtilizationReading…

  // Terminal status partition (R31.4)
  terminalCounts: Record<RequestStatus, number>;            // this window
  cumulativeTerminalCounts: Record<RequestStatus, number>;  // never reset

  // Latency_Share numerator and denominator (R36.10)
  /** Σ time-in-system accumulated AT THIS NODE by requests/Jobs terminating in this window. */
  timeInSystemAtNodeMs: number;
  /** Σ time-in-system those SAME requests/Jobs accumulated across their whole recorded path. */
  pathTimeInSystemMs: number;

  // Blast_Radius numerator (R39.4)
  /** Terminating requests/Jobs whose recorded path — or the path of any branch dispatched
   *  for them — held this node. */
  terminatedThroughNodeCount: number;

  // Instability inputs (R37.9)
  monitoredDepth: number | null;   // Job_Backlog | buffered messages | queue depth | null
  monitoredDepthBound: number | null;
  arrivalCount: number;
  departureCount: number;          // forwarded + completed + terminated here

  // Type-specific (R23.9, R24.11, R25.11, R26.9, R27.10, R28.9)
  concurrencyOccupied?: number;
  concurrencyBound?: number;
  jobBacklog?: number;
  backlogAgeMs?: number;
  retainedByUpstreamNode?: Record<string, number>;
  transferRateMBps?: number;
  forwardedByEdge?: Record<string, number>;   // edgeId → count (R32.14)
  branchesDispatched?: number;
}
```

`pathTimeInSystemMs` is the subtle one: it is the denominator for *this node's* share, summed over
the same request population as the numerator, so `timeInSystemAtNodeMs / pathTimeInSystemMs` gives a
weighted share for a node lying on several distinct paths without the analysis ever seeing a path.
The share is reported *not applicable* while the divisor is 0 ms. Blast_Radius likewise needs only a
per-node count and a system-wide terminated count, both of which the Worker already has when it
assigns a terminal status — the branch paths are folded in at that moment because the parent still
holds its `pendingBranchIds` lineage.

#### Bottleneck, Saturation, and Instability Definitions

- **Analysis_Utilization** is the arithmetic mean of a node's per-window `utilization.value` over the
  3 most recently completed windows, computed only for nodes whose reading is numeric. Ranking is
  descending Analysis_Utilization, with values within 0.001 tie-broken by descending Latency_Share,
  then descending throughput, then ascending node identifier (R36.1) — a total order, which is what
  makes the ranking and the display order reproducible.
- **Bottleneck** designation is exactly one node per recomputation: the highest Analysis_Utilization
  among eligible nodes at or above 0.85, else the greatest Latency_Share (R36.2). Eligibility is a
  numeric Utilization reading plus ≥1 arrival in the window; a node stays eligible at 0 throughput,
  and every excluded node is listed with its reason (R36.9).
- **Saturation** is ≥0.85 in each of the 3 most recent windows; the reported sustained Utilization is
  the mean over the *maximal* run of consecutive windows at or above 0.85 ending at the most recent
  one, which may be longer than 3 (R37.1).
- **Instability** inspects 5 windows: the monitored depth must increase at each of the 4 most recent
  boundaries *and* the newest value must exceed the oldest by ≥20% of the oldest (R37.2). The 20%
  floor is what prevents a slow sawtooth from being reported as unbounded growth. Where a node
  satisfies both Saturation and Instability in one recomputation, only Instability is emitted, with
  the sustained Utilization folded into its evidence (R37.10). Where the computed growth rate is
  ≤0 items/s or the depth has no configured bound, the projected time to the bound is *not
  applicable* with a plain-language reason and no number (R37.11).

---

### Capacity Sweep Orchestration (Requirement 38)

A sweep is a sequence of full runs, orchestrated on the main thread. The Worker gains no knowledge
of sweeps beyond a per-step configuration message.

```typescript
export interface SweepConfig {
  startRps: number;          // 1–100,000
  endRps: number;            // 1–100,000, strictly above startRps
  stepCount: number;         // 2–20
  durationPerStepMs: number; // 1,000–1,800,000
  warmUpMs: number;          // 0 … durationPerStepMs − 1, default 10,000
  speedMultiplier: number;
  objective: ServiceObjective;   // { maxP99LatencyMs: 1–600,000; maxErrorRate: 0.0–1.0 }
}

export interface SweepStepResult {
  stepIndex: number;             // 0-based internally, displayed from 1
  requestedRps: number;
  appliedRps: number;            // sum of per-generator RPS actually applied (R38.12)
  achievedThroughput: number;
  latency: PercentileStats;
  totalErrorRate: number;
  terminalCounts: Record<RequestStatus, number>;
  schedulerJobsEmitted: number;  // reported separately from offered load (R38.14)
  measurementInterval: { startMs: number; endMs: number };
  verdict: 'satisfied' | 'violated' | 'not-evaluated';
}
```

**Offered load per step (R38.9–R38.10).** `startRps + n × (endRps − startRps) / (stepCount − 1)`,
rounded to whole RPS with exactly one half rounding up. Where rounding makes a step equal its
predecessor, that step is raised by 1 RPS so offered loads are strictly increasing. A range that
cannot yield `stepCount` distinct whole-RPS values is rejected up front, naming the requested count
and the highest workable one.

**Splitting across generators (R38.11–R38.13).** A topology may hold several Traffic_Generators, and
the sweep must preserve their relative mix. With `B` the sum of configured RPS at sweep start, each
generator gets `round(S × ownRps / B)` clamped to ≥1, and the residual between `S` and the sum of the
rounded values is assigned to the generator with the highest configured RPS, ties by ascending node
identifier. A per-node value above 100,000 is clamped with a warning, and the panel then reports the
step's *applied* offered load alongside its *requested* load, because the two genuinely differ.
Distribution, spike multiplier, and spike duration are untouched. A sweep with no Traffic_Generator,
or a configured RPS sum of 0, is rejected.

Scheduler parameters are held constant and Scheduler-emitted Jobs are excluded from offered load, so
Scheduler traffic is a constant additive background across every step (R38.14) — otherwise a
periodic burst would move with the sweep and confound the knee.

**Measurement interval.** The Service_Objective is evaluated over `[warmUpMs, durationPerStepMs]`
alone (R38.19), so arrivals during warm-up cannot fail a step that is actually stable. p99 over that
interval cannot be reconstructed by averaging window percentiles, so the engine keeps a second
accumulator that starts recording end-to-end latency samples and terminal statuses when the virtual
clock passes `warmUpMs`, and `SWEEP_STEP_COMPLETE` reports from it. A step whose measurement interval
recorded no terminations is `not-evaluated` and is excluded from the Knee_Point and Sustainable_Load
determinations (R38.20).

**Sequential execution.** One run per step in ascending offered load, state cleared and the clock
returned to t=0 between steps, with seed, topology, speed multiplier, routing policies, edge weights,
and every node configuration other than the generator RPS values held constant (R38.15). The Canvas
is restored to its sweep-start state on completion or cancellation, so a sweep changes the topology
in no respect (R38.17). While a sweep runs, Start/Pause/Resume and chaos controls are disabled and
the config panel is read-only (R38.18).

**Cancellation (R38.28).** `SWEEP_CANCEL` carries the in-progress step index. Results of steps that
completed their full simulated duration are retained and reported; the in-progress step's metrics are
discarded; the sweep reports as cancelled naming the 1-based in-progress index; and Knee_Point and
Sustainable_Load are determined from the retained steps alone.

**Non-monotonic results are reported, not smoothed.** Where a step above the Knee_Point satisfies the
objective, the panel reports the count and offered load of each such step and states that the
measured results are not monotonic in offered load (R38.23), rather than quietly reporting the
lowest violating step as if the curve were well behaved.

---

### Single Point of Failure, Blast Radius, and Node Failure (Requirement 39)

#### Reachability Algorithm

SPOF is a purely structural analysis over the directed graph, with edge protocol, weight, and routing
policy all ignored, and Subsystem_Group state ignored. It produces results whether or not a run has
completed (R39.1).

```
sources   = nodes of type Traffic_Generator or Scheduler
terminals = nodes with out-degree 0                    # type-independent; Object_Store always is
candidates = every node that is neither a Traffic_Generator nor a Scheduler

baseline[s] = terminals reachable from s by directed path, for each s in sources

for each candidate v:                                   # sliced: yield every 8 candidates
  for each s in sources where baseline[s] is non-empty:
    reachable = BFS from s in G − v (skip v and every edge incident to it)
    if reachable ∩ terminals is empty:
      designate v a Single_Point_Of_Failure; record s among the losing sources
```

Complexity is `O(|C| × |S| × (V + E))`. At the 80-node/200-edge envelope with a typical handful of
sources that is roughly `80 × 4 × 280 ≈ 90k` edge visits — three orders of magnitude inside the
500 ms budget of R39.14, so no reachability-bitset or dominator-tree optimisation is warranted. The
loop yields every 8 candidates to hold main-thread occupancy at ≤33 ms.

Note that the designation is per *source*: a node that is the sole path to a terminal for one source
among several is a SPOF (R39.2), which is stricter than global disconnection and is the behaviour a
user modelling one critical ingress path expects.

Severity comes from fan-in — Critical at ≥3 distinct upstream nodes, Warning at ≤2 (R39.6) — on the
reasoning that a node many callers depend on has a wider consequence than a node one caller depends
on. The recommended action is structural rather than parametric (`StructuralAction` above), and the
tradeoff names the nodes added against the 200-node canvas limit (R39.7).

Blast_Radius is read from the metrics aggregate: `terminatedThroughNodeCount / systemTerminatedCount
× 100`, and it is the Finding's primary evidence entry. Where no completed run is retained the entry
is omitted entirely, the Finding states that Blast_Radius is not applicable because no run has
completed, the losing-source count becomes the primary entry, and confidence is `Low` (R39.5).

#### DISABLE_NODE Chaos Extension

```typescript
export interface ChaosEventPayload {
  chaosType: 'FLUSH_CACHE' | 'DROP_DB' | 'SPIKE_TRAFFIC' | 'DISABLE_NODE' | 'REDRIVE_DLQ';
  targetNodeId?: string;
  durationMs: number;      // DISABLE_NODE: 100–600,000 simulated ms
  params: Record<string, unknown>;
}
```

`injectChaos` currently iterates every node and matches on node *type*. `DISABLE_NODE` and
`REDRIVE_DLQ` are targeted at a single node identifier instead, so the loop gains a targeted branch
before the type-matching one.

`NodeRuntimeState` gains `unreachableUntilMs: number | null`. While set:

- `handleRequestRoute` terminates each arriving request `Timeout` against that node and forwards it
  nowhere, before delegating to the processor (R39.9).
- Requests and Jobs the node was *holding* at the instant of failure — occupying a bounded resource,
  or waiting in a queue, prefetch buffer, or transfer queue — are terminated `Timeout` too. That
  occupancy lives inside the processors, which is why `NodeProcessor.onNodeDisabled` returns the held
  request IDs for the engine to terminate through the single terminal-assignment helper. Bounded
  resources are then held at 0 occupancy.
- A Dead_Letter_Queue is the exception: it retains every held message without termination and
  performs no Redrive while unreachable.
- Re-applying the control to an already-unreachable node is rejected with the remaining duration, and
  no deferred failure is held (R39.10).
- On restoration, bounded resources are at 0 occupancy and a recovery event is logged (R39.11).

Before/after impact (R39.12) compares the last window completing at or before the failure instant
against every window lying *wholly* within the failure interval, excluding partial overlaps at both
ends. Percentage difference is *not applicable* where the pre-failure value is 0, and both figures
are *not applicable* where no window lies wholly inside the interval — which is the common case for a
failure shorter than `metricsIntervalMs`, so it must be stated rather than shown as 0.

---

### Baseline Runs and Comparison (Requirement 40)

```typescript
export interface BaselineRun {
  schemaVersion: 2;
  name: string;                  // 1–40 chars trimmed, case-insensitively unique
  createdAt: string;
  seed: number;
  simulatedDurationMs: number;
  totalOfferedRps: number;
  objective?: ServiceObjective;
  topology: SerializedTopologyV2;         // positions, configs, policies, weights, groups
  wholeRun: WholeRunAggregates;           // R40.6 metrics over the full simulated duration
  perNode: Record<string, PerNodeAggregates>;  // R40.7
}
// localStorage key `analysys_baseline_runs`, at most 5 records.
```

Records are written only from the `Complete` state, and every reported value comes from the run's
**final cumulative** metrics over its full simulated duration — not from a single window and not from
a mean across windows (R40.6). This matters because the shipped `MetricsCollector` prunes
`completedRequests` to a sliding 5,000 ms window; a run-scoped cumulative accumulator is added
alongside it so a baseline is not silently a snapshot of the last five seconds.

On load, records that carry a schema version other than 2 or omit a field are excluded from the list
with a warning naming the record and the problem, and the stored record is left unmodified (R40.4) —
a forward-incompatible baseline is hidden, never deleted.

**Difference convention.** Every signed difference is `run B − run A`, where A is the first selection
and B the second (R40.5). Stating it once, in one place, is what makes CP-14 (antisymmetry under
swapping the selections) hold; percentage difference divides by `|A|` and displays to 2 decimals.

**Node matching across runs (R40.7).** A node is present in both runs when the same identifier
appears in both retained topologies *with the same node type*; failing that, when the identifier
appears in one run only and exactly one node in each run shares the same node type and the same
label under case-insensitive comparison. The fallback exists because a rebuilt topology gets fresh
UUIDs, and without it every comparison of a rebuilt variant would report every node as absent. It is
deliberately restricted to the unambiguous case — exactly one candidate per run — and everything else
is listed as not-present (R40.8) alongside a per-node parameter diff for nodes that did match.

A comparison whose two runs share seed, simulated duration, and offered load within 0.01 RPS is
labelled a Controlled_Comparison; otherwise it is labelled uncontrolled with each differing
attribute named and its value in each run, and the results are still reported (R40.9–R40.10).

---

### Reference Architecture Presets (Requirement 42)

The three existing failure-mode presets stay as they are. Three reference architectures are added
under a distinct group label, stored at schema version 2 with the fields the existing
`PresetTopology` shape already has plus the ones the analysis layer needs:

```typescript
export interface ReferencePreset extends PresetTopology {
  schemaVersion: 2;
  subsystemGroups: SubsystemGroup[];
  seed: number;
  simulatedDurationMs: number;      // long enough to span ≥3 completed metrics windows
  speedMultiplier: number;
  totalOfferedRps: number;
  expectedBottleneckNodeId: string;             // asserted by R42.11
  expectedDominantTerminalStatus: RequestStatus; // one of the eight non-Success, R42.12
}
```

- **Authenticated Web API** — Traffic_Generator → API_Gateway → Rate_Limiter → Auth_Service
  (Introspection, with an edge to the Cache) → Authz_Service → Load_Balancer → 2+ App_Servers →
  Cache/Database/Object_Store, every node reachable from the generator (R42.4).
- **Asynchronous Job Platform** — App_Server → Message_Queue → Worker_Pool (failure rate ≥0.05,
  1–3 retries) → Dead_Letter_Queue, plus Database and Object_Store, tuned so a run at the stored seed
  records at least one Retry_Exhaustion and retains at least one dead-lettered message (R42.5).
- **Scheduled Batch With Live Traffic** — a Scheduler and a Traffic_Generator sharing a path to one
  Database, with interval and start offset set so ≥3 triggers fire within the stored duration
  (R42.6).

`expectedBottleneckNodeId` and `expectedDominantTerminalStatus` are stored, displayed on selection,
and asserted by tests: loading and running a preset at its stored seed, duration, speed, load, and
chaos timeline must produce a Bottleneck Finding naming that node and must make that terminal status
the largest of the eight non-Success counts. That turns each preset into an end-to-end regression
test of the whole analysis pipeline rather than a demo fixture.

Node positions are authored so every rendered node's bounding box is separated from every other by
≥16 logical pixels on one axis at 100% zoom (R42.8), and the load must present a first frame
containing every node and edge within 2,000 ms (R42.14).

---

### Analysis Panel Presentation and Keyboard Operation (Requirement 43)

The panel opens from a control in the Telemetry_Dashboard header — which already hosts the
Charts/Summary toggle — and renders *alongside* the Canvas, leaving pan position, zoom, and node
selection untouched (R43.1). Nothing about reaching the analysis replaces any part of the Canvas
view.

Findings are grouped by category, categories ordered by their position in the eight-value
`FindingCategory` declaration order, Findings within a group by the R35.8 total order (severity, then
descending primary evidence magnitude, then category position, then ascending identifier). A category
holding no Finding contributes no group.

**Activating a Finding drives the Canvas (R43.3, R43.9, R43.10).**

```typescript
function activateFinding(finding: Finding): void {
  const present = finding.subjectNodeIds.filter(id => topology.has(id));
  if (present.length === 0) return;          // system-wide or fully absent: Canvas untouched

  expandGroupsContaining(present);           // collapsed members cannot be selected or framed
  setSelection(present);

  const bounds = boundingBoxOf(present);
  const fitted = zoomToFit(bounds);          // React Flow fitBounds with padding
  if (fitted.zoom < 0.25) {
    setZoom(0.25);
    centerOn(midpointOf(bounds));
    reportOffscreenCount(present.filter(n => !inViewport(n)).length);
  }
}
```

The 0.25 floor exists so a Finding spanning a wide topology does not zoom out to illegibility; when
the floor binds, the panel reports how many subject nodes lie outside the viewport in nodes rather
than pretending they are all visible.

**Accessibility.** Severity is a text label (`Critical`/`Warning`/`Info`) rendered as text at ≥4.5:1
contrast, so it is determinable without color (R43.4) — the same approach the shipped
`HealthLegend` and health badges take. The Finding list is in the tab order, Down/Up move focus
through the display order, Enter and Space activate, Tab and Shift+Tab leave the list, and Escape
returns focus to the control that opened the panel (R43.5, R43.8). Comparison results render as a
table whose data cells are programmatically associated with both their row and column headers, with a
programmatic name naming the two compared runs (R43.6).

Critical Findings appearing during a run are announced through the **existing assertive live region**
in `LiveAnnouncer`, which today keys off event-log entries containing "chaos". It gains an
announced-identifier set per run so a Critical Finding that persists across windows announces exactly
once, and at most one announcement is emitted per metrics window naming the count plus the category
and subject label of the first in display order (R43.7). Without the identifier set, a persistent
Critical Finding would re-announce at every window boundary and make the assertive region unusable.

---

### Extended Worker Communication Protocol

```typescript
export type MainToWorkerMessage =
  // …existing INIT / START / PAUSE / RESUME / RESET / CHAOS_EVENT / UPDATE_CONFIG…
  | { type: 'SWEEP_STEP'; payload: SweepStepRequest }
  | { type: 'SWEEP_CANCEL'; payload: { stepIndex: number } };

export interface SweepStepRequest {
  stepIndex: number;                        // 0-based
  requestedRps: number;
  perGeneratorRps: Record<string, number>;  // computed on the main thread (R38.11)
  durationPerStepMs: number;
  warmUpMs: number;
  speedMultiplier: number;
  seed: number;
}

export type WorkerToMainMessage =
  // …existing METRICS_BATCH / NODE_STATUS / EVENT_LOG / SIM_COMPLETE / ERROR…
  | { type: 'NODE_STATE_CHANGE'; payload: { nodeId: string; unreachable: boolean; atSimTimeMs: number } }
  | { type: 'SWEEP_STEP_COMPLETE'; payload: SweepStepResult };
```

`METRICS_BATCH` keeps its message type and gains the fields listed under *Aggregates the Worker Must
Now Emit*; `NodeMetricsSnapshot.utilization` changes from `number` to `UtilizationReading`, which is
a breaking change for `MetricsSummary`, `QueueGauge`, and `ActivityPanel` and is the reason those
three components appear in the traceability rows for Requirement 29.

Per-node RPS is computed on the main thread and sent as a map rather than having the Worker derive it
from a target aggregate, so the rounding, clamping, and residual-assignment rules of R38.11–R38.12
have exactly one implementation and can be unit-tested without a Worker.

---

### File Structure (Proposed)

```
src/
├── main.tsx                           # App entry point
├── App.tsx                            # Root layout
├── components/
│   ├── canvas/
│   │   ├── CanvasEditor.tsx           # React Flow wrapper
│   │   ├── NodePalette.tsx            # Drag source sidebar (5 groups, 15 types — R29.1)
│   │   ├── nodes/                     # Custom React Flow node components
│   │   │   ├── TrafficGeneratorNode.tsx
│   │   │   ├── ApiGatewayNode.tsx
│   │   │   ├── RateLimiterNode.tsx
│   │   │   ├── LoadBalancerNode.tsx
│   │   │   ├── CircuitBreakerNode.tsx
│   │   │   ├── AppServerNode.tsx
│   │   │   ├── CacheNode.tsx
│   │   │   ├── DatabaseNode.tsx
│   │   │   ├── MessageQueueNode.tsx
│   │   │   ├── AuthServiceNode.tsx        # ── R23–R28 ──
│   │   │   ├── AuthzServiceNode.tsx
│   │   │   ├── WorkerPoolNode.tsx
│   │   │   ├── DeadLetterQueueNode.tsx
│   │   │   ├── ObjectStoreNode.tsx
│   │   │   ├── SchedulerNode.tsx
│   │   │   └── SubsystemGroupNode.tsx     # collapsed group element — R33.6
│   │   ├── groups/
│   │   │   ├── useCollapsedTopologyView.ts # derived RF view + edge merging — R33.6–R33.9
│   │   │   ├── GroupToolbar.tsx            # create/rename/collapse/add/remove — R33.1
│   │   │   └── MergedBoundaryEdge.tsx      # underlying-edge count + hover list — R33.7–R33.8
│   │   └── edges/
│   │       ├── SyncEdge.tsx
│   │       └── AsyncEdge.tsx
│   ├── config/
│   │   ├── NodeConfigPanel.tsx        # Configuration sidebar + Activity view
│   │   ├── forms/                     # one form per new type — R29.6
│   │   │   ├── AuthServiceForm.tsx
│   │   │   ├── AuthzServiceForm.tsx
│   │   │   ├── WorkerPoolForm.tsx
│   │   │   ├── DeadLetterQueueForm.tsx
│   │   │   ├── ObjectStoreForm.tsx
│   │   │   └── SchedulerForm.tsx
│   │   └── RoutingPolicyField.tsx     # policy select + per-edge weights — R32.1, R32.5
│   ├── controls/
│   │   ├── SimulationToolbar.tsx      # Start/Pause/Reset/Speed
│   │   ├── ChaosPanel.tsx             # + DISABLE_NODE and REDRIVE_DLQ controls — R39.8, R26.8
│   │   └── CapacitySweepPanel.tsx     # sweep config, progress, cancel — R38.7, R38.27
│   ├── analysis/                      # ── Analysis_Panel, R43 ──
│   │   ├── AnalysisPanel.tsx          # grouped, ordered, keyboard-operable Finding list
│   │   ├── FindingCard.tsx            # severity text label, evidence, action, tradeoff
│   │   ├── FindingList.tsx            # Down/Up/Enter/Space/Tab handling — R43.5
│   │   ├── ComparisonTable.tsx        # header-associated cells — R43.6
│   │   ├── SweepResultsTable.tsx      # per-step verdicts — R38.21
│   │   ├── HeadroomList.tsx           # per-node and system Headroom — R38.1–R38.5
│   │   ├── SpofList.tsx               # SPOF results and exclusions — R39.13
│   │   └── BaselineManager.tsx        # retain / list / delete / reuse — R40.1–R40.4, R40.13
│   ├── telemetry/
│   │   ├── TelemetryDashboard.tsx     # Chart container + Analysis_Panel launcher — R43.1
│   │   ├── LatencyChart.tsx
│   │   ├── ThroughputChart.tsx
│   │   ├── QueueGauge.tsx
│   │   ├── SubsystemBreakdown.tsx     # per-group rollup — R33.17
│   │   ├── TerminalStatusTable.tsx    # nine statuses, three failure classes — R31.4, R31.8
│   │   └── EventLog.tsx
│   └── presets/
│       └── PresetSelector.tsx         # failure-mode + reference-architecture groups — R42.1
├── store/
│   ├── topologyStore.ts               # nodes, edges, subsystemGroups, routing policies
│   ├── simulationStore.ts             # sim state, metrics, event log
│   ├── persistenceStore.ts            # save/load/export at schema v2
│   ├── analysisStore.ts               # Findings, suppressions, sweep results, comparison
│   └── baselineStore.ts               # ≤5 BaselineRun records — R40.1–R40.4
├── simulation/
│   ├── simulation.worker.ts           # Web Worker entry point
│   ├── engine.ts                      # SimulationEngine class
│   ├── routing.ts                     # resolveTargets, Round_Robin cursors, weight normalisation
│   ├── subRequests.ts                 # branch dispatch / settle, SubRequestPolicy — R32.7–R32.12
│   ├── eventQueue.ts                  # MinHeap implementation
│   ├── prng.ts                        # SeededRNG
│   ├── processors/
│   │   ├── NodeProcessor.ts           # Interface (+ UtilizationReading, window/disable hooks)
│   │   ├── TrafficGeneratorProcessor.ts
│   │   ├── ApiGatewayProcessor.ts
│   │   ├── RateLimiterProcessor.ts
│   │   ├── LoadBalancerProcessor.ts
│   │   ├── CircuitBreakerProcessor.ts
│   │   ├── AppServerProcessor.ts
│   │   ├── CacheProcessor.ts
│   │   ├── DatabaseProcessor.ts
│   │   ├── MessageQueueProcessor.ts   # + BackpressureAwareConsumer check — R25.4
│   │   ├── AuthServiceProcessor.ts        # ── R23–R28 ──
│   │   ├── AuthzServiceProcessor.ts
│   │   ├── WorkerPoolProcessor.ts
│   │   ├── DeadLetterQueueProcessor.ts
│   │   ├── ObjectStoreProcessor.ts
│   │   └── SchedulerProcessor.ts
│   ├── metrics/
│   │   ├── MetricsCollector.ts
│   │   ├── NodeMetricsAccumulator.ts  # Little's Law per-node
│   │   ├── RunCumulativeAccumulator.ts # whole-run aggregates for baselines — R40.6
│   │   ├── MeasurementIntervalAccumulator.ts # warm-up-excluded sweep step — R38.19
│   │   ├── analysisAggregates.ts      # Latency_Share, Blast_Radius, terminal counts — R41.3
│   │   └── percentiles.ts
│   └── types.ts                       # All simulation type definitions
├── analysis/                          # ── Analysis_Engine, main thread ──
│   ├── AnalysisScheduler.ts           # slicing, 33 ms / 500 ms budgets — R41.7–R41.10
│   ├── AnalysisWindowStore.ts         # ring buffer of metrics windows + cumulative totals
│   ├── FindingBuilder.ts              # stable ids, round6, unit enforcement — R35.13, R41.2, R41.11
│   ├── rules/
│   │   ├── index.ts                   # RULE_REGISTRY
│   │   ├── bottleneck.ts              # R36
│   │   ├── saturation.ts              # R37.1
│   │   ├── instability.ts             # R37.2–R37.5, R37.10, R37.11
│   │   ├── reliability.ts             # R37.6, R31.9
│   │   ├── capacity.ts                # R37.7, R38.25, R38.26
│   │   ├── configuration.ts           # R37.8
│   │   ├── headroom.ts                # R38.1–R38.6
│   │   ├── spof.ts                    # R39.2–R39.7
│   │   └── comparison.ts              # R40.11, R40.12
│   ├── reachability.ts                # source→terminal BFS under node removal — R39.2
│   ├── CapacitySweepController.ts     # sequential step orchestration — R38
│   ├── comparison.ts                  # node matching, B − A differences — R40.5–R40.8
│   └── report.ts                      # Analysis_Report JSON + Markdown export/import — R35.10–R35.14
├── validation/
│   ├── edgeValidation.ts              # CONNECTION_RULES, PROTOCOL_OVERRIDES, cardinality — R30
│   ├── cycleDetection.ts              # detectCycles
│   ├── configValidation.ts            # Per-node config validators (15 types)
│   └── groupValidation.ts             # Subsystem_Group invariants + import normalisation — R33
├── presets/
│   ├── dbExhaustion.json
│   ├── queueBackpressure.json
│   ├── cacheStampede.json
│   ├── authenticatedWebApi.json       # ── reference architectures, R42 ──
│   ├── asyncJobPlatform.json
│   └── scheduledBatchWithLiveTraffic.json
├── types/
│   ├── nodes.ts                       # SimulationNode union (15), configs, RoutingPolicy
│   ├── nodeDefaults.ts                # createDefaultNodeData — single source of defaults
│   ├── edges.ts                       # EdgeData (+ weight), EdgeProtocol
│   ├── groups.ts                      # SubsystemGroup
│   ├── messages.ts                    # Worker protocol types (+ SWEEP_*, NODE_STATE_CHANGE)
│   ├── metrics.ts                     # MetricsBatchPayload, UtilizationReading
│   └── findings.ts                    # Finding, EvidenceEntry, categories, severities
└── utils/
    ├── uuid.ts
    ├── round6.ts                      # half-up 6 dp — R41.2
    └── localStorage.ts                # Schema-v2 persistence + migrateV1ToV2
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

The extension for Requirements 23–43 adds these models, all defined in the sections above:

- **SimulationNode** widens from 9 to 15 members, and `BaseNodeData` gains `routingPolicy`
- **EdgeData** gains `weight`; the edge array's order is the stored index the routing policies read
- **SubsystemGroup** — a presentation-only container (`id`, `name`, `memberNodeIds`, `collapsed`) held
  in `topologyStore` and never sent to the Worker
- **SimRequest** gains `fanOutDepth`, `emittedByNodeId`, and the branch/parent fields that make a
  request lineage a bounded tree rather than a line
- **RequestStatus** widens to 9 terminal statuses plus `In_Flight`, grouped into three
  `FailureClass` values with `Success` in none
- **UtilizationReading** — a discriminated reading that distinguishes an idle `0.0` from a
  *not applicable* measure, replacing the bare `number` on `NodeMetricsSnapshot`
- **NodeMetricsSnapshot** gains the analysis aggregates (per-status counts, Latency_Share numerator
  and denominator, Blast_Radius numerator, monitored depth and bound, per-edge forwarded counts),
  because Requirement 41.3 forbids the analysis layer from reading per-request records
- **Finding / EvidenceEntry / RecommendedAction / StructuralAction** — the analysis output model,
  with a derived stable identifier and every numeric value rounded to 6 decimal places half-up
- **SweepConfig / SweepStepRequest / SweepStepResult** — capacity sweep orchestration
- **BaselineRun** — a retained completed run: seed, duration, offered load, topology, and whole-run
  and per-node aggregates
- **SerializedTopologyV2** and **MigrationWarning** — schema version 2 and its in-memory-only
  migration from version 1

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Properties 1 through 6 cover the shipped engine (Requirements 1 through 22). Properties 7 through 27
cover the capabilities added by Requirements 23 through 43 and retain their CP-1 through CP-21 labels,
which the sections above cite by name.

### Property 1: Determinism

For all topologies, configurations, and seeds, running the simulation twice with the same seed and topology produces identical event sequences and identical metrics. Guaranteed by the seeded xoshiro128** PRNG and deterministic min-heap ordering (timestamp-based, tie-broken by monotonic event ID).

**Validates: Requirements 5.3, 5.4**

### Property 2: Little's Law Validation

For all nodes in steady state, the deviation |L - λW| / L remains below 5%. This validates that the simulation's queuing behavior is internally consistent.

**Validates: Requirements 6.6**

### Property 3: Cycle Guard

For all requests, a traversal exceeding `maxHops` (default 20) terminates with `LoopDetected` status, preventing infinite loops in cyclic topologies.

**Validates: Requirements 13.1**

### Property 4: Event Ordering

For all event sequences, the min-heap processes events in non-decreasing timestamp order, and events with equal timestamps are processed in insertion order (FIFO via monotonic ID).

**Validates: Requirements 5.1, 5.2**

### Property 5: Resource Conservation

For all runs, active connections never exceed pool size and buffer occupancy never exceeds capacity. Overflow triggers backpressure or drop behavior per node configuration.

**Validates: Requirements 6.2, 6.3, 19.3**

### Property 6: Graph Validity

For all proposed edges, an edge is created only if it conforms to the connection compatibility matrix; self-referencing edges and duplicate connections are rejected, and cycle detection warns before simulation start.

**Validates: Requirements 2.6, 13.2**

### Property 7: Analysis determinism (CP-1)

For all topologies, seeds, offered loads, and simulated durations, running the simulation twice and computing Findings from each run yields two Finding sets of equal size in which the Findings of a given stable identifier compare equal character-for-character on category, severity, confidence, constraint statement, recommended action, tradeoff statement, analysis window bounds, subject node identifier set, and evidence metric names and units, and compare equal under exact numeric comparison on every numeric value after that value is rounded to 6 decimal places half-up, and both sets present in the same display order.

**Validates: Requirements 41.1, 41.2, 35.8**

### Property 8: Analysis Report round trip (CP-2)

For all Analysis_Reports, exporting to JSON and importing the result yields a Finding set equal to the original.

**Validates: Requirements 35.12**

### Property 9: Topology serialization round trip (CP-3)

For all topologies containing new node types, routing policies, edge weights, and Subsystem_Groups, exporting to schema version 2 and importing the result yields an equal topology.

**Validates: Requirements 34.5**

### Property 10: Schema v1 behavioral equivalence (CP-4)

For all schema version 1 topologies, the metrics produced after migration to schema version 2 equal the metrics produced before this feature, given the same seed.

**Validates: Requirements 32.13, 34.4, 34.10**

### Property 11: Terminal status partition (CP-5)

For all runs and at every simulated instant, the sum of the cumulative counts of the nine terminal statuses equals the count of requests and Jobs that have left the system and are not In_Flight; each such request or Job is counted under exactly one of the nine statuses and against exactly one node identifier; each Redrive of a Job decrements the retaining Dead_Letter_Queue node's cumulative Dead_Lettered count by one and returns that Job to In_Flight; a Fan_Out parent request and every branch it dispatched together contribute exactly one termination to the system-wide counts; and the In_Flight count at the Complete state is excluded from every cumulative terminal status count.

**Validates: Requirements 31.1, 31.2, 31.3, 31.4, 31.6, 31.7**

### Property 12: Grouping invariance (CP-6)

For all topologies and all sets of Subsystem_Groups over them, the metrics of a run are independent of which groups are collapsed and of whether any node belongs to a group.

**Validates: Requirements 33.12**

### Property 13: Resource conservation for new node types (CP-7)

For all runs, executing Jobs at a Worker_Pool never exceeds its configured concurrency and its prefetch buffer never holds more than its configured prefetch buffer depth; occupied concurrency slots at an Auth_Service or an Authz_Service never exceed that node's configured concurrency limit and its queue never holds more than its configured queue depth; retained messages at a Dead_Letter_Queue never exceed its configured capacity; and active transfers at an Object_Store never exceed its configured max concurrent transfers while its transfer queue never holds more than its configured transfer queue depth.

**Validates: Requirements 23.7, 23.8, 24.8, 24.9, 25.1, 25.3, 26.3, 27.8, 27.9**

### Property 14: Retry budget bound (CP-8)

For all Jobs at a Worker_Pool, the total attempt count is at most `max retries + 1`, and a Job reaching that bound terminates as Retry_Exhausted or arrives at a Dead_Letter_Queue.

**Validates: Requirements 25.6, 25.8, 25.9**

### Property 15: Weight normalization idempotence (CP-9)

For all sets of edge weights, normalizing twice yields the same result as normalizing once, and the normalized weights sum to 1.0 within floating-point tolerance.

**Validates: Requirements 32.5**

### Property 16: Fan-out latency is the maximum (CP-10)

For all Fan_Out nodes, the parent request resumes only after every branch it dispatched has settled, where a branch settles on reaching a terminal status, on its response traversal reaching the fan-out node, or, for a branch dispatched along an Asynchronous edge, at the instant its target node accepts or terminates it; and the latency added to the parent request equals the greatest dispatch-to-settle interval among those branches and is therefore at least the interval of every individual branch.

**Validates: Requirements 32.9**

### Property 17: Evidence completeness (CP-11)

For all Findings, the evidence set is non-empty and every entry carries a numeric value and a unit.

**Validates: Requirements 35.2**

### Property 18: Sweep offered loads are strictly increasing (CP-12)

For all Capacity_Sweeps of `N` steps over a starting and an ending offered load, the applied offered RPS of step `n+1` exceeds that of step `n` for every `n` from 0 to `N-2`, step 0 holds the starting offered load, step `N-1` holds the ending offered load, and every step holds the same topology, seed, speed multiplier, routing policies, edge weights, and node configuration other than the per-generator RPS values.

**Validates: Requirements 38.9, 38.10, 38.15**

### Property 19: Single-point-of-failure soundness (CP-13)

For all topologies, a node reported as a Single_Point_Of_Failure has at least one source node that reaches 1 or more Terminal_Nodes in the intact graph and 0 Terminal_Nodes in the graph with that node and its incident edges removed; and for a node not so reported, every source node reaching 1 or more Terminal_Nodes in the intact graph still reaches 1 or more Terminal_Nodes under that removal.

**Validates: Requirements 39.2**

### Property 20: Comparison antisymmetry (CP-14)

For all pairs of distinct runs, every signed absolute difference reported by comparing run A to run B under the run-B-minus-run-A rule equals the negation of the signed absolute difference reported by comparing run B to run A, and the two comparisons report the same set of metrics and the same set of nodes present in both runs.

**Validates: Requirements 40.5, 40.6, 40.7**

### Property 21: Scheduler emission count (CP-15)

For all Scheduler nodes under the Allow overlap policy, the total Jobs emitted equals the trigger count multiplied by jobs per trigger.

**Validates: Requirements 28.4**

### Property 22: Bandwidth bound at Object_Store (CP-16)

For all runs, the aggregate transfer rate measured at an Object_Store over any metrics window does not exceed its configured throughput capacity, and the sum of the bandwidth shares of its active transfers equals that capacity while at least one transfer is active.

**Validates: Requirements 27.5, 27.10**

### Property 23: Fan-out depth bound (CP-17)

For all runs, every request and Job holds a Fan_Out_Depth in the range 0 to 4; a request emitted by a Traffic_Generator node or a Scheduler node holds a Fan_Out_Depth of 0; each branch holds its parent's Fan_Out_Depth plus 1; and a request arriving at a Fan_Out node at a Fan_Out_Depth of 4 is forwarded along exactly one outgoing edge and dispatches no branch.

**Validates: Requirements 32.7, 32.8**

### Property 24: Round_Robin selection determinism (CP-18)

For all nodes whose routing policy is Round_Robin, two runs of the same topology, configuration, and seed produce an identical sequence of outgoing edge selections at that node; the sequence cycles through that node's outgoing edges in ascending stored index order and returns to the lowest stored index after the highest; the cursor is at the lowest stored index at the start of a run and after a reset; and a pause followed by a resume leaves the cursor unchanged.

**Validates: Requirements 32.3**

### Property 25: Scheduler schedule holds no drift (CP-19)

For all Scheduler nodes, the scheduled trigger time of trigger index `n` equals `start offset + n * interval` irrespective of every jitter offset drawn and every skip, deferral, or overlap outcome; each fire time equals its scheduled trigger time plus a per-trigger offset in the inclusive range 0 to the lesser of the configured jitter and the configured interval; and the fire time of trigger index `n` is at or before the fire time of trigger index `n+1`.

**Validates: Requirements 28.2, 28.3**

### Property 26: Subsystem_Group membership is a partition (CP-20)

For all topologies, each node belongs to at most one Subsystem_Group, no Subsystem_Group is a member of another Subsystem_Group, every retained Subsystem_Group holds 2 to 50 member nodes, and a topology holds at most 20 Subsystem_Groups; these hold after every create, rename, add-to-group, remove-from-group, delete, node deletion, and import operation.

**Validates: Requirements 33.2, 33.3, 33.20, 33.22, 33.23, 33.26**

### Property 27: Finding identifier invariance (CP-21)

For all Findings, the stable identifier is determined by the producing rule identifier, the category, and the ascending-sorted subject node identifiers alone; it is unchanged by any change to a subject node's user-assigned label, by recomputation within a run, and across repeated runs of the same topology, configuration, seed, and offered load; and at most one Finding per identifier appears in a single analysis result.

**Validates: Requirements 35.13**

---

## Error Handling

- **Worker Errors**: Uncaught exceptions in the Web Worker are caught and forwarded to the main thread via `{ type: 'ERROR', payload: { message, stack } }`. The simulation transitions to `Complete` state and surfaces the error in the UI.
- **Invalid Topology**: If the graph has no traffic generators or disconnected components, simulation initialization rejects with a descriptive validation error before entering the event loop.
- **Queue Overflow**: When a node's request queue exceeds `requestQueueDepth`, incoming requests are dropped with `RequestDrop` events and counted in the error rate metric.
- **Connection Pool Exhaustion**: When all database connections are occupied, requests are queued up to `requestQueueDepth`. If the queue is also full, requests are dropped. Lock timeouts produce `RequestTimeout` events.
- **Message Queue Backpressure**: When buffer occupancy exceeds `backpressureThresholdPct`, the configured strategy is applied (DROP_OLDEST removes the oldest buffered message, BLOCK_PRODUCER delays the producer event, REJECT_NEW drops the incoming message).
- **No Route**: If a traffic generator has no outgoing edges, requests are immediately marked `NoRoute` and recorded as errors.
- **Import Validation**: JSON topology imports are validated against the connection rules and config constraints. Invalid imports surface specific validation errors without corrupting the store.

The extension adds these cases. The organising rule is that an *absent* field is defaulted, an
*out-of-range* field is clamped, and a *structurally invalid* record is rejected — all three with an
explicit, named report rather than a silent fix.

- **Not-applicable versus zero**: `UtilizationReading` is a discriminated union, so a bounded resource
  of zero, an unavailable bound, and a genuine idle `0.0` are three distinct outcomes rather than one
  ambiguous number. Every derived surface — health status, Headroom, group rollups, Bottleneck
  eligibility — branches on the discriminant and reports a plain-language reason where no number
  exists (R29.11–13, R38.2, R33.18).
- **Sub-request failure**: a failed branch never leaves its parent stranded. The parent terminates
  with the branch's status (Fan_Out), as `Unauthenticated` (Auth introspection), or with the lookup's
  status plus the lookup target's identifier (Authz), and every unsettled sibling is discarded
  without being counted under any terminal status.
- **Stale scheduled events**: Worker_Pool attempt timeouts and Object_Store transfer completions are
  both races against a competing event. Each carries an epoch; the loser is discarded. Without the
  epoch a completed attempt would later be timed out and double-counted.
- **Weight sum of zero or non-finite**: falls back to uniform `1/outDegree` with a normalisation
  warning naming the node. No forwarding decision divides by zero, and no request is terminated for
  want of a weight (R32.6).
- **Node unreachable (DISABLE_NODE)**: every request the node holds and every request that arrives
  while it is unreachable terminates `Timeout` against that node; a Dead_Letter_Queue instead retains
  its messages and performs no Redrive. Re-applying the control to an already-failed node is rejected
  with the remaining duration rather than queued (R39.9–R39.11).
- **Analysis budget exhaustion**: a recomputation that reaches 500 ms stops at the end of the slice in
  progress, keeps displaying the previously completed Finding set, never shows a partial set, and
  reports the count and identifiers of the rules that did not complete (R41.10).
- **Analysis rule suppression**: a rule whose required metric is not applicable or absent emits no
  Finding for the affected nodes while every other rule runs unchanged; the panel names the suppressed
  rule, the missing metric, and each affected node label (R41.5).
- **Insufficient data**: fewer than 3 completed metrics windows yields no Findings and a statement of
  the completed count against the 3 required. This is deliberately distinct from a completed analysis
  that produced no Findings, which states the analysis window bounds instead (R41.6, R43.11).
- **Sweep validation and cancellation**: an out-of-range parameter, an ending load at or below the
  starting load, a step count exceeding the distinct whole-RPS values in range, or a topology with no
  Traffic_Generator all prevent the sweep from starting, leaving the Canvas untouched. Cancellation
  retains completed steps, discards the in-progress step, and reports the sweep as cancelled.
- **Baseline record incompatibility**: a stored baseline at an unsupported schema version or missing a
  field is excluded from the list with a warning and left unmodified on disk — hidden, not deleted
  (R40.4).
- **Dead-letter overflow and retention expiry**: both discard a message and log an event naming the
  node. Expiry is evaluated on the metrics-window schedule, before per-window counters reset, so a
  message cannot expire unobserved (R26.4–R26.5).

---

## Testing Strategy

- **Unit Tests**: Each processor, the MinHeap, SeededRNG, NodeMetricsAccumulator, and edge/cycle validators are tested in isolation using Vitest. Tests verify deterministic output given fixed seeds and inputs.
- **Integration Tests**: The SimulationEngine is tested end-to-end with small topologies (2-5 nodes), verifying that metrics converge to expected steady-state values and that Little's Law deviation stays below threshold.
- **PRNG Determinism Tests**: Run the same seed twice and assert byte-identical event sequences.
- **Boundary Tests**: Zero RPS, max pool size, empty topology, single-node topology, fully saturated queues, and maximum hop count scenarios.
- **Performance Benchmarks**: Verify that the engine processes ≥1,000 events/sec (wall clock) for topologies up to 200 nodes, measured via `eventsPerSecond` in `SimulationSummary`.
- **Worker Communication Tests**: Mock `postMessage` to verify the correct message sequence (INIT → START → METRICS_BATCH* → SIM_COMPLETE) and that PAUSE/RESUME/RESET commands are handled within one batch cycle.

### Engine Test Harness Requirement

Every test that constructs a `SimulationEngine` and calls `run()` **must** pass
`disablePacing: true` in `SimulationEngineConfig`. Without it, `yieldToMacroTask` sleeps
`max(1, 50 / speedMultiplier)` wall-clock milliseconds after each 200-event batch, which is the
pacing that keeps the UI responsive in production and which makes the events-per-second benchmark
(PB-1, R5.5, R34.2) fail in CI. The existing `engine.test.ts` fixture already sets it; the new
processor and analysis tests inherit the same fixture rather than building their own config objects.

### Property-Based Testing

Properties 1 through 27 are exercised with [fast-check](https://github.com/dubzzz/fast-check) under
Vitest — a library, not a hand-rolled generator. Each property is implemented as a **single**
property-based test, configured with `{ numRuns: 100 }` at minimum, and tagged with a comment
referencing the design property:

```typescript
// Feature: analysys, Property 11: Terminal status partition — for all runs and at every
// simulated instant, the nine cumulative terminal counts sum to the number of requests
// and Jobs that have left the system and are not In_Flight.
it('partitions every terminated request under exactly one status and one node', () => {
  fc.assert(
    fc.property(arbTopology(), fc.integer(), (topology, seed) => { /* … */ }),
    { numRuns: 100 },
  );
});
```

Three generator families carry most of the load:

- **`arbTopology()`** — a valid graph over the fifteen node types built by construction rather than by
  filtering: pick a source, then extend only along pairs permitted by `CONNECTION_RULES` and
  `PROTOCOL_OVERRIDES`, so every generated topology is legal by construction and the generator does
  not spend its budget rejecting samples. Parameterised to force the shapes the properties need —
  Fan_Out nodes at varying depth for Properties 16 and 23, Worker_Pool with a Dead_Letter_Queue for
  Properties 13 and 14, several Traffic_Generators for Property 18.
- **`arbConfig(nodeType)`** — parameters drawn across each R23–R28 range including both bounds, with
  the degenerate values called out in the requirements (hit ratio 0.0 and 1.0, `maxRetries` 0,
  `queueDepth` 0, `jitter` above `interval`) given explicit weight rather than left to chance. These
  are the edge cases the prework classified as `EDGE_CASE`: the generators cover them, so they need no
  separate example test.
- **`arbSubsystemGroups(nodes)`** — a random partition of a node subset into 0–20 groups of 2–50, used
  by Properties 12 and 26.

Which properties are run against what:

| Property | Exercised by |
|----------|--------------|
| 7 (analysis determinism), 24 (Round_Robin), 25 (Scheduler drift) | Two full runs at one seed; compare the Finding set, the edge-selection sequence, and the fire-time sequence |
| 9, 10 (serialization / v1 equivalence) | Round-trip through `serialize`/`deserialize`; for v1, compare final metrics before and after migration |
| 8 (report round trip) | `report.ts` export → import, in memory, no simulation |
| 11, 13, 14, 22, 23 (invariants) | Assertions evaluated **at every metrics snapshot** of a generated run, not only at the end, since the invariants are stated per instant |
| 12, 26 (grouping) | One run per generated group set over the same topology and seed; assert metric equality and the membership partition after each store mutation |
| 15 (weight normalisation), 21 (Scheduler count) | Pure-function tests, no engine |
| 16 (fan-out maximum) | Generated branch latencies including a mixture of Sync and Async edges; assert the parent's added latency equals the maximum settle interval |
| 17 (evidence), 27 (identifier) | Generated Finding sets through `FindingBuilder`, plus assertions over the Findings of every engine-backed property run |
| 18 (sweep monotonicity) | `CapacitySweepController` with a stubbed Worker; the RPS split is a pure function and is tested directly |
| 19 (SPOF soundness) | Generated graphs checked against an independent brute-force reachability oracle — model-based testing, the naive implementation validating the sliced one |
| 20 (comparison antisymmetry) | Two generated `BaselineRun` records compared in both orders |

Alongside the property tests, example-based and integration tests cover what property tests should
not:

- **Example-based unit tests** for the specific scenarios the prework classified as `EXAMPLE`: the
  first-trigger-at-t=0 case for a Scheduler with zero offset, the exact Skip and Queue overlap
  transitions, the deferred-trigger-overflow log entry, the Redrive decrement of a `Dead_Lettered`
  count, and each rejection message required by Requirement 30.
- **Integration tests** for the R29.5 smoke condition: each of the six new types at default
  configuration, wired to a default source, runs 60 simulated seconds with no validation error, no
  engine error, and at least one terminal status recorded at that node. Also the three reference
  presets, each asserted to produce its stored expected Bottleneck and expected dominant terminal
  status (R42.11–R42.12) — the closest thing the suite has to an end-to-end test of the whole
  pipeline.
- **Performance benchmarks** at the 80-node/200-edge envelope: engine throughput ≥1,000 events per
  wall-clock second (R34.2), full Finding recomputation ≤500 ms as the maximum over 10 consecutive
  recomputations (R41.8), longest main-thread slice ≤33 ms (R41.9), SPOF analysis ≤500 ms (R39.14),
  and an 8-step sweep at 50× completing within 90 s (R38.29). The slice-occupancy measurement
  instruments `AnalysisScheduler` directly rather than sampling frame times, so it measures what the
  requirement states.
- **Accessibility tests** for the Analysis_Panel: keyboard-only traversal of the Finding list, the
  header association of the comparison table, focus return on Escape, and exactly one assertive
  announcement per run per Critical Finding identifier (R43.5–R43.8).

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

### Extension Decisions (Requirements 23–43)

Each row states what was chosen, what was rejected, and why the rejected option loses.

| Decision | Rejected alternative | Rationale |
|----------|---------------------|-----------|
| **Analysis Engine on the main thread with cooperative 33 ms slicing** | (a) Inside the simulation Worker; (b) a second dedicated Worker | (a) The Worker's loop must sustain ≥1,000 events/s (R5.5, R34.2); a 500 ms analysis pass would either stall it or have to interleave with the `BATCH_SIZE = 200` yield rhythm that PAUSE and CHAOS delivery depend on. (b) A second Worker needs the full topology and label set cloned per recomputation; structured-clone cost at 80 nodes eats a real share of the 500 ms budget it was meant to protect, and the analysis needs main-thread-only data anyway (labels for R35.9, event log for R37.8, group state for R43.3). Slicing keeps ≥30 fps without moving the work. |
| **Fan-out as a branch tree, each branch's `path` rooted at the dispatch node** | Flatten branches into the parent's single `path` array | The shipped response phase walks `path` backwards one index per hop. Flattening would make the reverse walk ambiguous — it could not tell where one branch ended and the next began — and would let a branch's response traverse upstream of the fan-out node, contradicting R32.10. Rooting each branch at the dispatch node means index 0 of the branch path *is* the join point, so the branch response terminates there structurally, and the parent's own traversal stays exactly the linear walk already implemented. |
| **One shared sub-request mechanism for Fan_Out, Auth introspection, and Authz lookups** | A bespoke mechanism per node type | R32.9, R23.5, and R24.4 all specify the same semantics: dispatch N calls at one timestamp, hold the caller's resource, resume when all settle, add the greatest settle interval. They differ only in N and in how a failed call maps to the caller's status, which is a policy parameter. Three implementations of "wait for all, take the max" would be three places for the in-flight accounting to go wrong. |
| **Routing state (Round_Robin cursors, weights) held in the engine, not in processors** | Each processor owns its own cursor | Routing applies to all fifteen types; the existing `LoadBalancerProcessor.roundRobinIndex` shows what per-processor cursors look like, and duplicating that fifteen times guarantees drift in reset and pause semantics. One engine-owned map gives R32.3's reset-and-pause behaviour a single implementation. |
| **Custom collapsed-group element plus a derived view** | React Flow `parentId` / `extent: 'parent'` parent nodes | `parentId` makes child positions *relative to the parent*, so grouping and ungrouping would rewrite every member's stored position and turn R33.11 and R33.24 (positions restored exactly) into arithmetic. Parent nodes also always render their children, so R33.9's "no element per contained node" would require unmounting and losing selection, and no parent-node feature merges boundary edges with a count (R33.7). |
| **Grouping never reaches the engine; `getTopologySnapshot()` unchanged** | Send group membership in `INIT` for group-level metrics | Sending groups would make CP-6 (metrics independent of grouping) a property to be tested rather than a fact by construction, and would make R33.13 (mutate groups in any simulation state without disturbing pending events) an engine concern. Group rollups are sums over member snapshots and are cheap on the main thread. |
| **Sequential capacity sweep steps** | Parallel steps in several Workers | Each step is a full run at up to 50,000 in-flight requests; N concurrent Workers multiply peak memory by N and contend for cores on the 4-core baseline, which would slow each step. Sequential execution already meets the 90 s target for 8 steps at 50× (R38.29), so parallelism buys nothing measurable at the cost of the memory ceiling. Listed as an open question in the requirements; this design answers it as sequential. |
| **Analysis aggregates precomputed in metrics snapshots** | Retain per-request records on the main thread and derive Latency_Share and Blast_Radius from them | R41.3 forbids it outright, and for good reason: at 50,000 concurrent in-flight requests, retaining per-request paths would grow without bound in the Worker and cost a large structured clone per batch. The Worker already holds each request when it assigns a terminal status, so accumulating `timeInSystemAtNodeMs`, `pathTimeInSystemMs`, and `terminatedThroughNodeCount` there is O(1) per termination and makes both quantities window-scoped for free. |
| **`UtilizationReading` discriminated union replacing `number`** | Sentinel values (`-1`, `NaN`, `null`) for not-applicable | R29.11–13, R33.18, and R38.2 all require *not applicable* plus a plain-language reason to be distinguishable from a measured `0.0`. A sentinel carries no reason and is one forgotten comparison away from being rendered as a number; the union forces every consumer to branch. The cost is a breaking change to three telemetry components, which the compiler enumerates. |
| **`routingPolicy` on `BaseNodeData`, not in each config** | A field in every per-type config interface | Six copies of the same field, and `UPDATE_CONFIG` merges arbitrary keys into `node.config`, so a config-resident routing policy could be changed mid-run by a message intended for parameters. It also lets one engine-side resolver read the policy for all fifteen types. |
| **Sub-request/attempt epochs to invalidate stale events** | Cancel or remove events from the min-heap | `MinHeap` supports insert and extract-min only; adding removal or decrease-key would complicate the hot path that carries the ≥1,000 events/s guarantee. An epoch check at handling time is O(1) and keeps the heap untouched, matching how the engine already discards stale events by checking `status !== InFlight`. |
| **Object_Store write multiplier encoded as scaled remaining *work*** | Multiply the computed transfer duration after the fact | Bandwidth is re-divided whenever a transfer starts or finishes (R27.6), so there is no single "computed duration" to multiply. Scaling the work makes R27.7 exact under repricing while leaving the sum of active bandwidth shares equal to capacity (CP-16); the reported byte rate uses the unscaled size so a write-heavy window does not over-report throughput. |
| **Message_Queue asks its consumer for admission capacity** | Worker_Pool pushes a pause/resume signal upstream | R25.4 requires the backlog to accumulate in the upstream queue and be bounded by *that queue's* capacity. A pull-side capacity query fits the existing `onConsumerPoll` loop with a one-line change and cannot desynchronise; a push signal introduces a second piece of state that can be missed if the pool drains between poll ticks. |
| **Migration applied in memory only, stored record left at v1** | Rewrite stored records to v2 on load | Rewriting on load makes merely *opening* a build destructive: a user who loads a topology in a v2 build and then returns to a v1 build finds unreadable records. R34.10 makes the upgrade happen on the next explicit save, which is the point at which the user has asked for a write. |

---

## Open Questions Answered by This Design

The requirements document leaves two questions open. This design answers both, and records the answers
here so they are not re-litigated during implementation.

- **Should Auth_Service and Authz_Service be one node type with a mode switch?** No — two types. They
  have materially different behaviour, not just different parameters: Authz_Service issues 1–50 lookups
  per request and takes the maximum of their round trips (R24.4), while Auth_Service issues at most one
  (R23.5); their terminal statuses differ (`Unauthenticated` versus `Forbidden`, which R31.5 both
  classify as admission-control but which R35 Findings must tell apart); and modelling them separately
  is what lets the analysis attribute a bottleneck to identity verification rather than to policy
  evaluation. A single type with a mode switch would collapse that attribution, which is the whole
  point of the analysis layer.
- **Should Capacity_Sweep steps run in parallel Workers?** No — sequential. See the Extension
  Decisions row above.

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

### Requirements 23–43

| Requirement | Design Section | Key Types/Functions |
|-------------|---------------|---------------------|
| 23 (Auth_Service node) | Six New Node Types → Auth_Service Processor | `AuthServiceConfig`, `VerificationMode`, `AuthServiceProcessor`, `SubRequestPolicy.AuthIntrospection`, `RequestStatus.Unauthenticated` |
| 24 (Authz_Service node) | Six New Node Types → Authz_Service Processor | `AuthzServiceConfig`, `AuthzServiceProcessor`, `SubRequestPolicy.AuthzLookup`, `RequestStatus.Forbidden` |
| 25 (Worker_Pool node) | Six New Node Types → Worker_Pool Processor | `WorkerPoolConfig`, `RetryBackoff`, `WorkerPoolProcessor`, `WorkerPoolState`, `BackpressureAwareConsumer`, `JobAdmit`/`JobAttemptComplete`/`JobRetryReady`/`JobTimeout` |
| 26 (Dead_Letter_Queue node) | Six New Node Types → Dead_Letter_Queue Processor | `DeadLetterQueueConfig`, `RedriveMode`, `RetainedMessage`, `DeadLetterQueueProcessor`, `onMetricsWindowBoundary`, `SimulationEngine.unmarkRequestDone` |
| 27 (Object_Store node) | Six New Node Types → Object_Store Processor | `ObjectStoreConfig`, `ObjectStoreProcessor`, `ActiveTransfer`, `reprice()`, `TransferComplete` |
| 28 (Scheduler node) | Six New Node Types → Scheduler Processor | `SchedulerConfig`, `OverlapPolicy`, `SchedulerProcessor`, `SchedulerTrigger`, `SimRequest.emittedByNodeId` |
| 29 (New node type integration) | Change Surface; Utilization Mapping; File Structure | `NodeType` (15), `createDefaultNodeData`, `validateNodeConfig`, `normalizeConfig`, `UtilizationReading`, `NODE_TYPE_LABELS`, `NodeTypeIcon`, `UTILIZATION_NOTES`, `PALETTE_CATEGORIES`, `MetricsSummary`/`QueueGauge`/`ActivityPanel` |
| 30 (Connection rules) | Connection Rules for the New Node Types | `CONNECTION_RULES`, `PROTOCOL_OVERRIDES`, `validateEdgeConnection`, `getValidProtocols`, `detectCycles` |
| 31 (Terminal status partition) | Terminal Status Partition and Event Types | `RequestStatus` (9 terminal), `TERMINAL_STATUSES`, `FailureClass`, `NodeRuntimeState.terminalCounts`, `cumulativeTerminalCounts`, `TerminalStatusTable` |
| 32 (Routing and fan-out) | Downstream Routing Policies and Fan-Out | `RoutingPolicy`, `resolveTargets`, `roundRobinCursors`, `EdgeData.weight`, `SimRequest.fanOutDepth`/`pendingBranchIds`, `SubRequestSettled`, `recordBranchTermination` |
| 33 (Subsystem grouping) | Subsystem Grouping | `SubsystemGroup`, `topologyStore` group actions, `useCollapsedTopologyView`, `SubsystemGroupNode`, `MergedBoundaryEdge`, `groupValidation.ts`, `SubsystemBreakdown` |
| 34 (Schema v2 and migration) | Schema Version 2 and Migration | `CURRENT_SCHEMA_VERSION = 2`, `SerializedTopologyV2`, `migrateV1ToV2`, `MigrationWarning`, `validateAnalysysSchema`, `getStorageUsage` |
| 35 (Finding model and report) | Analysis Engine → The Finding Model | `Finding`, `EvidenceEntry`, `RecommendedAction`, `FindingCategory`, `FindingBuilder`, `round6`, `report.ts` |
| 36 (Bottleneck ranking) | Analysis Engine → Bottleneck, Saturation, Instability | `bottleneckRankRule`, `bottleneckCoLimitingRule`, `bottleneckNoConstraintRule`, `bottleneckNoneEligibleRule`, `timeInSystemAtNodeMs`/`pathTimeInSystemMs` |
| 37 (Saturation and instability) | Analysis Engine → Bottleneck, Saturation, Instability; Per-Window Rate Hazard | `saturationRule`, `instabilityDepthGrowthRule`, `instabilityLittlesLawRule`, `dlqGrowthRule`, `workerPoolConcurrencyRule`, `schedulerCollisionRule`, `monitoredDepth` |
| 38 (Headroom and sustainable load) | Capacity Sweep Orchestration; `headroomRule` | `SweepConfig`, `SweepStepRequest`, `SweepStepResult`, `CapacitySweepController`, `MeasurementIntervalAccumulator`, `headroomRule`, `sweepKneeRule`, `CapacitySweepPanel` |
| 39 (SPOF, blast radius, node failure) | Single Point of Failure, Blast Radius, and Node Failure | `reachability.ts`, `spofRule`, `StructuralAction`, `terminatedThroughNodeCount`, `ChaosEventPayload.DISABLE_NODE`, `NodeRuntimeState.unreachableUntilMs`, `onNodeDisabled`/`onNodeRestored`, `NODE_STATE_CHANGE` |
| 40 (Baselines and comparison) | Baseline Runs and Comparison | `BaselineRun`, `baselineStore`, `RunCumulativeAccumulator`, `comparison.ts`, `comparisonObjectiveRule`, `comparisonUtilizationRule`, `ComparisonTable`, `BaselineManager` |
| 41 (Integrity and reproducibility) | Analysis Engine → Slicing Scheduler; Per-Window Rate Hazard; Aggregates | `AnalysisScheduler.recompute`, `SLICE_BUDGET_MS`, `TOTAL_BUDGET_MS`, `yieldToFrame`, `round6`, `AnalysisWindowStore`, `analysisAggregates.ts` |
| 42 (Reference presets) | Reference Architecture Presets | `ReferencePreset`, `authenticatedWebApi.json`, `asyncJobPlatform.json`, `scheduledBatchWithLiveTraffic.json`, `PresetSelector` |
| 43 (Analysis Panel and a11y) | Analysis Panel Presentation and Keyboard Operation | `AnalysisPanel`, `FindingList`, `FindingCard`, `activateFinding`, `ComparisonTable`, `LiveAnnouncer` announced-identifier set |
