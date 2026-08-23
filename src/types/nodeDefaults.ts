import type { SimulationNode } from './nodes';
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
} from './nodes';

// ─── Default Configurations Per Node Type ────────────────────────

/**
 * Builds a fully-populated SimulationNode with sensible defaults for the
 * given node type. Shared by the canvas drop handler and the palette's
 * keyboard placement path so the two never drift apart.
 */
export function createDefaultNodeData(
  nodeType: NodeType,
  position: { x: number; y: number },
): SimulationNode {
  const id = crypto.randomUUID();
  // R32.1 — every newly placed node routes with First until the user changes it.
  const base = { id, position, routingPolicy: RoutingPolicy.First };

  switch (nodeType) {
    case NodeType.TrafficGenerator:
      return {
        ...base,
        nodeType: NodeType.TrafficGenerator,
        label: 'Traffic Generator',
        config: {
          rps: 100,
          distribution: Distribution.Poisson,
          spikeMultiplier: 1,
          spikeDurationSec: 10,
        },
      };
    case NodeType.ApiGateway:
      return {
        ...base,
        nodeType: NodeType.ApiGateway,
        label: 'API Gateway',
        config: {
          authLatencyMeanMs: 5,
          authLatencyStdDevMs: 2,
          rejectionRate: 0.02,
        },
      };
    case NodeType.RateLimiter:
      return {
        ...base,
        nodeType: NodeType.RateLimiter,
        label: 'Rate Limiter',
        config: {
          bucketCapacity: 100,
          refillRatePerSec: 50,
        },
      };
    case NodeType.LoadBalancer:
      return {
        ...base,
        nodeType: NodeType.LoadBalancer,
        label: 'Load Balancer',
        config: {
          algorithm: LBAlgorithm.RoundRobin,
          healthCheckIntervalMs: 5000,
          evictionThreshold: 3,
        },
      };
    case NodeType.CircuitBreaker:
      return {
        ...base,
        nodeType: NodeType.CircuitBreaker,
        label: 'Circuit Breaker',
        config: {
          errorThreshold: 0.5,
          openDurationMs: 5000,
          probeCount: 3,
        },
      };
    case NodeType.AppServer:
      return {
        ...base,
        nodeType: NodeType.AppServer,
        label: 'App Server',
        config: {
          workerThreadPoolSize: 16,
          requestQueueDepth: 100,
          processingTimeMeanMs: 50,
          processingTimeStdDevMs: 15,
        },
      };
    case NodeType.Cache:
      return {
        ...base,
        nodeType: NodeType.Cache,
        label: 'Cache',
        config: {
          hitRatio: 0.85,
          evictionPolicy: EvictionPolicy.LRU,
          accessLatencyMs: 2,
        },
      };
    case NodeType.Database:
      return {
        ...base,
        nodeType: NodeType.Database,
        label: 'Database',
        config: {
          connectionPoolSize: 20,
          queryLatencyMeanMs: 25,
          queryLatencyStdDevMs: 10,
          lockTimeoutMs: 5000,
          dbType: DatabaseType.Relational,
        },
      };
    case NodeType.MessageQueue:
      return {
        ...base,
        nodeType: NodeType.MessageQueue,
        label: 'Message Queue',
        config: {
          consumerBatchSize: 10,
          bufferCapacity: 10000,
          backpressureThresholdPct: 80,
          backpressureStrategy: BackpressureStrategy.RejectNew,
        },
      };
    case NodeType.AuthService:
      return {
        ...base,
        nodeType: NodeType.AuthService,
        label: 'Auth Service',
        config: {
          verificationMode: VerificationMode.Local,
          verificationLatencyMeanMs: 3,
          verificationLatencyStdDevMs: 1,
          concurrencyLimit: 64,
          queueDepth: 100,
          tokenCacheHitRatio: 0.9,
          credentialFailureRate: 0.01,
        },
      };
    case NodeType.AuthzService:
      return {
        ...base,
        nodeType: NodeType.AuthzService,
        label: 'Authz Service',
        config: {
          policyLatencyMeanMs: 4,
          policyLatencyStdDevMs: 1.5,
          policyCacheHitRatio: 0.9,
          lookupsPerRequest: 1,
          denyRate: 0.01,
          concurrencyLimit: 64,
          queueDepth: 100,
        },
      };
    case NodeType.WorkerPool:
      return {
        ...base,
        nodeType: NodeType.WorkerPool,
        label: 'Worker Pool',
        config: {
          concurrency: 8,
          jobProcessingMeanMs: 200,
          jobProcessingStdDevMs: 50,
          prefetchBufferDepth: 100,
          jobFailureRate: 0.02,
          maxRetries: 3,
          retryBackoff: RetryBackoff.Exponential,
          retryBaseDelayMs: 1000,
          jobTimeoutMs: 30000,
        },
      };
    case NodeType.DeadLetterQueue:
      return {
        ...base,
        nodeType: NodeType.DeadLetterQueue,
        label: 'Dead Letter Queue',
        config: {
          capacity: 10000,
          retentionPeriodMs: 86400000,
          redriveMode: RedriveMode.Manual,
          redriveIntervalMs: 60000,
          redriveBatchSize: 10,
          maxRedriveAttempts: 3,
        },
      };
    case NodeType.ObjectStore:
      return {
        ...base,
        nodeType: NodeType.ObjectStore,
        label: 'Object Store',
        config: {
          objectSizeMeanKB: 256,
          objectSizeStdDevKB: 64,
          throughputCapacityMBps: 100,
          baseLatencyMeanMs: 10,
          baseLatencyStdDevMs: 3,
          maxConcurrentTransfers: 64,
          transferQueueDepth: 100,
          readFraction: 0.8,
          writeLatencyMultiplier: 1.5,
        },
      };
    case NodeType.Scheduler:
      return {
        ...base,
        nodeType: NodeType.Scheduler,
        label: 'Scheduler',
        config: {
          intervalMs: 60000,
          jobsPerTrigger: 50,
          startOffsetMs: 0,
          jitterMs: 0,
          overlapPolicy: OverlapPolicy.Skip,
          maxDeferredTriggers: 10,
        },
      };
  }
}
