/**
 * Property-based testing arbitraries for the Analysys simulation engine.
 *
 * arbTopology() — builds valid topologies by construction (not filtering).
 * arbConfig(nodeType) — draws configs within R23-R28 parameter ranges.
 * arbSubsystemGroups(nodes) — random partition into 0-20 groups.
 */
import * as fc from 'fast-check';
import {
  NodeType,
  Distribution,
  LBAlgorithm,
  EvictionPolicy,
  DatabaseType,
  BackpressureStrategy,
  VerificationMode,
  RetryBackoff,
  RedriveMode,
  OverlapPolicy,
  RoutingPolicy,
} from '@/types/nodes';
import type {
  SimulationNode,
  TrafficGeneratorConfig,
  ApiGatewayConfig,
  RateLimiterConfig,
  LoadBalancerConfig,
  CircuitBreakerConfig,
  AppServerConfig,
  CacheConfig,
  DatabaseConfig,
  MessageQueueConfig,
  AuthServiceConfig,
  AuthzServiceConfig,
  WorkerPoolConfig,
  DeadLetterQueueConfig,
  ObjectStoreConfig,
  SchedulerConfig,
} from '@/types/nodes';
import type { EdgeData } from '@/types/edges';
import { EdgeProtocol } from '@/types/edges';
import { CONNECTION_RULES, PROTOCOL_OVERRIDES } from '@/validation/edgeValidation';
import type { SubsystemGroup } from '@/types/groups';

// ─── Helpers ─────────────────────────────────────────────────────

let nodeCounter = 0;
function freshId(prefix: string): string {
  return `${prefix}-${++nodeCounter}`;
}

function resetCounter(): void {
  nodeCounter = 0;
}

// All node types for reference (used by topology builder internally)

// ─── arbConfig(nodeType) ─────────────────────────────────────────

/**
 * Generates a valid configuration for the given node type, drawing parameters
 * from their full R23-R28 ranges with explicit weights on degenerate edge values.
 */
