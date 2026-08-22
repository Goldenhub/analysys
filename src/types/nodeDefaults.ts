import type { SimulationNode } from './nodes';
import {
  NodeType,
  Distribution,
  LBAlgorithm,
  EvictionPolicy,
  DatabaseType,
  BackpressureStrategy,
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
  const base = { id, position };

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
  }
}
