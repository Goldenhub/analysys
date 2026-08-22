import { describe, it, expect } from 'vitest';
import {
  validateTrafficGeneratorConfig,
  validateLoadBalancerConfig,
  validateAppServerConfig,
  validateCacheConfig,
  validateDatabaseConfig,
  validateMessageQueueConfig,
  validateAuthServiceConfig,
  validateAuthzServiceConfig,
  validateWorkerPoolConfig,
  validateDeadLetterQueueConfig,
  validateObjectStoreConfig,
  validateSchedulerConfig,
  normalizeConfig,
} from './configValidation';
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
import type { SimulationNode } from '@/types/nodes';

// ─── TrafficGenerator Config ─────────────────────────────────────

describe('validateTrafficGeneratorConfig', () => {
  const validConfig = { rps: 100, distribution: Distribution.Poisson, spikeMultiplier: 5, spikeDurationSec: 10 };

  it('accepts a valid config', () => {
    const result = validateTrafficGeneratorConfig(validConfig);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects rps of 0', () => {
    const result = validateTrafficGeneratorConfig({ ...validConfig, rps: 0 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'rps')).toBe(true);
  });

  it('rejects rps above 100000', () => {
    const result = validateTrafficGeneratorConfig({ ...validConfig, rps: 100_001 });
    expect(result.valid).toBe(false);
  });

  it('rejects negative spikeMultiplier', () => {
    const result = validateTrafficGeneratorConfig({ ...validConfig, spikeMultiplier: -1 });
    expect(result.valid).toBe(false);
  });

  it('rejects NaN rps', () => {
    const result = validateTrafficGeneratorConfig({ ...validConfig, rps: NaN });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'rps')).toBe(true);
  });

  it('rejects negative spikeDurationSec', () => {
    const result = validateTrafficGeneratorConfig({ ...validConfig, spikeDurationSec: -5 });
    expect(result.valid).toBe(false);
  });
});

// ─── LoadBalancer Config ─────────────────────────────────────────

describe('validateLoadBalancerConfig', () => {
  const validConfig = { algorithm: LBAlgorithm.RoundRobin, healthCheckIntervalMs: 5000, evictionThreshold: 3 };

  it('accepts a valid config', () => {
    const result = validateLoadBalancerConfig(validConfig);
    expect(result.valid).toBe(true);
  });

  it('rejects zero healthCheckIntervalMs', () => {
    const result = validateLoadBalancerConfig({ ...validConfig, healthCheckIntervalMs: 0 });
    expect(result.valid).toBe(false);
  });

  it('rejects negative evictionThreshold', () => {
    const result = validateLoadBalancerConfig({ ...validConfig, evictionThreshold: -1 });
    expect(result.valid).toBe(false);
  });

  it('rejects NaN healthCheckIntervalMs', () => {
    const result = validateLoadBalancerConfig({ ...validConfig, healthCheckIntervalMs: NaN });
    expect(result.valid).toBe(false);
  });
});

// ─── AppServer Config ────────────────────────────────────────────

describe('validateAppServerConfig', () => {
  const validConfig = { workerThreadPoolSize: 10, requestQueueDepth: 100, processingTimeMeanMs: 5, processingTimeStdDevMs: 1 };

  it('accepts a valid config', () => {
    const result = validateAppServerConfig(validConfig);
    expect(result.valid).toBe(true);
  });

  it('rejects workerThreadPoolSize of 0', () => {
    const result = validateAppServerConfig({ ...validConfig, workerThreadPoolSize: 0 });
    expect(result.valid).toBe(false);
  });

  it('rejects workerThreadPoolSize above 1000', () => {
    const result = validateAppServerConfig({ ...validConfig, workerThreadPoolSize: 1001 });
    expect(result.valid).toBe(false);
  });

  it('allows requestQueueDepth of 0', () => {
    const result = validateAppServerConfig({ ...validConfig, requestQueueDepth: 0 });
    expect(result.valid).toBe(true);
  });

  it('rejects negative processingTimeMeanMs', () => {
    const result = validateAppServerConfig({ ...validConfig, processingTimeMeanMs: -1 });
    expect(result.valid).toBe(false);
  });

  it('rejects NaN processingTimeStdDevMs', () => {
    const result = validateAppServerConfig({ ...validConfig, processingTimeStdDevMs: NaN });
    expect(result.valid).toBe(false);
  });
});

// ─── Cache Config ────────────────────────────────────────────────

describe('validateCacheConfig', () => {
  const validConfig = { hitRatio: 0.9, evictionPolicy: EvictionPolicy.LRU, accessLatencyMs: 1 };

  it('accepts a valid config', () => {
    const result = validateCacheConfig(validConfig);
    expect(result.valid).toBe(true);
  });

  it('accepts hitRatio of 0', () => {
    const result = validateCacheConfig({ ...validConfig, hitRatio: 0 });
    expect(result.valid).toBe(true);
  });

  it('accepts hitRatio of 1', () => {
    const result = validateCacheConfig({ ...validConfig, hitRatio: 1 });
    expect(result.valid).toBe(true);
  });

  it('rejects hitRatio above 1', () => {
    const result = validateCacheConfig({ ...validConfig, hitRatio: 1.5 });
    expect(result.valid).toBe(false);
  });

  it('rejects negative accessLatencyMs', () => {
    const result = validateCacheConfig({ ...validConfig, accessLatencyMs: -1 });
    expect(result.valid).toBe(false);
  });
});

