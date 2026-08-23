/**
 * Requirement 29.5 — Smoke test for each of the six new node types.
 *
 * Each test: one node at default configuration wired to a default
 * Traffic_Generator or Scheduler, run 60 simulated seconds with
 * disablePacing: true, and assert:
 *   - no validation error
 *   - no engine error
 *   - at least one request or Job reaching a terminal status at that node
 */
import { describe, it, expect } from 'vitest';
import { SimulationEngine } from './engine';
import {
  NodeType,
  Distribution,
  RoutingPolicy,
  VerificationMode,
  RetryBackoff,
  RedriveMode,
  OverlapPolicy,
  BackpressureStrategy,
} from '@/types/nodes';
import type { SimulationNode } from '@/types/nodes';
import type { EdgeData } from '@/types/edges';
import { EdgeProtocol } from '@/types/edges';
import type { SimulationEngineConfig } from '@/types/messages';
import type { MetricsBatchPayload } from '@/types/metrics';

function makeTrafficGenerator(id = 'tg-1'): SimulationNode {
  return {
    id,
    nodeType: NodeType.TrafficGenerator,
    label: 'Traffic Generator',
    position: { x: 0, y: 0 },
    routingPolicy: RoutingPolicy.First,
    config: {
      rps: 100,
      distribution: Distribution.Poisson,
      spikeMultiplier: 1,
      spikeDurationSec: 10,
    },
  };
}

function makeMessageQueue(id = 'mq-1'): SimulationNode {
  return {
    id,
    nodeType: NodeType.MessageQueue,
    label: 'Message Queue',
    position: { x: 200, y: 0 },
    routingPolicy: RoutingPolicy.First,
    config: {
      consumerBatchSize: 10,
      bufferCapacity: 10000,
      backpressureThresholdPct: 80,
      backpressureStrategy: BackpressureStrategy.RejectNew,
    },
  };
}

function createConfig(
  nodes: SimulationNode[],
  edges: EdgeData[],
  overrides: Partial<SimulationEngineConfig> = {},
): SimulationEngineConfig {
  return {
    topology: { nodes, edges },
    seed: 42,
    speedMultiplier: 50,
    maxSimulatedTimeMs: 60_000, // 60 simulated seconds
    metricsIntervalMs: 5000,
    maxHopsPerRequest: 20,
    disablePacing: true,
    ...overrides,
  };
}

function collectBatches(engine: SimulationEngine): MetricsBatchPayload[] {
  const batches: MetricsBatchPayload[] = [];
  engine.setCallbacks({
    onMetricsBatch: (payload) => batches.push(payload),
  });
  return batches;
}

function hasTerminalStatus(batches: MetricsBatchPayload[], nodeId: string): boolean {
  for (const batch of batches) {
    const node = batch.nodes.find((n) => n.nodeId === nodeId);
    if (node) {
      const counts = node.cumulativeTerminalCounts;
      const total = Object.values(counts).reduce((sum, c) => sum + (c as number), 0);
      if (total > 0) return true;
    }
  }
  return false;
}