export function arbConfig(nodeType: NodeType): fc.Arbitrary<Record<string, unknown>> {
  switch (nodeType) {
    case NodeType.TrafficGenerator:
      return fc.record<TrafficGeneratorConfig>({
        // Bounded so generated engines stay fast now that POISSON rates are
        // honored correctly (a 100k-RPS generator over a 10s horizon would emit
        // a million requests per fast-check iteration). Invariants under test
        // do not depend on extreme magnitudes.
        rps: fc.integer({ min: 1, max: 1_000 }),
        distribution: fc.constantFrom(Distribution.Poisson, Distribution.Uniform),
        spikeMultiplier: fc.integer({ min: 1, max: 20 }),
        spikeDurationSec: fc.integer({ min: 0, max: 300 }),
      }) as fc.Arbitrary<Record<string, unknown>>;

    case NodeType.ApiGateway:
      return fc.record<ApiGatewayConfig>({
        authLatencyMeanMs: fc.integer({ min: 0, max: 60_000 }),
        authLatencyStdDevMs: fc.integer({ min: 0, max: 30_000 }),
        rejectionRate: fc.oneof(
          { weight: 1, arbitrary: fc.constant(0.0) },
          { weight: 1, arbitrary: fc.constant(1.0) },
          { weight: 8, arbitrary: fc.double({ min: 0, max: 1, noNaN: true }) },
        ),
      }) as fc.Arbitrary<Record<string, unknown>>;

    case NodeType.RateLimiter:
      return fc.record<RateLimiterConfig>({
        bucketCapacity: fc.integer({ min: 1, max: 1_000_000 }),
        refillRatePerSec: fc.integer({ min: 1, max: 1_000_000 }),
      }) as fc.Arbitrary<Record<string, unknown>>;

    case NodeType.LoadBalancer:
      return fc.record<LoadBalancerConfig>({
        algorithm: fc.constantFrom(LBAlgorithm.RoundRobin, LBAlgorithm.LeastConnections),
        healthCheckIntervalMs: fc.integer({ min: 100, max: 60_000 }),
        evictionThreshold: fc.integer({ min: 1, max: 100 }),
      }) as fc.Arbitrary<Record<string, unknown>>;

    case NodeType.CircuitBreaker:
      return fc.record<CircuitBreakerConfig>({
        errorThreshold: fc.double({ min: 0, max: 1, noNaN: true }),
        openDurationMs: fc.integer({ min: 100, max: 300_000 }),
        probeCount: fc.integer({ min: 1, max: 1_000 }),
      }) as fc.Arbitrary<Record<string, unknown>>;

    case NodeType.AppServer:
      return fc.record<AppServerConfig>({
        workerThreadPoolSize: fc.integer({ min: 1, max: 1_000 }),
        requestQueueDepth: fc.oneof(
          { weight: 1, arbitrary: fc.constant(0) },
          { weight: 9, arbitrary: fc.integer({ min: 0, max: 10_000 }) },
        ),
        processingTimeMeanMs: fc.integer({ min: 1, max: 10_000 }),
        processingTimeStdDevMs: fc.integer({ min: 0, max: 5_000 }),
      }) as fc.Arbitrary<Record<string, unknown>>;

    case NodeType.Cache:
      return fc.record<CacheConfig>({
        hitRatio: fc.oneof(
          { weight: 1, arbitrary: fc.constant(0.0) },
          { weight: 1, arbitrary: fc.constant(1.0) },
          { weight: 8, arbitrary: fc.double({ min: 0, max: 1, noNaN: true }) },
        ),
        evictionPolicy: fc.constantFrom(EvictionPolicy.LRU, EvictionPolicy.LFU, EvictionPolicy.TTL),
        accessLatencyMs: fc.integer({ min: 0, max: 1_000 }),
      }) as fc.Arbitrary<Record<string, unknown>>;

    case NodeType.Database:
      return fc.record<DatabaseConfig>({
        connectionPoolSize: fc.integer({ min: 1, max: 500 }),
        queryLatencyMeanMs: fc.integer({ min: 1, max: 10_000 }),
        queryLatencyStdDevMs: fc.integer({ min: 0, max: 5_000 }),
        lockTimeoutMs: fc.integer({ min: 100, max: 30_000 }),
        dbType: fc.constantFrom(DatabaseType.Relational, DatabaseType.NoSQL),
      }) as fc.Arbitrary<Record<string, unknown>>;

    case NodeType.MessageQueue:
      return fc.record<MessageQueueConfig>({
        consumerBatchSize: fc.integer({ min: 1, max: 10_000 }),
        bufferCapacity: fc.integer({ min: 10, max: 1_000_000 }),
        backpressureThresholdPct: fc.integer({ min: 1, max: 100 }),
        backpressureStrategy: fc.constantFrom(
          BackpressureStrategy.DropOldest,
          BackpressureStrategy.BlockProducer,
          BackpressureStrategy.RejectNew,
        ),
      }) as fc.Arbitrary<Record<string, unknown>>;

    case NodeType.AuthService:
      return fc.record<AuthServiceConfig>({
        verificationMode: fc.constantFrom(VerificationMode.Local, VerificationMode.Introspection),
        verificationLatencyMeanMs: fc.integer({ min: 0, max: 60_000 }),
        verificationLatencyStdDevMs: fc.integer({ min: 0, max: 30_000 }),
        concurrencyLimit: fc.integer({ min: 1, max: 10_000 }),
        queueDepth: fc.oneof(
          { weight: 1, arbitrary: fc.constant(0) },
          { weight: 9, arbitrary: fc.integer({ min: 0, max: 10_000 }) },
        ),
        tokenCacheHitRatio: fc.oneof(
          { weight: 1, arbitrary: fc.constant(0.0) },
          { weight: 1, arbitrary: fc.constant(1.0) },
          { weight: 8, arbitrary: fc.double({ min: 0, max: 1, noNaN: true }) },
        ),
        credentialFailureRate: fc.double({ min: 0, max: 1, noNaN: true }),
      }) as fc.Arbitrary<Record<string, unknown>>;

    case NodeType.AuthzService:
      return fc.record<AuthzServiceConfig>({
        policyLatencyMeanMs: fc.integer({ min: 0, max: 60_000 }),
        policyLatencyStdDevMs: fc.integer({ min: 0, max: 30_000 }),
        policyCacheHitRatio: fc.oneof(
          { weight: 1, arbitrary: fc.constant(0.0) },
          { weight: 1, arbitrary: fc.constant(1.0) },
          { weight: 8, arbitrary: fc.double({ min: 0, max: 1, noNaN: true }) },
        ),
        lookupsPerRequest: fc.integer({ min: 1, max: 50 }),
        denyRate: fc.double({ min: 0, max: 1, noNaN: true }),
        concurrencyLimit: fc.integer({ min: 1, max: 10_000 }),
        queueDepth: fc.oneof(
          { weight: 1, arbitrary: fc.constant(0) },
          { weight: 9, arbitrary: fc.integer({ min: 0, max: 10_000 }) },
        ),
      }) as fc.Arbitrary<Record<string, unknown>>;

    case NodeType.WorkerPool:
      return fc.record<WorkerPoolConfig>({
        concurrency: fc.integer({ min: 1, max: 10_000 }),
        jobProcessingMeanMs: fc.integer({ min: 0, max: 600_000 }),
        jobProcessingStdDevMs: fc.integer({ min: 0, max: 300_000 }),
        prefetchBufferDepth: fc.integer({ min: 0, max: 10_000 }),
        jobFailureRate: fc.double({ min: 0, max: 1, noNaN: true }),
        maxRetries: fc.oneof(
          { weight: 2, arbitrary: fc.constant(0) },
          { weight: 8, arbitrary: fc.integer({ min: 0, max: 10 }) },
        ),
        retryBackoff: fc.constantFrom(RetryBackoff.Fixed, RetryBackoff.Exponential),
        retryBaseDelayMs: fc.integer({ min: 1, max: 300_000 }),
        jobTimeoutMs: fc.integer({ min: 1, max: 600_000 }),
      }) as fc.Arbitrary<Record<string, unknown>>;

    case NodeType.DeadLetterQueue:
      return fc.record<DeadLetterQueueConfig>({
        capacity: fc.integer({ min: 1, max: 1_000_000 }),
        retentionPeriodMs: fc.integer({ min: 1, max: 2_592_000_000 }),
        redriveMode: fc.constantFrom(RedriveMode.Manual, RedriveMode.Automatic),
        redriveIntervalMs: fc.integer({ min: 1, max: 300_000 }),
        redriveBatchSize: fc.integer({ min: 1, max: 10_000 }),
        maxRedriveAttempts: fc.integer({ min: 0, max: 10 }),
      }) as fc.Arbitrary<Record<string, unknown>>;

    case NodeType.ObjectStore:
      return fc.record<ObjectStoreConfig>({
        objectSizeMeanKB: fc.integer({ min: 1, max: 10_485_760 }),
        objectSizeStdDevKB: fc.integer({ min: 0, max: 10_485_760 }),
        throughputCapacityMBps: fc.double({ min: 0.1, max: 100_000, noNaN: true }),
        baseLatencyMeanMs: fc.integer({ min: 0, max: 60_000 }),
        baseLatencyStdDevMs: fc.integer({ min: 0, max: 30_000 }),
        maxConcurrentTransfers: fc.integer({ min: 1, max: 100_000 }),
        transferQueueDepth: fc.integer({ min: 0, max: 10_000 }),
        readFraction: fc.double({ min: 0, max: 1, noNaN: true }),
        writeLatencyMultiplier: fc.double({ min: 1.0, max: 100.0, noNaN: true }),
      }) as fc.Arbitrary<Record<string, unknown>>;

    case NodeType.Scheduler:
      return fc.record<SchedulerConfig>({
        intervalMs: fc.integer({ min: 100, max: 86_400_000 }),
        jobsPerTrigger: fc.integer({ min: 1, max: 100_000 }),
        startOffsetMs: fc.integer({ min: 0, max: 86_400_000 }),
        jitterMs: fc.oneof(
          // Degenerate: jitter above interval exercised via high values
          { weight: 2, arbitrary: fc.integer({ min: 50_000, max: 86_400_000 }) },
          { weight: 8, arbitrary: fc.integer({ min: 0, max: 86_400_000 }) },
        ),
        overlapPolicy: fc.constantFrom(
          OverlapPolicy.Allow,
          OverlapPolicy.Skip,
          OverlapPolicy.Queue,
        ),
        maxDeferredTriggers: fc.integer({ min: 1, max: 1_000 }),
      }) as fc.Arbitrary<Record<string, unknown>>;
  }
}

