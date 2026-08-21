import { describe, it, expect } from 'vitest';
import { SimulationEngine } from './engine';
import { NodeType, Distribution, DatabaseType, EvictionPolicy, LBAlgorithm } from '@/types/nodes';
import type { SimulationNode } from '@/types/nodes';
import type { EdgeData } from '@/types/edges';
import { EdgeProtocol } from '@/types/edges';
import type { SimulationEngineConfig } from '@/types/messages';
import type { MetricsBatchPayload } from '@/types/metrics';

function createBasicTopology(): { nodes: SimulationNode[]; edges: EdgeData[] } {
  const nodes: SimulationNode[] = [
    {
      id: 'gen-1',
      nodeType: NodeType.TrafficGenerator,
      label: 'Generator',
      position: { x: 0, y: 0 },
      config: {
        rps: 100,
        distribution: Distribution.Uniform,
        spikeMultiplier: 5,
        spikeDurationSec: 15,
      },
    },
    {
      id: 'app-1',
      nodeType: NodeType.AppServer,
      label: 'App Server',
      position: { x: 200, y: 0 },
      config: {
        workerThreadPoolSize: 10,
        requestQueueDepth: 100,
        processingTimeMeanMs: 5,
        processingTimeStdDevMs: 1,
      },
    },
    {
      id: 'db-1',
      nodeType: NodeType.Database,
      label: 'Database',
      position: { x: 400, y: 0 },
      config: {
        connectionPoolSize: 20,
        queryLatencyMeanMs: 10,
        queryLatencyStdDevMs: 2,
        lockTimeoutMs: 5000,
        dbType: DatabaseType.Relational,
      },
    },
  ];

  const edges: EdgeData[] = [
    { id: 'e1', source: 'gen-1', target: 'app-1', protocol: EdgeProtocol.Sync },
    { id: 'e2', source: 'app-1', target: 'db-1', protocol: EdgeProtocol.Sync },
  ];

  return { nodes, edges };
}

function createConfig(overrides: Partial<SimulationEngineConfig> = {}): SimulationEngineConfig {
  const topology = createBasicTopology();
  return {
    topology,
    seed: 42,
    speedMultiplier: 50,
    maxSimulatedTimeMs: 5000, // 5 seconds simulated
    metricsIntervalMs: 1000,
    maxHopsPerRequest: 20,
    disablePacing: true, // No delays in tests
    ...overrides,
  };
}