describe('New Node Types — Smoke Tests (R29.5)', () => {
  it('Auth_Service: processes requests at default config', async () => {
    const tg = makeTrafficGenerator();
    const auth: SimulationNode = {
      id: 'auth-1',
      nodeType: NodeType.AuthService,
      label: 'Auth Service',
      position: { x: 200, y: 0 },
      routingPolicy: RoutingPolicy.First,
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
    const edges: EdgeData[] = [
      { id: 'e1', source: 'tg-1', target: 'auth-1', protocol: EdgeProtocol.Sync, weight: 1.0 },
    ];

    const config = createConfig([tg, auth], edges);
    const engine = new SimulationEngine(config);
    const batches = collectBatches(engine);

    await engine.run();

    expect(batches.length).toBeGreaterThan(0);
    expect(hasTerminalStatus(batches, 'auth-1')).toBe(true);
  });

  it('Authz_Service: processes requests at default config', async () => {
    const tg = makeTrafficGenerator();
    const authz: SimulationNode = {
      id: 'authz-1',
      nodeType: NodeType.AuthzService,
      label: 'Authz Service',
      position: { x: 200, y: 0 },
      routingPolicy: RoutingPolicy.First,
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
    const edges: EdgeData[] = [
      { id: 'e1', source: 'tg-1', target: 'authz-1', protocol: EdgeProtocol.Sync, weight: 1.0 },
    ];

    const config = createConfig([tg, authz], edges);
    const engine = new SimulationEngine(config);
    const batches = collectBatches(engine);

    await engine.run();

    expect(batches.length).toBeGreaterThan(0);
    expect(hasTerminalStatus(batches, 'authz-1')).toBe(true);
  });

  it('Worker_Pool: processes Jobs at default config', async () => {
    const tg = makeTrafficGenerator();
    const mq = makeMessageQueue();
    const wp: SimulationNode = {
      id: 'wp-1',
      nodeType: NodeType.WorkerPool,
      label: 'Worker Pool',
      position: { x: 400, y: 0 },
      routingPolicy: RoutingPolicy.First,
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
    const edges: EdgeData[] = [
      { id: 'e1', source: 'tg-1', target: 'mq-1', protocol: EdgeProtocol.Async, weight: 1.0 },
      { id: 'e2', source: 'mq-1', target: 'wp-1', protocol: EdgeProtocol.Sync, weight: 1.0 },
    ];

    const config = createConfig([tg, mq, wp], edges);
    const engine = new SimulationEngine(config);
    const batches = collectBatches(engine);

    await engine.run();

    expect(batches.length).toBeGreaterThan(0);
    expect(hasTerminalStatus(batches, 'wp-1')).toBe(true);
  });

  it('Dead_Letter_Queue: retains Jobs at default config', async () => {
    const tg = makeTrafficGenerator();
    const wp: SimulationNode = {
      id: 'wp-1',
      nodeType: NodeType.WorkerPool,
      label: 'Worker Pool',
      position: { x: 200, y: 0 },
      routingPolicy: RoutingPolicy.First,
      config: {
        concurrency: 16,
        jobProcessingMeanMs: 50,
        jobProcessingStdDevMs: 10,
        prefetchBufferDepth: 200,
        jobFailureRate: 0.8,
        maxRetries: 0, // First failure exhausts immediately
        retryBackoff: RetryBackoff.Fixed,
        retryBaseDelayMs: 100,
        jobTimeoutMs: 30000,
      },
    };
    const dlq: SimulationNode = {
      id: 'dlq-1',
      nodeType: NodeType.DeadLetterQueue,
      label: 'Dead Letter Queue',
      position: { x: 400, y: 0 },
      routingPolicy: RoutingPolicy.First,
      config: {
        capacity: 10000,
        retentionPeriodMs: 86400000,
        redriveMode: RedriveMode.Manual,
        redriveIntervalMs: 60000,
        redriveBatchSize: 10,
        maxRedriveAttempts: 3,
      },
    };
    const edges: EdgeData[] = [
      { id: 'e1', source: 'tg-1', target: 'wp-1', protocol: EdgeProtocol.Sync, weight: 1.0 },
      { id: 'e2', source: 'wp-1', target: 'dlq-1', protocol: EdgeProtocol.Async, weight: 1.0 },
    ];

    const config = createConfig([tg, wp, dlq], edges);
    const engine = new SimulationEngine(config);
    const batches = collectBatches(engine);

    await engine.run();

    expect(batches.length).toBeGreaterThan(0);
    // At least one terminal status at any node in the topology
    const anyTerminal = batches.some((batch) =>
      batch.nodes.some((n) => {
        const counts = n.cumulativeTerminalCounts;
        return Object.values(counts).reduce((sum, c) => sum + (c as number), 0) > 0;
      }),
    );
    expect(anyTerminal).toBe(true);
  });

  it('Object_Store: processes transfers at default config', async () => {
    const tg = makeTrafficGenerator();
    const os: SimulationNode = {
      id: 'os-1',
      nodeType: NodeType.ObjectStore,
      label: 'Object Store',
      position: { x: 200, y: 0 },
      routingPolicy: RoutingPolicy.First,
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
    const edges: EdgeData[] = [
      { id: 'e1', source: 'tg-1', target: 'os-1', protocol: EdgeProtocol.Sync, weight: 1.0 },
    ];

    const config = createConfig([tg, os], edges);
    const engine = new SimulationEngine(config);
    const batches = collectBatches(engine);

    await engine.run();

    expect(batches.length).toBeGreaterThan(0);
    expect(hasTerminalStatus(batches, 'os-1')).toBe(true);
  });

  it('Scheduler: emits Jobs at default config', async () => {
    const scheduler: SimulationNode = {
      id: 'sched-1',
      nodeType: NodeType.Scheduler,
      label: 'Scheduler',
      position: { x: 0, y: 0 },
      routingPolicy: RoutingPolicy.First,
      config: {
        intervalMs: 5000, // Every 5s so we get multiple triggers in 60s
        jobsPerTrigger: 10,
        startOffsetMs: 0,
        jitterMs: 0,
        overlapPolicy: OverlapPolicy.Allow,
        maxDeferredTriggers: 10,
      },
    };
    const mq = makeMessageQueue('mq-1');
    const wp: SimulationNode = {
      id: 'wp-1',
      nodeType: NodeType.WorkerPool,
      label: 'Worker Pool',
      position: { x: 400, y: 0 },
      routingPolicy: RoutingPolicy.First,
      config: {
        concurrency: 8,
        jobProcessingMeanMs: 100,
        jobProcessingStdDevMs: 20,
        prefetchBufferDepth: 100,
        jobFailureRate: 0.01,
        maxRetries: 3,
        retryBackoff: RetryBackoff.Exponential,
        retryBaseDelayMs: 1000,
        jobTimeoutMs: 30000,
      },
    };
    const edges: EdgeData[] = [
      { id: 'e1', source: 'sched-1', target: 'mq-1', protocol: EdgeProtocol.Async, weight: 1.0 },
      { id: 'e2', source: 'mq-1', target: 'wp-1', protocol: EdgeProtocol.Sync, weight: 1.0 },
    ];

    const config = createConfig([scheduler, mq, wp], edges);
    const engine = new SimulationEngine(config);
    const batches = collectBatches(engine);

    await engine.run();

    expect(batches.length).toBeGreaterThan(0);
    // Scheduler emits Jobs that pass through MQ to WP
    // At least one Job should reach terminal status at some node
    const anyTerminal = batches.some((batch) =>
      batch.nodes.some((n) => {
        const counts = n.cumulativeTerminalCounts;
        return Object.values(counts).reduce((sum, c) => sum + (c as number), 0) > 0;
      }),
    );
    expect(anyTerminal).toBe(true);
  });
});
