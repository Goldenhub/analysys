import { describe, it, expect } from 'vitest';
import {
  validateTrafficGeneratorConfig,
  validateLoadBalancerConfig,
  validateAppServerConfig,
  validateCacheConfig,
  validateDatabaseConfig,
  validateMessageQueueConfig,
  normalizeConfig,
} from './configValidation';
import {
  NodeType,
  Distribution,
  LBAlgorithm,
  EvictionPolicy,
  DatabaseType,
  BackpressureStrategy,
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

// ─── normalizeConfig ─────────────────────────────────────────────

describe('normalizeConfig', () => {
  it('clamps workerThreadPoolSize 0 → 1', () => {
    const node: SimulationNode = {
      id: 'app-1',
      nodeType: NodeType.AppServer,
      label: 'App',
      position: { x: 0, y: 0 },
      config: { workerThreadPoolSize: 0, requestQueueDepth: 100, processingTimeMeanMs: 5, processingTimeStdDevMs: 1 },
    };
    const normalized = normalizeConfig(node);
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
      config: { connectionPoolSize: 0, queryLatencyMeanMs: 10, queryLatencyStdDevMs: 2, lockTimeoutMs: 5000, dbType: DatabaseType.Relational },
    };
    const normalized = normalizeConfig(node);
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
      config: { rps: -50, distribution: Distribution.Poisson, spikeMultiplier: 5, spikeDurationSec: 10 },
    };
    const normalized = normalizeConfig(node);
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
      config: { hitRatio: 2.5, evictionPolicy: EvictionPolicy.LRU, accessLatencyMs: 1 },
    };
    const normalized = normalizeConfig(node);
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
      config: { workerThreadPoolSize: NaN, requestQueueDepth: 100, processingTimeMeanMs: 5, processingTimeStdDevMs: 1 },
    };
    const normalized = normalizeConfig(node);
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
      config: { consumerBatchSize: 0, bufferCapacity: 1000, backpressureThresholdPct: 80, backpressureStrategy: BackpressureStrategy.DropOldest },
    };
    const normalized = normalizeConfig(node);
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
      config: { algorithm: LBAlgorithm.RoundRobin, healthCheckIntervalMs: 5000, evictionThreshold: 3 },
    };
    const normalized = normalizeConfig(node);
    if (normalized.nodeType === NodeType.LoadBalancer) {
      expect(normalized.config.healthCheckIntervalMs).toBe(5000);
      expect(normalized.config.evictionThreshold).toBe(3);
    }
  });
});