// ─── Database Config ─────────────────────────────────────────────

describe('validateDatabaseConfig', () => {
  const validConfig = { connectionPoolSize: 20, queryLatencyMeanMs: 10, queryLatencyStdDevMs: 2, lockTimeoutMs: 5000, dbType: DatabaseType.Relational };

  it('accepts a valid config', () => {
    const result = validateDatabaseConfig(validConfig);
    expect(result.valid).toBe(true);
  });

  it('rejects connectionPoolSize of 0', () => {
    const result = validateDatabaseConfig({ ...validConfig, connectionPoolSize: 0 });
    expect(result.valid).toBe(false);
  });

  it('rejects connectionPoolSize above 500', () => {
    const result = validateDatabaseConfig({ ...validConfig, connectionPoolSize: 501 });
    expect(result.valid).toBe(false);
  });

  it('rejects negative queryLatencyMeanMs', () => {
    const result = validateDatabaseConfig({ ...validConfig, queryLatencyMeanMs: -1 });
    expect(result.valid).toBe(false);
  });

  it('rejects zero lockTimeoutMs', () => {
    const result = validateDatabaseConfig({ ...validConfig, lockTimeoutMs: 0 });
    expect(result.valid).toBe(false);
  });

  it('rejects NaN queryLatencyStdDevMs', () => {
    const result = validateDatabaseConfig({ ...validConfig, queryLatencyStdDevMs: NaN });
    expect(result.valid).toBe(false);
  });
});

// ─── MessageQueue Config ─────────────────────────────────────────

describe('validateMessageQueueConfig', () => {
  const validConfig = { consumerBatchSize: 10, bufferCapacity: 1000, backpressureThresholdPct: 80, backpressureStrategy: BackpressureStrategy.DropOldest };

  it('accepts a valid config', () => {
    const result = validateMessageQueueConfig(validConfig);
    expect(result.valid).toBe(true);
  });

  it('rejects consumerBatchSize of 0', () => {
    const result = validateMessageQueueConfig({ ...validConfig, consumerBatchSize: 0 });
    expect(result.valid).toBe(false);
  });

  it('rejects consumerBatchSize above 10000', () => {
    const result = validateMessageQueueConfig({ ...validConfig, consumerBatchSize: 10_001 });
    expect(result.valid).toBe(false);
  });

  it('rejects zero bufferCapacity', () => {
    const result = validateMessageQueueConfig({ ...validConfig, bufferCapacity: 0 });
    expect(result.valid).toBe(false);
  });

  it('rejects backpressureThresholdPct above 100', () => {
    const result = validateMessageQueueConfig({ ...validConfig, backpressureThresholdPct: 101 });
    expect(result.valid).toBe(false);
  });

  it('rejects negative backpressureThresholdPct', () => {
    const result = validateMessageQueueConfig({ ...validConfig, backpressureThresholdPct: -1 });
    expect(result.valid).toBe(false);
  });
});

// ─── AuthService Config (Requirement 23.1) ───────────────────────