// ─── arbTopology() ───────────────────────────────────────────────

/**
 * Options for arbTopology to ensure certain structural properties.
 */
export interface TopologyOptions {
  /** Force at least this many Traffic_Generators. Default: 1. */
  minTrafficGenerators?: number;
  /** Force at least one Fan_Out node at a given depth. */
  forceFanOut?: boolean;
  /** Force a Worker_Pool + Dead_Letter_Queue chain. */
  forceWorkerPoolWithDlq?: boolean;
  /** Minimum total node count. Default: 3. */
  minNodes?: number;
  /** Maximum total node count. Default: 15. */
  maxNodes?: number;
}

/**
 * Builds a valid simulation topology **by construction** rather than by filtering.
 *
 * Strategy: start with source nodes (TrafficGenerators/Schedulers), then extend the
 * graph by repeatedly picking a leaf node and connecting it to a compatible target
 * (drawn from CONNECTION_RULES). This guarantees every generated topology is valid.
 */
export function arbTopology(opts: TopologyOptions = {}): fc.Arbitrary<{
  nodes: SimulationNode[];
  edges: EdgeData[];
}> {
  const minTGs = opts.minTrafficGenerators ?? 1;
  const minNodes = opts.minNodes ?? 3;
  const maxNodes = opts.maxNodes ?? 15;
  const forceFanOut = opts.forceFanOut ?? false;
  const forceDlq = opts.forceWorkerPoolWithDlq ?? false;

  return fc
    .record({
      seed: fc.integer({ min: 0, max: 2 ** 32 - 1 }),
      tgCount: fc.integer({ min: minTGs, max: Math.min(minTGs + 2, 4) }),
      extraNodes: fc.integer({ min: minNodes - 1, max: maxNodes }),
    })
    .chain(({ seed, tgCount, extraNodes }) => {
      return fc.constant(null).map(() => {
        resetCounter();
        const rng = mulberry32(seed);
        const nodes: SimulationNode[] = [];
        const edges: EdgeData[] = [];
        const nodeMap = new Map<string, SimulationNode>();

        // Helper: pick a random element from an array
        function pick<T>(arr: T[]): T {
          return arr[Math.floor(rng() * arr.length)]!;
        }

        // Helper: get valid protocols for a pair
        function getProtocols(sourceType: NodeType, targetType: NodeType): EdgeProtocol[] {
          const key = `${sourceType}->${targetType}` as `${NodeType}->${NodeType}`;
          return PROTOCOL_OVERRIDES[key] ?? CONNECTION_RULES[sourceType].allowedProtocols;
        }

        // Helper: create a node of a given type
        function createNode(type: NodeType): SimulationNode {
          const id = freshId(type.toLowerCase().replace(/_/g, '-'));
          const routingPolicy =
            forceFanOut && nodes.length > tgCount + 1
              ? pick([
                  RoutingPolicy.First,
                  RoutingPolicy.RoundRobin,
                  RoutingPolicy.Weighted,
                  RoutingPolicy.FanOut,
                ])
              : pick([RoutingPolicy.First, RoutingPolicy.RoundRobin, RoutingPolicy.Weighted]);
          const node = {
            id,
            nodeType: type,
            label: `${type} ${id}`,
            position: { x: nodes.length * 200, y: 0 },
            routingPolicy,
            config: defaultConfig(type),
          } as unknown as SimulationNode;
          nodes.push(node);
          nodeMap.set(id, node);
          return node;
        }

        // Step 1: Create Traffic Generators
        for (let i = 0; i < tgCount; i++) {
          createNode(NodeType.TrafficGenerator);
        }

        // Step 2: Create at least one reachable target for each TG
        const firstTarget = createNode(
          pick([NodeType.ApiGateway, NodeType.AppServer, NodeType.RateLimiter]),
        );
        for (const tg of nodes.filter((n) => n.nodeType === NodeType.TrafficGenerator)) {
          const protocols = getProtocols(tg.nodeType, firstTarget.nodeType);
          edges.push({
            id: freshId('e'),
            source: tg.id,
            target: firstTarget.id,
            protocol: pick(protocols),
            weight: 1.0,
          });
        }

        // Step 3: Extend the graph by picking a leaf and adding a downstream node
        const targetNodeCount = Math.max(minNodes, Math.min(extraNodes, maxNodes));
        let attempts = 0;
        while (nodes.length < targetNodeCount && attempts < targetNodeCount * 3) {
          attempts++;
          // Pick a random existing node that has allowed targets
          const candidates = nodes.filter(
            (n) => CONNECTION_RULES[n.nodeType].allowedTargets.length > 0,
          );
          if (candidates.length === 0) break;

          const source = pick(candidates);
          const allowedTargets = CONNECTION_RULES[source.nodeType].allowedTargets;
          const targetType = pick(allowedTargets);

          // Don't create duplicate edges
          const existingTarget = nodes.find(
            (n) =>
              n.nodeType === targetType &&
              !edges.some((e) => e.source === source.id && e.target === n.id),
          );

          let target: SimulationNode;
          if (existingTarget && rng() < 0.4) {
            // Reuse existing node
            target = existingTarget;
          } else {
            target = createNode(targetType);
          }

          const protocols = getProtocols(source.nodeType, target.nodeType);
          if (protocols.length === 0) continue;

          // Check DLQ cardinality
          if (
            source.nodeType === NodeType.WorkerPool &&
            target.nodeType === NodeType.DeadLetterQueue
          ) {
            const existingDlq = edges.some(
              (e) =>
                e.source === source.id &&
                nodeMap.get(e.target)?.nodeType === NodeType.DeadLetterQueue,
            );
            if (existingDlq) continue;
          }

          // Check no duplicate
          if (edges.some((e) => e.source === source.id && e.target === target.id)) continue;

          edges.push({
            id: freshId('e'),
            source: source.id,
            target: target.id,
            protocol: pick(protocols),
            weight: Math.round((0.5 + rng() * 1.5) * 100) / 100,
          });
        }

        // Step 4: Force Worker_Pool + DLQ if requested
        if (forceDlq) {
          const wp =
            nodes.find((n) => n.nodeType === NodeType.WorkerPool) ??
            createNode(NodeType.WorkerPool);
          const dlq =
            nodes.find((n) => n.nodeType === NodeType.DeadLetterQueue) ??
            createNode(NodeType.DeadLetterQueue);
          // Ensure MQ → WP edge
          const mq =
            nodes.find((n) => n.nodeType === NodeType.MessageQueue) ??
            createNode(NodeType.MessageQueue);
          if (!edges.some((e) => e.source === mq.id && e.target === wp.id)) {
            edges.push({
              id: freshId('e'),
              source: mq.id,
              target: wp.id,
              protocol: EdgeProtocol.Async,
              weight: 1.0,
            });
          }
          if (!edges.some((e) => e.source === wp.id && e.target === dlq.id)) {
            edges.push({
              id: freshId('e'),
              source: wp.id,
              target: dlq.id,
              protocol: EdgeProtocol.Async,
              weight: 1.0,
            });
          }
          // Connect a TG to MQ
          const tg = nodes.find((n) => n.nodeType === NodeType.TrafficGenerator)!;
          if (!edges.some((e) => e.source === tg.id && e.target === mq.id)) {
            edges.push({
              id: freshId('e'),
              source: tg.id,
              target: mq.id,
              protocol: EdgeProtocol.Async,
              weight: 1.0,
            });
          }
        }

        return { nodes, edges };
      });
    });
}