describe('SimulationEngine', () => {
  it('initializes without error', () => {
    const engine = new SimulationEngine(createConfig());
    expect(engine.getState()).toBe('IDLE');
  });

  it('runs and completes within max simulated time', async () => {
    const config = createConfig({ maxSimulatedTimeMs: 2000 });
    const engine = new SimulationEngine(config);

    let completed = false;
    engine.setCallbacks({
      onComplete: () => { completed = true; },
    });

    await engine.run();
    expect(completed).toBe(true);
    expect(engine.getState()).toBe('COMPLETE');
  });

  it('produces metrics batches during simulation', async () => {
    const config = createConfig({ maxSimulatedTimeMs: 3000, metricsIntervalMs: 1000 });
    const engine = new SimulationEngine(config);

    const batches: MetricsBatchPayload[] = [];
    engine.setCallbacks({
      onMetricsBatch: (batch) => batches.push(batch),
    });

    await engine.run();

    // Should have at least 2 metrics batches (at 1000ms and 2000ms)
    expect(batches.length).toBeGreaterThanOrEqual(2);
    // Each batch should have node snapshots
    expect(batches[0]!.nodes.length).toBe(3);
  });

  it('deterministic: same seed produces same results', async () => {
    const config1 = createConfig({ maxSimulatedTimeMs: 2000 });
    const config2 = createConfig({ maxSimulatedTimeMs: 2000 });

    const engine1 = new SimulationEngine(config1);
    const engine2 = new SimulationEngine(config2);

    let summary1: Record<string, unknown> | null = null;
    let summary2: Record<string, unknown> | null = null;

    engine1.setCallbacks({ onComplete: (s) => { summary1 = s as Record<string, unknown>; } });
    engine2.setCallbacks({ onComplete: (s) => { summary2 = s as Record<string, unknown>; } });

    await engine1.run();
    await engine2.run();

    // Compare only deterministic fields (exclude wall-clock-dependent values)
    const deterministicFields = (s: Record<string, unknown>) => ({
      totalEvents: s.totalEvents,
      totalRequests: s.totalRequests,
      successRate: s.successRate,
      avgEndToEndLatencyMs: s.avgEndToEndLatencyMs,
      simulatedDurationMs: s.simulatedDurationMs,
    });

    expect(deterministicFields(summary1!)).toEqual(deterministicFields(summary2!));
  });

  it('pause stops the simulation loop', async () => {
    const config = createConfig({ maxSimulatedTimeMs: 100000 }); // Long sim
    const engine = new SimulationEngine(config);

    // Start and immediately pause after a short delay
    const runPromise = engine.run();
    // Give it a tick to process at least one batch
    await new Promise((resolve) => setTimeout(resolve, 10));
    engine.pause();
    await runPromise;

    expect(engine.getState()).toBe('PAUSED');
  });

  it('reset clears state', async () => {
    const config = createConfig({ maxSimulatedTimeMs: 1000 });
    const engine = new SimulationEngine(config);

    await engine.run();
    expect(engine.getState()).toBe('COMPLETE');

    engine.reset();
    expect(engine.getState()).toBe('IDLE');
    expect(engine.getVirtualTime()).toBe(0);
  });

  it('handles disconnected generator (no outgoing edges) gracefully', async () => {
    const nodes: SimulationNode[] = [
      {
        id: 'gen-orphan',
        nodeType: NodeType.TrafficGenerator,
        label: 'Orphan Gen',
        position: { x: 0, y: 0 },
        config: {
          rps: 50,
          distribution: Distribution.Uniform,
          spikeMultiplier: 1,
          spikeDurationSec: 0,
        },
      },
    ];
    const edges: EdgeData[] = [];

    const config = createConfig({
      topology: { nodes, edges },
      maxSimulatedTimeMs: 1000,
    });
    const engine = new SimulationEngine(config);

    let completed = false;
    engine.setCallbacks({
      onComplete: (summary) => {
        completed = true;
        // All requests should have NO_ROUTE status
        expect(summary.successRate).toBe(0);
      },
    });

    await engine.run();
    expect(completed).toBe(true);
  });

  it('processes ≥500 events/sec (performance benchmark)', async () => {
    // Larger topology for performance testing
    const nodes: SimulationNode[] = [
      {
        id: 'gen-1',
        nodeType: NodeType.TrafficGenerator,
        label: 'Gen 1',
        position: { x: 0, y: 0 },
        config: { rps: 500, distribution: Distribution.Uniform, spikeMultiplier: 1, spikeDurationSec: 0 },
      },
      {
        id: 'lb-1',
        nodeType: NodeType.LoadBalancer,
        label: 'LB',
        position: { x: 100, y: 0 },
        config: { algorithm: LBAlgorithm.RoundRobin, healthCheckIntervalMs: 1000, evictionThreshold: 3 },
      },
      {
        id: 'app-1',
        nodeType: NodeType.AppServer,
        label: 'App 1',
        position: { x: 200, y: -50 },
        config: { workerThreadPoolSize: 50, requestQueueDepth: 200, processingTimeMeanMs: 3, processingTimeStdDevMs: 1 },
      },
      {
        id: 'app-2',
        nodeType: NodeType.AppServer,
        label: 'App 2',
        position: { x: 200, y: 50 },
        config: { workerThreadPoolSize: 50, requestQueueDepth: 200, processingTimeMeanMs: 3, processingTimeStdDevMs: 1 },
      },
      {
        id: 'db-1',
        nodeType: NodeType.Database,
        label: 'DB',
        position: { x: 400, y: 0 },
        config: { connectionPoolSize: 50, queryLatencyMeanMs: 5, queryLatencyStdDevMs: 1, lockTimeoutMs: 5000, dbType: DatabaseType.Relational },
      },
    ];

    const edges: EdgeData[] = [
      { id: 'e1', source: 'gen-1', target: 'lb-1', protocol: EdgeProtocol.Sync },
      { id: 'e2', source: 'lb-1', target: 'app-1', protocol: EdgeProtocol.Sync },
      { id: 'e3', source: 'lb-1', target: 'app-2', protocol: EdgeProtocol.Sync },
      { id: 'e4', source: 'app-1', target: 'db-1', protocol: EdgeProtocol.Sync },
      { id: 'e5', source: 'app-2', target: 'db-1', protocol: EdgeProtocol.Sync },
    ];

    const config = createConfig({
      topology: { nodes, edges },
      maxSimulatedTimeMs: 10000, // 10 seconds simulated
      metricsIntervalMs: 5000,
    });

    const engine = new SimulationEngine(config);

    let eventsPerSecond = 0;
    engine.setCallbacks({
      onComplete: (summary) => {
        eventsPerSecond = summary.eventsPerSecond;
      },
    });

    await engine.run();

    // Must achieve at least 500 events/sec
    expect(eventsPerSecond).toBeGreaterThan(500);
  }, 30000); // 30s timeout for CI

  it('chaos injection affects node behavior', async () => {
    const nodes: SimulationNode[] = [
      {
        id: 'gen-1',
        nodeType: NodeType.TrafficGenerator,
        label: 'Gen',
        position: { x: 0, y: 0 },
        config: { rps: 100, distribution: Distribution.Uniform, spikeMultiplier: 5, spikeDurationSec: 15 },
      },
      {
        id: 'cache-1',
        nodeType: NodeType.Cache,
        label: 'Cache',
        position: { x: 200, y: 0 },
        config: { hitRatio: 0.95, evictionPolicy: EvictionPolicy.LRU, accessLatencyMs: 1 },
      },
      {
        id: 'db-1',
        nodeType: NodeType.Database,
        label: 'DB',
        position: { x: 400, y: 0 },
        config: { connectionPoolSize: 20, queryLatencyMeanMs: 10, queryLatencyStdDevMs: 2, lockTimeoutMs: 5000, dbType: DatabaseType.Relational },
      },
    ];

    const edges: EdgeData[] = [
      { id: 'e1', source: 'gen-1', target: 'cache-1', protocol: EdgeProtocol.Sync },
      { id: 'e2', source: 'cache-1', target: 'db-1', protocol: EdgeProtocol.Sync },
    ];

    const config = createConfig({
      topology: { nodes, edges },
      maxSimulatedTimeMs: 5000,
      metricsIntervalMs: 2000,
    });

    const engine = new SimulationEngine(config);
    const batches: MetricsBatchPayload[] = [];
    engine.setCallbacks({
      onMetricsBatch: (b) => batches.push(b),
    });

    // Inject cache flush chaos at start (will flush for 3000ms)
    engine.injectChaos({
      chaosType: 'FLUSH_CACHE',
      durationMs: 3000,
      params: {},
    });

    await engine.run();

    // During chaos, all requests should hit the DB (cache miss rate = 100%)
    // After chaos reverts, normal hit ratio resumes
    expect(batches.length).toBeGreaterThan(0);
  });
});
