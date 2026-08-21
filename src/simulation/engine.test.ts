import { describe, it, expect } from 'vitest';
import { SimulationEngine } from './engine';
import {
  NodeType,
  Distribution,
  DatabaseType,
  EvictionPolicy,
  LBAlgorithm,
  BackpressureStrategy,
} from '@/types/nodes';
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

  it('cache miss rate is per-window and recovers after chaos reverts', async () => {
    const nodes: SimulationNode[] = [
      {
        id: 'gen-1',
        nodeType: NodeType.TrafficGenerator,
        label: 'Gen',
        position: { x: 0, y: 0 },
        config: { rps: 200, distribution: Distribution.Uniform, spikeMultiplier: 5, spikeDurationSec: 15 },
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
      maxSimulatedTimeMs: 8000,
      metricsIntervalMs: 1000,
    });

    const engine = new SimulationEngine(config);
    const cacheUtilization: number[] = [];
    engine.setCallbacks({
      onMetricsBatch: (b) => {
        const cache = b.nodes.find((n) => n.nodeId === 'cache-1');
        if (cache) cacheUtilization.push(cache.utilization);
      },
    });

    // Flush the cache for the first 2 seconds only
    engine.injectChaos({ chaosType: 'FLUSH_CACHE', durationMs: 2000, params: {} });

    await engine.run();

    expect(cacheUtilization.length).toBeGreaterThan(3);

    // First window is entirely under chaos: every lookup is a miss
    expect(cacheUtilization[0]).toBeGreaterThan(0.9);

    // Final window is well after chaos reverted. With a cumulative counter the
    // early misses would keep this high; per-window counters let it recover.
    // (configured miss rate is 0.05; the cumulative rate would still be ~0.3)
    const last = cacheUtilization[cacheUtilization.length - 1]!;
    expect(last).toBeLessThan(0.15);
  });

  it('reports non-zero active requests without leaking the in-flight counter', async () => {
    // Low-traffic gen → cache → db topology. The true average in-flight count here
    // is a fraction of a request, which must not be reported as 0.
    const nodes: SimulationNode[] = [
      {
        id: 'gen-1',
        nodeType: NodeType.TrafficGenerator,
        label: 'Gen',
        position: { x: 0, y: 0 },
        config: { rps: 20, distribution: Distribution.Uniform, spikeMultiplier: 1, spikeDurationSec: 0 },
      },
      {
        id: 'cache-1',
        nodeType: NodeType.Cache,
        label: 'Cache',
        position: { x: 200, y: 0 },
        config: { hitRatio: 0.9, evictionPolicy: EvictionPolicy.LRU, accessLatencyMs: 1 },
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
      metricsIntervalMs: 1000,
    });

    const engine = new SimulationEngine(config);
    const batches: MetricsBatchPayload[] = [];
    let summary: { totalRequests: number; successRate: number } | null = null;
    engine.setCallbacks({
      onMetricsBatch: (b) => batches.push(b),
      onComplete: (s) => { summary = s; },
    });

    await engine.run();

    expect(batches.length).toBeGreaterThanOrEqual(4);
    const activeSeries = batches.map((b) => b.systemWide.activeRequests);
    // The final batch is the completion snapshot, which reports the instantaneous
    // count rather than a windowed average. Only the mid-run windows exercise the
    // time-weighted average, so the "is it live?" check must ignore the tail.
    const midRun = activeSeries.slice(0, -1);

    // (1) The counter is live. True steady-state occupancy here is ~0.1 requests:
    // rounding to whole numbers, or releasing cache hits before their response
    // traversal finishes, both collapse every one of these windows to 0.
    expect(Math.max(...midRun)).toBeGreaterThan(0);

    // (2) No leak. ResponseComplete now owns the decrement for every success path
    // (cache hits and MQ enqueues included). If any success path failed to release
    // its slot, the count would grow monotonically toward totalRequests.
    const total = summary!.totalRequests;
    expect(total).toBeGreaterThanOrEqual(100);
    const lastActive = activeSeries[activeSeries.length - 1]!;
    expect(lastActive).toBeLessThan(total * 0.1);
    // Steady state for this topology is well under one request in flight.
    expect(lastActive).toBeLessThan(10);

    // (3) Requests reach a terminal state rather than hanging in flight.
    expect(summary!.successRate).toBeGreaterThan(0.9);
  });

  it('MQ consumer drain delivers messages to the downstream node', async () => {
    // gen → mq → app over an ASYNC edge. The enqueue is not the end of the
    // request's journey: the consumer poll must route each buffered message to
    // the AppServer. Modest RPS and a generous buffer keep backpressure out of
    // the picture so this isolates the drain path.
    const nodes: SimulationNode[] = [
      {
        id: 'gen-1',
        nodeType: NodeType.TrafficGenerator,
        label: 'Gen',
        position: { x: 0, y: 0 },
        config: { rps: 50, distribution: Distribution.Uniform, spikeMultiplier: 1, spikeDurationSec: 0 },
      },
      {
        id: 'mq-1',
        nodeType: NodeType.MessageQueue,
        label: 'Queue',
        position: { x: 200, y: 0 },
        config: {
          consumerBatchSize: 50,
          bufferCapacity: 1000,
          backpressureThresholdPct: 80,
          backpressureStrategy: BackpressureStrategy.DropOldest,
        },
      },
      {
        id: 'app-1',
        nodeType: NodeType.AppServer,
        label: 'Consumer App',
        position: { x: 400, y: 0 },
        config: {
          workerThreadPoolSize: 20,
          requestQueueDepth: 200,
          processingTimeMeanMs: 5,
          processingTimeStdDevMs: 1,
        },
      },
    ];

    const edges: EdgeData[] = [
      { id: 'e1', source: 'gen-1', target: 'mq-1', protocol: EdgeProtocol.Sync },
      { id: 'e2', source: 'mq-1', target: 'app-1', protocol: EdgeProtocol.Async },
    ];

    const config = createConfig({
      topology: { nodes, edges },
      maxSimulatedTimeMs: 10000,
      metricsIntervalMs: 1000,
    });

    const engine = new SimulationEngine(config);
    const batches: MetricsBatchPayload[] = [];
    let summary: { totalRequests: number; successRate: number } | null = null;
    engine.setCallbacks({
      onMetricsBatch: (b) => batches.push(b),
      onComplete: (s) => { summary = s; },
    });

    await engine.run();

    expect(batches.length).toBeGreaterThanOrEqual(4);

    // (1) Messages actually reached the consumer. If the enqueue marks the
    // request Success, every drained message is rejected by the InFlight guard
    // in handleRequestRoute and the AppServer never sees a single one.
    const appThroughput = batches
      .map((b) => b.nodes.find((n) => n.nodeId === 'app-1')!.throughput);
    expect(Math.max(...appThroughput)).toBeGreaterThan(0);

    // (2) No in-flight leak: the count must not creep toward totalRequests.
    const total = summary!.totalRequests;
    expect(total).toBeGreaterThanOrEqual(200);
    const activeSeries = batches.map((b) => b.systemWide.activeRequests);
    expect(activeSeries[activeSeries.length - 1]!).toBeLessThan(total * 0.1);

    // (3) The async leg completes end to end.
    expect(summary!.successRate).toBeGreaterThan(0.5);
  }, 30000);

  it('MQ DropOldest eviction terminates the evicted request', async () => {
    // Tiny buffer plus heavy load means near-constant eviction. Each evicted
    // message must reach a terminal state; otherwise it stays InFlight forever
    // and activeRequests grows without bound.
    const nodes: SimulationNode[] = [
      {
        id: 'gen-1',
        nodeType: NodeType.TrafficGenerator,
        label: 'Gen',
        position: { x: 0, y: 0 },
        config: { rps: 500, distribution: Distribution.Uniform, spikeMultiplier: 1, spikeDurationSec: 0 },
      },
      {
        id: 'mq-1',
        nodeType: NodeType.MessageQueue,
        label: 'Tiny Queue',
        position: { x: 200, y: 0 },
        config: {
          consumerBatchSize: 2,
          bufferCapacity: 5,
          backpressureThresholdPct: 80,
          backpressureStrategy: BackpressureStrategy.DropOldest,
        },
      },
      {
        id: 'app-1',
        nodeType: NodeType.AppServer,
        label: 'Consumer App',
        position: { x: 400, y: 0 },
        config: {
          workerThreadPoolSize: 5,
          requestQueueDepth: 20,
          processingTimeMeanMs: 20,
          processingTimeStdDevMs: 2,
        },
      },
    ];

    const edges: EdgeData[] = [
      { id: 'e1', source: 'gen-1', target: 'mq-1', protocol: EdgeProtocol.Sync },
      { id: 'e2', source: 'mq-1', target: 'app-1', protocol: EdgeProtocol.Async },
    ];

    const config = createConfig({
      topology: { nodes, edges },
      maxSimulatedTimeMs: 5000,
      metricsIntervalMs: 1000,
    });

    const engine = new SimulationEngine(config);
    const batches: MetricsBatchPayload[] = [];
    let summary: { totalRequests: number } | null = null;
    engine.setCallbacks({
      onMetricsBatch: (b) => batches.push(b),
      onComplete: (s) => { summary = s; },
    });

    await engine.run();

    // Eviction must have happened for this test to mean anything.
    const mqBufferPeak = Math.max(
      ...batches.map((b) => b.nodes.find((n) => n.nodeId === 'mq-1')!.bufferOccupancy),
    );
    expect(mqBufferPeak).toBeGreaterThanOrEqual(5);

    const total = summary!.totalRequests;
    expect(total).toBeGreaterThanOrEqual(1000);

    // Active requests stays bounded by the actual work in the system (buffer +
    // app pool + app queue), nowhere near the total request count.
    const activeSeries = batches.map((b) => b.systemWide.activeRequests);
    expect(activeSeries[activeSeries.length - 1]!).toBeLessThan(total * 0.1);
  }, 30000);
});