// ─── arbSubsystemGroups ──────────────────────────────────────────

/**
 * Generates a random partition of a node subset into 0 to 20 groups of 2 to 50 members.
 */
export function arbSubsystemGroups(nodeIds: string[]): fc.Arbitrary<SubsystemGroup[]> {
  if (nodeIds.length < 2) return fc.constant([]);

  return fc
    .integer({ min: 0, max: Math.min(20, Math.floor(nodeIds.length / 2)) })
    .chain((groupCount) => {
      if (groupCount === 0) return fc.constant([]);
      return fc
        .shuffledSubarray(nodeIds, { minLength: groupCount * 2, maxLength: nodeIds.length })
        .map((shuffled) => {
          const groups: SubsystemGroup[] = [];
          let offset = 0;
          const perGroup = Math.max(2, Math.min(50, Math.floor(shuffled.length / groupCount)));

          for (let i = 0; i < groupCount && offset < shuffled.length; i++) {
            const size = Math.min(perGroup, shuffled.length - offset);
            if (size < 2) break;
            groups.push({
              id: `grp-${i}`,
              name: `Group ${i + 1}`,
              memberNodeIds: shuffled.slice(offset, offset + size),
              collapsed: false,
            });
            offset += size;
          }
          return groups;
        });
    });
}