describe('validateAuthServiceConfig', () => {
  const validConfig = {
    verificationMode: VerificationMode.Local,
    verificationLatencyMeanMs: 3,
    verificationLatencyStdDevMs: 1,
    concurrencyLimit: 64,
    queueDepth: 100,
    tokenCacheHitRatio: 0.9,
    credentialFailureRate: 0.01,
  };

  it('accepts a valid config', () => {
    expect(validateAuthServiceConfig(validConfig).valid).toBe(true);
  });

  it('accepts tokenCacheHitRatio at both bounds', () => {
    expect(validateAuthServiceConfig({ ...validConfig, tokenCacheHitRatio: 0.0 }).valid).toBe(true);
    expect(validateAuthServiceConfig({ ...validConfig, tokenCacheHitRatio: 1.0 }).valid).toBe(true);
  });

  it('rejects tokenCacheHitRatio above 1', () => {
    const result = validateAuthServiceConfig({ ...validConfig, tokenCacheHitRatio: 1.01 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'tokenCacheHitRatio')).toBe(true);
  });

  it('accepts queueDepth of 0 — no waiting room is a valid configuration', () => {
    expect(validateAuthServiceConfig({ ...validConfig, queueDepth: 0 }).valid).toBe(true);
  });

  it('rejects concurrencyLimit of 0 and accepts both of its bounds', () => {
    expect(validateAuthServiceConfig({ ...validConfig, concurrencyLimit: 0 }).valid).toBe(false);
    expect(validateAuthServiceConfig({ ...validConfig, concurrencyLimit: 1 }).valid).toBe(true);
    expect(validateAuthServiceConfig({ ...validConfig, concurrencyLimit: 10_000 }).valid).toBe(true);
    expect(validateAuthServiceConfig({ ...validConfig, concurrencyLimit: 10_001 }).valid).toBe(false);
  });

  it('rejects a non-finite value with a message naming the parameter', () => {
    const result = validateAuthServiceConfig({
      ...validConfig,
      verificationLatencyMeanMs: Number.POSITIVE_INFINITY,
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.message).toContain('verificationLatencyMeanMs');
  });

  it('rejects an empty value with a message naming the parameter', () => {
    const result = validateAuthServiceConfig({
      ...validConfig,
      concurrencyLimit: '' as unknown as number,
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.message).toContain('concurrencyLimit');
    expect(result.errors[0]?.message).toContain('empty');
  });

  it('rejects an unrecognised verificationMode', () => {
    const result = validateAuthServiceConfig({
      ...validConfig,
      verificationMode: 'MAGIC' as unknown as VerificationMode,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'verificationMode')).toBe(true);
  });
});

// ─── AuthzService Config (Requirement 24.1) ──────────────────────

describe('validateAuthzServiceConfig', () => {
  const validConfig = {
    policyLatencyMeanMs: 4,
    policyLatencyStdDevMs: 1.5,
    policyCacheHitRatio: 0.9,
    lookupsPerRequest: 1,
    denyRate: 0.01,
    concurrencyLimit: 64,
    queueDepth: 100,
  };

  it('accepts a valid config', () => {
    expect(validateAuthzServiceConfig(validConfig).valid).toBe(true);
  });

  it('accepts policyCacheHitRatio at both bounds', () => {
    expect(validateAuthzServiceConfig({ ...validConfig, policyCacheHitRatio: 0.0 }).valid).toBe(true);
    expect(validateAuthzServiceConfig({ ...validConfig, policyCacheHitRatio: 1.0 }).valid).toBe(true);
  });

  it('accepts queueDepth of 0', () => {
    expect(validateAuthzServiceConfig({ ...validConfig, queueDepth: 0 }).valid).toBe(true);
  });

  it('accepts lookupsPerRequest at both bounds and rejects outside them', () => {
    expect(validateAuthzServiceConfig({ ...validConfig, lookupsPerRequest: 1 }).valid).toBe(true);
    expect(validateAuthzServiceConfig({ ...validConfig, lookupsPerRequest: 50 }).valid).toBe(true);
    expect(validateAuthzServiceConfig({ ...validConfig, lookupsPerRequest: 0 }).valid).toBe(false);
    expect(validateAuthzServiceConfig({ ...validConfig, lookupsPerRequest: 51 }).valid).toBe(false);
  });

  it('rejects NaN denyRate with a message naming the parameter', () => {
    const result = validateAuthzServiceConfig({ ...validConfig, denyRate: NaN });
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.message).toContain('denyRate');
  });
});

// ─── WorkerPool Config (Requirement 25.1) ────────────────────────

describe('validateWorkerPoolConfig', () => {
  const validConfig = {
    concurrency: 8,
    jobProcessingMeanMs: 200,
    jobProcessingStdDevMs: 50,
    prefetchBufferDepth: 100,
    jobFailureRate: 0.02,
    maxRetries: 3,
    retryBackoff: RetryBackoff.Exponential,
    retryBaseDelayMs: 1000,
    jobTimeoutMs: 30_000,
  };

  it('accepts a valid config', () => {
    expect(validateWorkerPoolConfig(validConfig).valid).toBe(true);
  });

  it('accepts maxRetries of 0 — no retry at all is a valid policy', () => {
    expect(validateWorkerPoolConfig({ ...validConfig, maxRetries: 0 }).valid).toBe(true);
  });

  it('accepts maxRetries at its upper bound and rejects above it', () => {
    expect(validateWorkerPoolConfig({ ...validConfig, maxRetries: 10 }).valid).toBe(true);
    expect(validateWorkerPoolConfig({ ...validConfig, maxRetries: 11 }).valid).toBe(false);
  });

  it('accepts prefetchBufferDepth of 0', () => {
    expect(validateWorkerPoolConfig({ ...validConfig, prefetchBufferDepth: 0 }).valid).toBe(true);
  });

  it('accepts jobFailureRate at both bounds', () => {
    expect(validateWorkerPoolConfig({ ...validConfig, jobFailureRate: 0.0 }).valid).toBe(true);
    expect(validateWorkerPoolConfig({ ...validConfig, jobFailureRate: 1.0 }).valid).toBe(true);
  });

  it('rejects retryBaseDelayMs of 0 — the lower bound is 1 ms', () => {
    expect(validateWorkerPoolConfig({ ...validConfig, retryBaseDelayMs: 0 }).valid).toBe(false);
    expect(validateWorkerPoolConfig({ ...validConfig, retryBaseDelayMs: 1 }).valid).toBe(true);
  });

  it('rejects jobTimeoutMs of 0 and accepts its upper bound', () => {
    expect(validateWorkerPoolConfig({ ...validConfig, jobTimeoutMs: 0 }).valid).toBe(false);
    expect(validateWorkerPoolConfig({ ...validConfig, jobTimeoutMs: 600_000 }).valid).toBe(true);
  });

  it('rejects an unrecognised retryBackoff', () => {
    const result = validateWorkerPoolConfig({
      ...validConfig,
      retryBackoff: 'LINEAR' as unknown as RetryBackoff,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'retryBackoff')).toBe(true);
  });
});

// ─── DeadLetterQueue Config (Requirement 26.1) ───────────────────

describe('validateDeadLetterQueueConfig', () => {
  const validConfig = {
    capacity: 10_000,
    retentionPeriodMs: 86_400_000,
    redriveMode: RedriveMode.Manual,
    redriveIntervalMs: 60_000,
    redriveBatchSize: 10,
    maxRedriveAttempts: 3,
  };

  it('accepts a valid config', () => {
    expect(validateDeadLetterQueueConfig(validConfig).valid).toBe(true);
  });

  it('accepts capacity at both bounds and rejects outside them', () => {
    expect(validateDeadLetterQueueConfig({ ...validConfig, capacity: 1 }).valid).toBe(true);
    expect(validateDeadLetterQueueConfig({ ...validConfig, capacity: 1_000_000 }).valid).toBe(true);
    expect(validateDeadLetterQueueConfig({ ...validConfig, capacity: 0 }).valid).toBe(false);
    expect(validateDeadLetterQueueConfig({ ...validConfig, capacity: 1_000_001 }).valid).toBe(false);
  });

  it('accepts maxRedriveAttempts of 0 — retain without ever redriving', () => {
    expect(validateDeadLetterQueueConfig({ ...validConfig, maxRedriveAttempts: 0 }).valid).toBe(true);
  });

  it('accepts retentionPeriodMs at its 30-day upper bound', () => {
    expect(validateDeadLetterQueueConfig({ ...validConfig, retentionPeriodMs: 2_592_000_000 }).valid).toBe(true);
    expect(validateDeadLetterQueueConfig({ ...validConfig, retentionPeriodMs: 2_592_000_001 }).valid).toBe(false);
  });

  it('validates the redrive fields in Manual mode too, so switching mode cannot surface an unvalidated value', () => {
    const result = validateDeadLetterQueueConfig({ ...validConfig, redriveIntervalMs: 0 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'redriveIntervalMs')).toBe(true);
  });
});

// ─── ObjectStore Config (Requirement 27.1) ───────────────────────

describe('validateObjectStoreConfig', () => {
  const validConfig = {
    objectSizeMeanKB: 256,
    objectSizeStdDevKB: 64,
    throughputCapacityMBps: 100,
    baseLatencyMeanMs: 10,
    baseLatencyStdDevMs: 3,
    maxConcurrentTransfers: 64,
    transferQueueDepth: 100,
    readFraction: 0.8,
    writeLatencyMultiplier: 1.5,
  };

  it('accepts a valid config', () => {
    expect(validateObjectStoreConfig(validConfig).valid).toBe(true);
  });

  it('accepts objectSizeMeanKB at 1 and at 10,485,760', () => {
    expect(validateObjectStoreConfig({ ...validConfig, objectSizeMeanKB: 1 }).valid).toBe(true);
    expect(validateObjectStoreConfig({ ...validConfig, objectSizeMeanKB: 10_485_760 }).valid).toBe(true);
  });

  it('rejects objectSizeMeanKB of 0 and above its upper bound', () => {
    expect(validateObjectStoreConfig({ ...validConfig, objectSizeMeanKB: 0 }).valid).toBe(false);
    expect(validateObjectStoreConfig({ ...validConfig, objectSizeMeanKB: 10_485_761 }).valid).toBe(false);
  });

  it('accepts objectSizeStdDevKB of 0 — a fixed object size', () => {
    expect(validateObjectStoreConfig({ ...validConfig, objectSizeStdDevKB: 0 }).valid).toBe(true);
  });

  it('accepts the fractional throughput lower bound of 0.1 and rejects 0', () => {
    expect(validateObjectStoreConfig({ ...validConfig, throughputCapacityMBps: 0.1 }).valid).toBe(true);
    expect(validateObjectStoreConfig({ ...validConfig, throughputCapacityMBps: 0 }).valid).toBe(false);
  });

  it('accepts transferQueueDepth of 0', () => {
    expect(validateObjectStoreConfig({ ...validConfig, transferQueueDepth: 0 }).valid).toBe(true);
  });

  it('accepts readFraction at both bounds', () => {
    expect(validateObjectStoreConfig({ ...validConfig, readFraction: 0.0 }).valid).toBe(true);
    expect(validateObjectStoreConfig({ ...validConfig, readFraction: 1.0 }).valid).toBe(true);
  });

  it('rejects writeLatencyMultiplier below 1.0', () => {
    expect(validateObjectStoreConfig({ ...validConfig, writeLatencyMultiplier: 0.9 }).valid).toBe(false);
    expect(validateObjectStoreConfig({ ...validConfig, writeLatencyMultiplier: 1.0 }).valid).toBe(true);
    expect(validateObjectStoreConfig({ ...validConfig, writeLatencyMultiplier: 100 }).valid).toBe(true);
  });
});

// ─── Scheduler Config (Requirement 28.1) ─────────────────────────

describe('validateSchedulerConfig', () => {
  const validConfig = {
    intervalMs: 60_000,
    jobsPerTrigger: 50,
    startOffsetMs: 0,
    jitterMs: 0,
    overlapPolicy: OverlapPolicy.Skip,
    maxDeferredTriggers: 10,
  };

  it('accepts a valid config', () => {
    expect(validateSchedulerConfig(validConfig).valid).toBe(true);
  });

  it('accepts intervalMs at both bounds and rejects below 100 ms', () => {
    expect(validateSchedulerConfig({ ...validConfig, intervalMs: 100 }).valid).toBe(true);
    expect(validateSchedulerConfig({ ...validConfig, intervalMs: 86_400_000 }).valid).toBe(true);
    expect(validateSchedulerConfig({ ...validConfig, intervalMs: 99 }).valid).toBe(false);
  });

  it('accepts startOffsetMs of 0 — the first trigger fires at t=0', () => {
    expect(validateSchedulerConfig({ ...validConfig, startOffsetMs: 0 }).valid).toBe(true);
  });

  // R28.3 — the engine takes the lesser of jitter and interval at fire time, so a jitter
  // larger than the interval is degenerate rather than invalid.
  it('accepts jitterMs above intervalMs, because R28.3 caps the effective jitter at the interval', () => {
    const result = validateSchedulerConfig({ ...validConfig, intervalMs: 100, jitterMs: 500 });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('still rejects jitterMs outside its own range', () => {
    expect(validateSchedulerConfig({ ...validConfig, jitterMs: -1 }).valid).toBe(false);
    expect(validateSchedulerConfig({ ...validConfig, jitterMs: 86_400_001 }).valid).toBe(false);
  });

  it('accepts maxDeferredTriggers at both bounds and rejects 0', () => {
    expect(validateSchedulerConfig({ ...validConfig, maxDeferredTriggers: 1 }).valid).toBe(true);
    expect(validateSchedulerConfig({ ...validConfig, maxDeferredTriggers: 1_000 }).valid).toBe(true);
    expect(validateSchedulerConfig({ ...validConfig, maxDeferredTriggers: 0 }).valid).toBe(false);
  });

  it('rejects an unrecognised overlapPolicy', () => {
    const result = validateSchedulerConfig({
      ...validConfig,
      overlapPolicy: 'RETRY' as unknown as OverlapPolicy,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'overlapPolicy')).toBe(true);
  });
});

// ─── normalizeConfig ─────────────────────────────────────────────

describe('normalizeConfig', () => {
  it('clamps workerThreadPoolSize 0 → 1', () => {
    const node: SimulationNode = {
      id: 'app-1',
      nodeType: NodeType.AppServer,
      label: 'App',
      position: { x: 0, y: 0 },
      routingPolicy: RoutingPolicy.First,
      config: { workerThreadPoolSize: 0, requestQueueDepth: 100, processingTimeMeanMs: 5, processingTimeStdDevMs: 1 },
    };
    const { node: normalized } = normalizeConfig(node);
    expect(normalized.nodeType).toBe(NodeType.AppServer);
    if (normalized.nodeType === NodeType.AppServer) {
      expect(normalized.config.workerThreadPoolSize).toBe(1);
    }
  });

  it('clamps connectionPoolSize 0 → 1 for Database', () => {
    const node: SimulationNode = {
      id: 'db-1',
      nodeType: NodeType.Database,
      label: 'DB',
      position: { x: 0, y: 0 },
      routingPolicy: RoutingPolicy.First,
      config: { connectionPoolSize: 0, queryLatencyMeanMs: 10, queryLatencyStdDevMs: 2, lockTimeoutMs: 5000, dbType: DatabaseType.Relational },
    };
    const { node: normalized } = normalizeConfig(node);
    if (normalized.nodeType === NodeType.Database) {
      expect(normalized.config.connectionPoolSize).toBe(1);
    }
  });

  it('clamps negative rps → 1', () => {
    const node: SimulationNode = {
      id: 'gen-1',
      nodeType: NodeType.TrafficGenerator,
      label: 'Gen',
      position: { x: 0, y: 0 },
      routingPolicy: RoutingPolicy.First,
      config: { rps: -50, distribution: Distribution.Poisson, spikeMultiplier: 5, spikeDurationSec: 10 },
    };
    const { node: normalized } = normalizeConfig(node);
    if (normalized.nodeType === NodeType.TrafficGenerator) {
      expect(normalized.config.rps).toBe(1);
    }
  });

  it('clamps hitRatio above 1 → 1', () => {
    const node: SimulationNode = {
      id: 'cache-1',
      nodeType: NodeType.Cache,
      label: 'Cache',
      position: { x: 0, y: 0 },
      routingPolicy: RoutingPolicy.First,
      config: { hitRatio: 2.5, evictionPolicy: EvictionPolicy.LRU, accessLatencyMs: 1 },
    };
    const { node: normalized } = normalizeConfig(node);
    if (normalized.nodeType === NodeType.Cache) {
      expect(normalized.config.hitRatio).toBe(1);
    }
  });

  it('clamps NaN workerThreadPoolSize → 1', () => {
    const node: SimulationNode = {
      id: 'app-1',
      nodeType: NodeType.AppServer,
      label: 'App',
      position: { x: 0, y: 0 },
      routingPolicy: RoutingPolicy.First,
      config: { workerThreadPoolSize: NaN, requestQueueDepth: 100, processingTimeMeanMs: 5, processingTimeStdDevMs: 1 },
    };
    const { node: normalized } = normalizeConfig(node);
    if (normalized.nodeType === NodeType.AppServer) {
      expect(normalized.config.workerThreadPoolSize).toBe(1);
    }
  });

  it('clamps consumerBatchSize 0 → 1 for MessageQueue', () => {
    const node: SimulationNode = {
      id: 'mq-1',
      nodeType: NodeType.MessageQueue,
      label: 'MQ',
      position: { x: 0, y: 0 },
      routingPolicy: RoutingPolicy.First,
      config: { consumerBatchSize: 0, bufferCapacity: 1000, backpressureThresholdPct: 80, backpressureStrategy: BackpressureStrategy.DropOldest },
    };
    const { node: normalized } = normalizeConfig(node);
    if (normalized.nodeType === NodeType.MessageQueue) {
      expect(normalized.config.consumerBatchSize).toBe(1);
    }
  });

  it('does not modify valid configs', () => {
    const node: SimulationNode = {
      id: 'lb-1',
      nodeType: NodeType.LoadBalancer,
      label: 'LB',
      position: { x: 0, y: 0 },
      routingPolicy: RoutingPolicy.First,
      config: { algorithm: LBAlgorithm.RoundRobin, healthCheckIntervalMs: 5000, evictionThreshold: 3 },
    };
    const { node: normalized, warnings } = normalizeConfig(node);
    if (normalized.nodeType === NodeType.LoadBalancer) {
      expect(normalized.config.healthCheckIntervalMs).toBe(5000);
      expect(normalized.config.evictionThreshold).toBe(3);
    }
    expect(warnings).toHaveLength(0);
  });

  // ─── Clamp Warnings (Task 292) ─────────────────────────────────

  it('reports a warning naming the label, parameter, imported value, and applied bound', () => {
    const node: SimulationNode = {
      id: 'app-1',
      nodeType: NodeType.AppServer,
      label: 'Checkout Service',
      position: { x: 0, y: 0 },
      routingPolicy: RoutingPolicy.First,
      config: { workerThreadPoolSize: 5000, requestQueueDepth: 100, processingTimeMeanMs: 5, processingTimeStdDevMs: 1 },
    };
    const { warnings } = normalizeConfig(node);
    expect(warnings).toEqual([
      {
        label: 'Checkout Service',
        field: 'workerThreadPoolSize',
        importedValue: 5000,
        appliedValue: 1000,
      },
    ]);
  });

  it('reports one warning per clamped parameter', () => {
    const node: SimulationNode = {
      id: 'app-1',
      nodeType: NodeType.AppServer,
      label: 'App',
      position: { x: 0, y: 0 },
      routingPolicy: RoutingPolicy.First,
      config: { workerThreadPoolSize: 0, requestQueueDepth: 99_999, processingTimeMeanMs: -5, processingTimeStdDevMs: 1 },
    };
    const { warnings } = normalizeConfig(node);
    expect(warnings.map((w) => w.field)).toEqual([
      'workerThreadPoolSize',
      'requestQueueDepth',
      'processingTimeMeanMs',
    ]);
  });

  it('reports a warning for a non-finite import rather than clamping it silently', () => {
    const node: SimulationNode = {
      id: 'app-1',
      nodeType: NodeType.AppServer,
      label: 'App',
      position: { x: 0, y: 0 },
      routingPolicy: RoutingPolicy.First,
      config: { workerThreadPoolSize: NaN, requestQueueDepth: 100, processingTimeMeanMs: 5, processingTimeStdDevMs: 1 },
    };
    const { warnings } = normalizeConfig(node);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.field).toBe('workerThreadPoolSize');
    expect(warnings[0]?.appliedValue).toBe(1);
  });

  it('does not mutate the node it is given', () => {
    const config = { workerThreadPoolSize: 0, requestQueueDepth: 100, processingTimeMeanMs: 5, processingTimeStdDevMs: 1 };
    const node: SimulationNode = {
      id: 'app-1',
      nodeType: NodeType.AppServer,
      label: 'App',
      position: { x: 0, y: 0 },
      routingPolicy: RoutingPolicy.First,
      config,
    };
    normalizeConfig(node);
    expect(config.workerThreadPoolSize).toBe(0);
  });

  // ─── Requirement 23–28 Node Types ──────────────────────────────

  it('clamps every out-of-range AuthService parameter', () => {
    const node: SimulationNode = {
      id: 'auth-1',
      nodeType: NodeType.AuthService,
      label: 'Auth',
      position: { x: 0, y: 0 },
      routingPolicy: RoutingPolicy.First,
      config: {
        verificationMode: VerificationMode.Introspection,
        verificationLatencyMeanMs: 90_000,
        verificationLatencyStdDevMs: -1,
        concurrencyLimit: 0,
        queueDepth: 20_000,
        tokenCacheHitRatio: 1.4,
        credentialFailureRate: -0.2,
      },
    };
    const { node: normalized, warnings } = normalizeConfig(node);
    if (normalized.nodeType === NodeType.AuthService) {
      expect(normalized.config.verificationLatencyMeanMs).toBe(60_000);
      expect(normalized.config.verificationLatencyStdDevMs).toBe(0);
      expect(normalized.config.concurrencyLimit).toBe(1);
      expect(normalized.config.queueDepth).toBe(10_000);
      expect(normalized.config.tokenCacheHitRatio).toBe(1);
      expect(normalized.config.credentialFailureRate).toBe(0);
      // Untouched, so it raises no warning.
      expect(normalized.config.verificationMode).toBe(VerificationMode.Introspection);
    }
    expect(warnings).toHaveLength(6);
  });

  it('clamps every out-of-range AuthzService parameter', () => {
    const node: SimulationNode = {
      id: 'authz-1',
      nodeType: NodeType.AuthzService,
      label: 'Authz',
      position: { x: 0, y: 0 },
      routingPolicy: RoutingPolicy.First,
      config: {
        policyLatencyMeanMs: -1,
        policyLatencyStdDevMs: 40_000,
        policyCacheHitRatio: 2,
        lookupsPerRequest: 99,
        denyRate: -1,
        concurrencyLimit: 99_999,
        queueDepth: -5,
      },
    };
    const { node: normalized, warnings } = normalizeConfig(node);
    if (normalized.nodeType === NodeType.AuthzService) {
      expect(normalized.config.policyLatencyMeanMs).toBe(0);
      expect(normalized.config.policyLatencyStdDevMs).toBe(30_000);
      expect(normalized.config.policyCacheHitRatio).toBe(1);
      expect(normalized.config.lookupsPerRequest).toBe(50);
      expect(normalized.config.denyRate).toBe(0);
      expect(normalized.config.concurrencyLimit).toBe(10_000);
      expect(normalized.config.queueDepth).toBe(0);
    }
    expect(warnings).toHaveLength(7);
  });

  it('clamps every out-of-range WorkerPool parameter', () => {
    const node: SimulationNode = {
      id: 'wp-1',
      nodeType: NodeType.WorkerPool,
      label: 'Workers',
      position: { x: 0, y: 0 },
      routingPolicy: RoutingPolicy.First,
      config: {
        concurrency: 0,
        jobProcessingMeanMs: 900_000,
        jobProcessingStdDevMs: 400_000,
        prefetchBufferDepth: -1,
        jobFailureRate: 3,
        maxRetries: 99,
        retryBackoff: RetryBackoff.Fixed,
        retryBaseDelayMs: 0,
        jobTimeoutMs: 900_000,
      },
    };
    const { node: normalized, warnings } = normalizeConfig(node);
    if (normalized.nodeType === NodeType.WorkerPool) {
      expect(normalized.config.concurrency).toBe(1);
      expect(normalized.config.jobProcessingMeanMs).toBe(600_000);
      expect(normalized.config.jobProcessingStdDevMs).toBe(300_000);
      expect(normalized.config.prefetchBufferDepth).toBe(0);
      expect(normalized.config.jobFailureRate).toBe(1);
      expect(normalized.config.maxRetries).toBe(10);
      expect(normalized.config.retryBaseDelayMs).toBe(1);
      expect(normalized.config.jobTimeoutMs).toBe(600_000);
      expect(normalized.config.retryBackoff).toBe(RetryBackoff.Fixed);
    }
    expect(warnings).toHaveLength(8);
  });

  it('clamps every out-of-range DeadLetterQueue parameter', () => {
    const node: SimulationNode = {
      id: 'dlq-1',
      nodeType: NodeType.DeadLetterQueue,
      label: 'DLQ',
      position: { x: 0, y: 0 },
      routingPolicy: RoutingPolicy.First,
      config: {
        capacity: 0,
        retentionPeriodMs: 0,
        redriveMode: RedriveMode.Automatic,
        redriveIntervalMs: 400_000,
        redriveBatchSize: 20_000,
        maxRedriveAttempts: -1,
      },
    };
    const { node: normalized, warnings } = normalizeConfig(node);
    if (normalized.nodeType === NodeType.DeadLetterQueue) {
      expect(normalized.config.capacity).toBe(1);
      expect(normalized.config.retentionPeriodMs).toBe(1);
      expect(normalized.config.redriveIntervalMs).toBe(300_000);
      expect(normalized.config.redriveBatchSize).toBe(10_000);
      expect(normalized.config.maxRedriveAttempts).toBe(0);
      expect(normalized.config.redriveMode).toBe(RedriveMode.Automatic);
    }
    expect(warnings).toHaveLength(5);
  });

  it('clamps every out-of-range ObjectStore parameter, including transferQueueDepth', () => {
    const node: SimulationNode = {
      id: 'obj-1',
      nodeType: NodeType.ObjectStore,
      label: 'Blobs',
      position: { x: 0, y: 0 },
      routingPolicy: RoutingPolicy.First,
      config: {
        objectSizeMeanKB: 0,
        objectSizeStdDevKB: 20_000_000,
        throughputCapacityMBps: 0,
        baseLatencyMeanMs: 90_000,
        baseLatencyStdDevMs: -1,
        maxConcurrentTransfers: 0,
        transferQueueDepth: 50_000,
        readFraction: 1.7,
        writeLatencyMultiplier: 0.1,
      },
    };
    const { node: normalized, warnings } = normalizeConfig(node);
    if (normalized.nodeType === NodeType.ObjectStore) {
      expect(normalized.config.objectSizeMeanKB).toBe(1);
      expect(normalized.config.objectSizeStdDevKB).toBe(10_485_760);
      expect(normalized.config.throughputCapacityMBps).toBe(0.1);
      expect(normalized.config.baseLatencyMeanMs).toBe(60_000);
      expect(normalized.config.baseLatencyStdDevMs).toBe(0);
      expect(normalized.config.maxConcurrentTransfers).toBe(1);
      expect(normalized.config.transferQueueDepth).toBe(10_000);
      expect(normalized.config.readFraction).toBe(1);
      expect(normalized.config.writeLatencyMultiplier).toBe(1);
    }
    expect(warnings.map((w) => w.field)).toContain('transferQueueDepth');
    expect(warnings).toHaveLength(9);
  });

  it('clamps every out-of-range Scheduler parameter, including maxDeferredTriggers', () => {
    const node: SimulationNode = {
      id: 'sched-1',
      nodeType: NodeType.Scheduler,
      label: 'Nightly',
      position: { x: 0, y: 0 },
      routingPolicy: RoutingPolicy.First,
      config: {
        intervalMs: 10,
        jobsPerTrigger: 0,
        startOffsetMs: -1,
        jitterMs: 99_999_999,
        overlapPolicy: OverlapPolicy.Queue,
        maxDeferredTriggers: 5_000,
      },
    };
    const { node: normalized, warnings } = normalizeConfig(node);
    if (normalized.nodeType === NodeType.Scheduler) {
      expect(normalized.config.intervalMs).toBe(100);
      expect(normalized.config.jobsPerTrigger).toBe(1);
      expect(normalized.config.startOffsetMs).toBe(0);
      expect(normalized.config.jitterMs).toBe(86_400_000);
      expect(normalized.config.maxDeferredTriggers).toBe(1_000);
      expect(normalized.config.overlapPolicy).toBe(OverlapPolicy.Queue);
    }
    expect(warnings.map((w) => w.field)).toContain('maxDeferredTriggers');
    expect(warnings).toHaveLength(5);
  });

  // R28.3 — a jitter larger than the interval is left as imported: the engine caps the
  // effective jitter at fire time, so clamping here would silently change the model.
  it('leaves a Scheduler jitterMs above intervalMs untouched and warns about neither', () => {
    const node: SimulationNode = {
      id: 'sched-1',
      nodeType: NodeType.Scheduler,
      label: 'Nightly',
      position: { x: 0, y: 0 },
      routingPolicy: RoutingPolicy.First,
      config: {
        intervalMs: 1_000,
        jobsPerTrigger: 10,
        startOffsetMs: 0,
        jitterMs: 5_000,
        overlapPolicy: OverlapPolicy.Skip,
        maxDeferredTriggers: 10,
      },
    };
    const { node: normalized, warnings } = normalizeConfig(node);
    if (normalized.nodeType === NodeType.Scheduler) {
      expect(normalized.config.jitterMs).toBe(5_000);
      expect(normalized.config.intervalMs).toBe(1_000);
    }
    expect(warnings).toHaveLength(0);
  });

  it('falls an unrecognised enum back to a default and warns', () => {
    const node: SimulationNode = {
      id: 'auth-1',
      nodeType: NodeType.AuthService,
      label: 'Auth',
      position: { x: 0, y: 0 },
      routingPolicy: RoutingPolicy.First,
      config: {
        verificationMode: 'MAGIC' as unknown as VerificationMode,
        verificationLatencyMeanMs: 3,
        verificationLatencyStdDevMs: 1,
        concurrencyLimit: 64,
        queueDepth: 100,
        tokenCacheHitRatio: 0.9,
        credentialFailureRate: 0.01,
      },
    };
    const { node: normalized, warnings } = normalizeConfig(node);
    if (normalized.nodeType === NodeType.AuthService) {
      expect(normalized.config.verificationMode).toBe(VerificationMode.Local);
    }
    expect(warnings).toEqual([
      {
        label: 'Auth',
        field: 'verificationMode',
        importedValue: 'MAGIC',
        appliedValue: VerificationMode.Local,
      },
    ]);
  });
});