// ─── Default configs (for topology builder) ──────────────────────

function defaultConfig(type: NodeType): Record<string, unknown> {
  switch (type) {
    case NodeType.TrafficGenerator:
      return {
        rps: 100,
        distribution: Distribution.Poisson,
        spikeMultiplier: 1,
        spikeDurationSec: 0,
      };
    case NodeType.ApiGateway:
      return { authLatencyMeanMs: 5, authLatencyStdDevMs: 1, rejectionRate: 0.01 };
    case NodeType.RateLimiter:
      return { bucketCapacity: 10_000, refillRatePerSec: 1_000 };
    case NodeType.LoadBalancer:
      return {
        algorithm: LBAlgorithm.RoundRobin,
        healthCheckIntervalMs: 5000,
        evictionThreshold: 3,
      };
    case NodeType.CircuitBreaker:
      return { errorThreshold: 0.5, openDurationMs: 5000, probeCount: 3 };
    case NodeType.AppServer:
      return {
        workerThreadPoolSize: 50,
        requestQueueDepth: 200,
        processingTimeMeanMs: 10,
        processingTimeStdDevMs: 2,
      };
    case NodeType.Cache:
      return { hitRatio: 0.8, evictionPolicy: EvictionPolicy.LRU, accessLatencyMs: 1 };
    case NodeType.Database:
      return {
        connectionPoolSize: 50,
        queryLatencyMeanMs: 10,
        queryLatencyStdDevMs: 3,
        lockTimeoutMs: 5000,
        dbType: DatabaseType.Relational,
      };
    case NodeType.MessageQueue:
      return {
        consumerBatchSize: 10,
        bufferCapacity: 10_000,
        backpressureThresholdPct: 80,
        backpressureStrategy: BackpressureStrategy.RejectNew,
      };
    case NodeType.AuthService:
      return {
        verificationMode: VerificationMode.Local,
        verificationLatencyMeanMs: 5,
        verificationLatencyStdDevMs: 1,
        concurrencyLimit: 100,
        queueDepth: 200,
        tokenCacheHitRatio: 0.9,
        credentialFailureRate: 0.01,
      };
    case NodeType.AuthzService:
      return {
        policyLatencyMeanMs: 5,
        policyLatencyStdDevMs: 1,
        policyCacheHitRatio: 0.8,
        lookupsPerRequest: 1,
        denyRate: 0.02,
        concurrencyLimit: 100,
        queueDepth: 200,
      };
    case NodeType.WorkerPool:
      return {
        concurrency: 10,
        jobProcessingMeanMs: 100,
        jobProcessingStdDevMs: 20,
        prefetchBufferDepth: 50,
        jobFailureRate: 0.05,
        maxRetries: 3,
        retryBackoff: RetryBackoff.Exponential,
        retryBaseDelayMs: 1000,
        jobTimeoutMs: 30_000,
      };
    case NodeType.DeadLetterQueue:
      return {
        capacity: 10_000,
        retentionPeriodMs: 86_400_000,
        redriveMode: RedriveMode.Manual,
        redriveIntervalMs: 60_000,
        redriveBatchSize: 10,
        maxRedriveAttempts: 3,
      };
    case NodeType.ObjectStore:
      return {
        objectSizeMeanKB: 1024,
        objectSizeStdDevKB: 256,
        throughputCapacityMBps: 100,
        baseLatencyMeanMs: 10,
        baseLatencyStdDevMs: 3,
        maxConcurrentTransfers: 100,
        transferQueueDepth: 200,
        readFraction: 0.7,
        writeLatencyMultiplier: 2.0,
      };
    case NodeType.Scheduler:
      return {
        intervalMs: 10_000,
        jobsPerTrigger: 10,
        startOffsetMs: 0,
        jitterMs: 0,
        overlapPolicy: OverlapPolicy.Allow,
        maxDeferredTriggers: 10,
      };
  }
}

// ─── Simple PRNG for topology generation ─────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export { defaultConfig, resetCounter };
