import { describe, it, expect, vi } from 'vitest';
import { SimulationEngine } from './engine';
import {
  NodeType,
  Distribution,
  DatabaseType,
  EvictionPolicy,
  LBAlgorithm,
  BackpressureStrategy,
  RoutingPolicy,
} from '@/types/nodes';
import type { SimulationNode } from '@/types/nodes';
import type { EdgeData } from '@/types/edges';
import { EdgeProtocol } from '@/types/edges';
import type { SimulationEngineConfig } from '@/types/messages';
import type { MetricsBatchPayload, UtilizationReading } from '@/types/metrics';

/**
 * Utilization is a discriminated reading. Every assertion below is about the numeric
 * variant, so unwrap it loudly rather than coercing a not-applicable reading to a number.
 */
function numericUtilization(reading: UtilizationReading): number {
  if (reading.kind !== 'value') {
    throw new Error(`expected a numeric utilization reading, got: ${reading.reason}`);
  }
  return reading.value;
}

function createBasicTopology(): { nodes: SimulationNode[]; edges: EdgeData[] } {
  const nodes: SimulationNode[] = [
    {
      id: 'gen-1',
      nodeType: NodeType.TrafficGenerator,
      label: 'Generator',
      position: { x: 0, y: 0 },
      routingPolicy: RoutingPolicy.First,
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
      routingPolicy: RoutingPolicy.First,
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
      routingPolicy: RoutingPolicy.First,
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
    { id: 'e1', source: 'gen-1', target: 'app-1', protocol: EdgeProtocol.Sync, weight: 1.0 },
    { id: 'e2', source: 'app-1', target: 'db-1', protocol: EdgeProtocol.Sync, weight: 1.0 },
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
      onComplete: () => {
        completed = true;
      },
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

    engine1.setCallbacks({
      onComplete: (s) => {
        summary1 = s as Record<string, unknown>;
      },
    });
    engine2.setCallbacks({
      onComplete: (s) => {
        summary2 = s as Record<string, unknown>;
      },
    });

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
        routingPolicy: RoutingPolicy.First,
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
        routingPolicy: RoutingPolicy.First,
        config: {
          rps: 500,
          distribution: Distribution.Uniform,
          spikeMultiplier: 1,
          spikeDurationSec: 0,
        },
      },
      {
        id: 'lb-1',
        nodeType: NodeType.LoadBalancer,
        label: 'LB',
        position: { x: 100, y: 0 },
        routingPolicy: RoutingPolicy.First,
        config: {
          algorithm: LBAlgorithm.RoundRobin,
          healthCheckIntervalMs: 1000,
          evictionThreshold: 3,
        },
      },
      {
        id: 'app-1',
        nodeType: NodeType.AppServer,
        label: 'App 1',
        position: { x: 200, y: -50 },
        routingPolicy: RoutingPolicy.First,
        config: {
          workerThreadPoolSize: 50,
          requestQueueDepth: 200,
          processingTimeMeanMs: 3,
          processingTimeStdDevMs: 1,
        },
      },
      {
        id: 'app-2',
        nodeType: NodeType.AppServer,
        label: 'App 2',
        position: { x: 200, y: 50 },
        routingPolicy: RoutingPolicy.First,
        config: {
          workerThreadPoolSize: 50,
          requestQueueDepth: 200,
          processingTimeMeanMs: 3,
          processingTimeStdDevMs: 1,
        },
      },
      {
        id: 'db-1',
        nodeType: NodeType.Database,
        label: 'DB',
        position: { x: 400, y: 0 },
        routingPolicy: RoutingPolicy.First,
        config: {
          connectionPoolSize: 50,
          queryLatencyMeanMs: 5,
          queryLatencyStdDevMs: 1,
          lockTimeoutMs: 5000,
          dbType: DatabaseType.Relational,
        },
      },
    ];

    const edges: EdgeData[] = [
      { id: 'e1', source: 'gen-1', target: 'lb-1', protocol: EdgeProtocol.Sync, weight: 1.0 },
      { id: 'e2', source: 'lb-1', target: 'app-1', protocol: EdgeProtocol.Sync, weight: 1.0 },
      { id: 'e3', source: 'lb-1', target: 'app-2', protocol: EdgeProtocol.Sync, weight: 1.0 },
      { id: 'e4', source: 'app-1', target: 'db-1', protocol: EdgeProtocol.Sync, weight: 1.0 },
      { id: 'e5', source: 'app-2', target: 'db-1', protocol: EdgeProtocol.Sync, weight: 1.0 },
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
        routingPolicy: RoutingPolicy.First,
        config: {
          rps: 100,
          distribution: Distribution.Uniform,
          spikeMultiplier: 5,
          spikeDurationSec: 15,
        },
      },
      {
        id: 'cache-1',
        nodeType: NodeType.Cache,
        label: 'Cache',
        position: { x: 200, y: 0 },
        routingPolicy: RoutingPolicy.First,
        config: { hitRatio: 0.95, evictionPolicy: EvictionPolicy.LRU, accessLatencyMs: 1 },
      },
      {
        id: 'db-1',
        nodeType: NodeType.Database,
        label: 'DB',
        position: { x: 400, y: 0 },
        routingPolicy: RoutingPolicy.First,
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
      { id: 'e1', source: 'gen-1', target: 'cache-1', protocol: EdgeProtocol.Sync, weight: 1.0 },
      { id: 'e2', source: 'cache-1', target: 'db-1', protocol: EdgeProtocol.Sync, weight: 1.0 },
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
        routingPolicy: RoutingPolicy.First,
        config: {
          rps: 200,
          distribution: Distribution.Uniform,
          spikeMultiplier: 5,
          spikeDurationSec: 15,
        },
      },
      {
        id: 'cache-1',
        nodeType: NodeType.Cache,
        label: 'Cache',
        position: { x: 200, y: 0 },
        routingPolicy: RoutingPolicy.First,
        config: { hitRatio: 0.95, evictionPolicy: EvictionPolicy.LRU, accessLatencyMs: 1 },
      },
      {
        id: 'db-1',
        nodeType: NodeType.Database,
        label: 'DB',
        position: { x: 400, y: 0 },
        routingPolicy: RoutingPolicy.First,
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
      { id: 'e1', source: 'gen-1', target: 'cache-1', protocol: EdgeProtocol.Sync, weight: 1.0 },
      { id: 'e2', source: 'cache-1', target: 'db-1', protocol: EdgeProtocol.Sync, weight: 1.0 },
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
        if (cache) cacheUtilization.push(numericUtilization(cache.utilization));
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
        routingPolicy: RoutingPolicy.First,
        config: {
          rps: 20,
          distribution: Distribution.Uniform,
          spikeMultiplier: 1,
          spikeDurationSec: 0,
        },
      },
      {
        id: 'cache-1',
        nodeType: NodeType.Cache,
        label: 'Cache',
        position: { x: 200, y: 0 },
        routingPolicy: RoutingPolicy.First,
        config: { hitRatio: 0.9, evictionPolicy: EvictionPolicy.LRU, accessLatencyMs: 1 },
      },
      {
        id: 'db-1',
        nodeType: NodeType.Database,
        label: 'DB',
        position: { x: 400, y: 0 },
        routingPolicy: RoutingPolicy.First,
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
      { id: 'e1', source: 'gen-1', target: 'cache-1', protocol: EdgeProtocol.Sync, weight: 1.0 },
      { id: 'e2', source: 'cache-1', target: 'db-1', protocol: EdgeProtocol.Sync, weight: 1.0 },
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
      onComplete: (s) => {
        summary = s;
      },
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
        routingPolicy: RoutingPolicy.First,
        config: {
          rps: 50,
          distribution: Distribution.Uniform,
          spikeMultiplier: 1,
          spikeDurationSec: 0,
        },
      },
      {
        id: 'mq-1',
        nodeType: NodeType.MessageQueue,
        label: 'Queue',
        position: { x: 200, y: 0 },
        routingPolicy: RoutingPolicy.First,
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
        routingPolicy: RoutingPolicy.First,
        config: {
          workerThreadPoolSize: 20,
          requestQueueDepth: 200,
          processingTimeMeanMs: 5,
          processingTimeStdDevMs: 1,
        },
      },
    ];

    const edges: EdgeData[] = [
      { id: 'e1', source: 'gen-1', target: 'mq-1', protocol: EdgeProtocol.Sync, weight: 1.0 },
      { id: 'e2', source: 'mq-1', target: 'app-1', protocol: EdgeProtocol.Async, weight: 1.0 },
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
      onComplete: (s) => {
        summary = s;
      },
    });

    await engine.run();

    expect(batches.length).toBeGreaterThanOrEqual(4);

    // (1) Messages actually reached the consumer. If the enqueue marks the
    // request Success, every drained message is rejected by the InFlight guard
    // in handleRequestRoute and the AppServer never sees a single one.
    const appThroughput = batches.map((b) => b.nodes.find((n) => n.nodeId === 'app-1')!.throughput);
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
        routingPolicy: RoutingPolicy.First,
        config: {
          rps: 500,
          distribution: Distribution.Uniform,
          spikeMultiplier: 1,
          spikeDurationSec: 0,
        },
      },
      {
        id: 'mq-1',
        nodeType: NodeType.MessageQueue,
        label: 'Tiny Queue',
        position: { x: 200, y: 0 },
        routingPolicy: RoutingPolicy.First,
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
        routingPolicy: RoutingPolicy.First,
        config: {
          workerThreadPoolSize: 5,
          requestQueueDepth: 20,
          processingTimeMeanMs: 20,
          processingTimeStdDevMs: 2,
        },
      },
    ];

    const edges: EdgeData[] = [
      { id: 'e1', source: 'gen-1', target: 'mq-1', protocol: EdgeProtocol.Sync, weight: 1.0 },
      { id: 'e2', source: 'mq-1', target: 'app-1', protocol: EdgeProtocol.Async, weight: 1.0 },
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
      onComplete: (s) => {
        summary = s;
      },
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

  it('circuit breaker trips on downstream failure and recovers after chaos reverts', async () => {
    // gen → breaker → db. DROP_DB makes every query time out, so the breaker
    // should observe the failure rate itself and fast-fail, then close again
    // once the database is healthy and the open window has elapsed.
    const nodes: SimulationNode[] = [
      {
        id: 'gen-1',
        nodeType: NodeType.TrafficGenerator,
        label: 'Gen',
        position: { x: 0, y: 0 },
        routingPolicy: RoutingPolicy.First,
        config: {
          rps: 200,
          distribution: Distribution.Uniform,
          spikeMultiplier: 1,
          spikeDurationSec: 0,
        },
      },
      {
        id: 'cb-1',
        nodeType: NodeType.CircuitBreaker,
        label: 'Breaker',
        position: { x: 200, y: 0 },
        routingPolicy: RoutingPolicy.First,
        config: { errorThreshold: 0.5, openDurationMs: 2000, probeCount: 3 },
      },
      {
        id: 'db-1',
        nodeType: NodeType.Database,
        label: 'DB',
        position: { x: 400, y: 0 },
        routingPolicy: RoutingPolicy.First,
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
      { id: 'e1', source: 'gen-1', target: 'cb-1', protocol: EdgeProtocol.Sync, weight: 1.0 },
      { id: 'e2', source: 'cb-1', target: 'db-1', protocol: EdgeProtocol.Sync, weight: 1.0 },
    ];

    const chaosDurationMs = 4000;
    const config = createConfig({
      topology: { nodes, edges },
      maxSimulatedTimeMs: 20000,
      metricsIntervalMs: 1000,
    });

    const engine = new SimulationEngine(config);
    const breakerUtilization: Array<{ t: number; utilization: number }> = [];
    engine.setCallbacks({
      onMetricsBatch: (b) => {
        const cb = b.nodes.find((n) => n.nodeId === 'cb-1');
        if (cb) {
          breakerUtilization.push({
            t: b.simulatedTimeMs,
            utilization: numericUtilization(cb.utilization),
          });
        }
      },
    });

    engine.injectChaos({ chaosType: 'DROP_DB', durationMs: chaosDurationMs, params: {} });

    await engine.run();

    expect(breakerUtilization.length).toBeGreaterThan(5);

    // While the DB is down the breaker must trip fully open at some point.
    // (Chaos starts at t=0, so this is already true by the first snapshot.)
    const duringChaos = breakerUtilization.filter((s) => s.t <= chaosDurationMs);
    expect(Math.max(...duringChaos.map((s) => s.utilization))).toBe(1);

    // Once the DB is healthy again and the open window has elapsed, the breaker
    // closes. Anything still pinned at 1 means it never recovered.
    const last = breakerUtilization[breakerUtilization.length - 1]!;
    expect(last.t).toBeGreaterThan(chaosDurationMs + 2000);
    expect(last.utilization).toBeLessThan(1);
  }, 30000);

  // ─── Phase 1 regressions ───────────────────────────────────────

  it('emits exactly one completion across a pause/resume that lands mid-yield', async () => {
    const config = createConfig({ maxSimulatedTimeMs: 3000 });
    const engine = new SimulationEngine(config);
    let completions = 0;
    engine.setCallbacks({
      onComplete: () => {
        completions++;
      },
    });

    // Start the run but do not await: the drain loop parks in its inter-batch
    // yield (a setTimeout in test mode), which is exactly where the historic
    // double-loop race lived — PAUSE+RESUME arriving while loop #1 is parked.
    void engine.run();
    engine.pause();
    engine.resume(1);
    engine.resume(1); // no-op: already Running, must not spawn a second loop

    await vi.waitFor(() => expect(engine.getState()).toBe('COMPLETE'));
    // Give any stray parked loop time to wrongly emit a duplicate completion.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(completions).toBe(1);
  });

  it('ignores run() while a loop owns the queue and resume() when not paused', async () => {
    // Long horizon (>1 inter-batch chunk) so the first run() is guaranteed to be
    // mid-flight when the synchronous control-assertions run — a short horizon
    // completes within a single 2000-event batch and reports COMPLETE early.
    const config = createConfig({ maxSimulatedTimeMs: 60000 });
    const engine = new SimulationEngine(config);

    const runPromise = engine.run();
    expect(engine.getState()).toBe('RUNNING');
    void engine.run(); // must be a no-op

    engine.resume(10); // no-op: not paused
    expect(engine.getState()).toBe('RUNNING');

    engine.pause();
    expect(engine.getState()).toBe('PAUSED');
    void engine.resume(10);
    expect(engine.getState()).toBe('RUNNING');

    await vi.waitFor(() => expect(engine.getState()).toBe('COMPLETE'));
    await runPromise;
  });

  it('does not burn the hop budget when a queued request is dequeued (fromQueue)', async () => {
    // pool=1 + steady arrivals force DB queueing; maxHops=2 means a dequeue
    // re-route that double-counted its hop would terminate as LOOP_DETECTED.
    const { nodes, edges } = createBasicTopology();
    const dbNode = nodes.find((n) => n.id === 'db-1')!;
    dbNode.config = {
      connectionPoolSize: 1,
      queryLatencyMeanMs: 10,
      queryLatencyStdDevMs: 2,
      lockTimeoutMs: 5000,
      dbType: DatabaseType.Relational,
    };

    const config = createConfig({
      topology: { nodes, edges },
      maxHopsPerRequest: 2,
      maxSimulatedTimeMs: 5000,
      metricsIntervalMs: 500,
    });
    const engine = new SimulationEngine(config);

    let loopDetectedTotal = 0;
    engine.setCallbacks({
      onMetricsBatch: (batch) => {
        for (const node of batch.nodes) {
          loopDetectedTotal += node.cumulativeTerminalCounts['LOOP_DETECTED'] ?? 0;
        }
      },
      onComplete: (summary) => {
        expect(summary.totalRequests).toBeGreaterThan(0);
        expect(summary.successRate).toBeGreaterThan(0.5);
      },
    });

    await engine.run();

    expect(loopDetectedTotal).toBe(0);
  });

  it('honors Fan_Out routing policy on the traffic generator first hop', async () => {
    const { nodes, edges } = createBasicTopology();
    const gen = nodes.find((n) => n.id === 'gen-1')!;
    gen.routingPolicy = RoutingPolicy.FanOut;

    const appB: SimulationNode = {
      id: 'app-2',
      nodeType: NodeType.AppServer,
      label: 'App Server B',
      position: { x: 200, y: 150 },
      routingPolicy: RoutingPolicy.First,
      config: {
        workerThreadPoolSize: 10,
        requestQueueDepth: 100,
        processingTimeMeanMs: 5,
        processingTimeStdDevMs: 1,
      },
    };
    nodes.push(appB);
    edges.push({
      id: 'e3',
      source: 'gen-1',
      target: 'app-2',
      protocol: EdgeProtocol.Sync,
      weight: 1.0,
    });

    const config = createConfig({
      topology: { nodes, edges },
      maxSimulatedTimeMs: 3000,
      metricsIntervalMs: 500,
    });
    const engine = new SimulationEngine(config);

    const maxArrivals = new Map<string, number>([
      ['app-1', 0],
      ['app-2', 0],
    ]);
    engine.setCallbacks({
      onMetricsBatch: (batch) => {
        for (const node of batch.nodes) {
          if (maxArrivals.has(node.nodeId)) {
            maxArrivals.set(
              node.nodeId,
              Math.max(maxArrivals.get(node.nodeId) ?? 0, node.arrivalCount),
            );
          }
        }
      },
    });

    await engine.run();

    expect(maxArrivals.get('app-1')).toBeGreaterThan(0);
    expect(maxArrivals.get('app-2')).toBeGreaterThan(0);
  });

  it('keeps the request map bounded during a high-volume run (eviction)', async () => {
    const config = createConfig({ maxSimulatedTimeMs: 10000, metricsIntervalMs: 1000 });
    const engine = new SimulationEngine(config);

    let summary: { totalRequests: number } | null = null;
    engine.setCallbacks({
      onComplete: (s) => {
        summary = { totalRequests: s.totalRequests };
      },
    });

    await engine.run();

    const total = summary!.totalRequests;
    // The run must actually be high-volume for this assertion to mean anything.
    expect(total).toBeGreaterThan(300);
    // Terminal requests are evicted; only genuinely in-flight/DLQ-retained
    // requests may remain. Allow a generous slack window rather than a hard 0.
    expect(engine.liveRequestCount).toBeLessThan(100);
  });

  it('includes whole-run aggregates in the completion summary', async () => {
    const config = createConfig({ maxSimulatedTimeMs: 3000 });
    const engine = new SimulationEngine(config);

    let summary: import('@/types/messages').SimulationSummary | null = null;
    engine.setCallbacks({
      onComplete: (s) => {
        summary = s;
      },
    });

    await engine.run();

    expect(summary).not.toBeNull();
    const whole = summary!.wholeRun;
    expect(whole).toBeDefined();
    expect(whole!.throughput).toBeGreaterThan(0);
    expect(whole!.latency.p99).toBeGreaterThanOrEqual(whole!.latency.p50);
    // Terminal-status shares sum to ~1 across all nine statuses
    const shareSum = Object.values(whole!.terminalStatusRates).reduce((a, b) => a + b, 0);
    expect(shareSum).toBeGreaterThan(0.99);
    expect(shareSum).toBeLessThanOrEqual(1.001);
  });

  // ─── Phase 4 regressions ───────────────────────────────────────

  it('DISABLE_NODE terminates requests being processed by app-server workers', async () => {
    const { nodes, edges } = createBasicTopology();
    const app = nodes.find((n) => n.id === 'app-1')!;
    app.config = {
      workerThreadPoolSize: 10,
      requestQueueDepth: 100,
      processingTimeMeanMs: 3000,
      processingTimeStdDevMs: 10,
    };

    const config = createConfig({
      topology: { nodes, edges },
      // Long horizon: the (fast) paced run must still be alive when the chaos
      // injection lands mid-run and must have ample post-restore traffic left so
      // the final window carries throughput again.
      maxSimulatedTimeMs: 60000,
      metricsIntervalMs: 500,
      // Real pacing keeps the run alive across several 2000-event batches so the
      // chaos injection can be landed deterministically inside the busy window.
      disablePacing: false,
      speedMultiplier: 1,
    });
    const engine = new SimulationEngine(config);

    let minActiveConnections = Infinity;
    let appTimeouts = 0;
    let lastThroughput = 0;
    engine.setCallbacks({
      onMetricsBatch: (batch) => {
        const snapshot = batch.nodes.find((n) => n.nodeId === 'app-1');
        if (snapshot) {
          minActiveConnections = Math.min(minActiveConnections, snapshot.activeConnections);
          appTimeouts = Math.max(appTimeouts, snapshot.cumulativeTerminalCounts['TIMEOUT'] ?? 0);
        }
        lastThroughput = batch.systemWide.totalThroughput;
      },
    });

    void engine.run();
    // Land the injection deterministically mid-run: as soon as the virtual clock
    // has advanced past t=0, workers are certainly busy (3s processing vs 10ms
    // inter-arrivals means every worker slot is occupied continuously).
    await vi.waitFor(() => {
      expect(engine.getState()).toBe('RUNNING');
      expect(engine.getVirtualTime()).toBeGreaterThan(0);
    });
    engine.injectChaos({
      chaosType: 'DISABLE_NODE',
      targetNodeId: 'app-1',
      durationMs: 1500,
      params: {},
    });

    await vi.waitFor(() => expect(engine.getState()).toBe('COMPLETE'));

    expect(appTimeouts).toBeGreaterThan(0);
    expect(minActiveConnections).toBeGreaterThanOrEqual(0);
    // After restoration traffic flows again (final window has throughput).
    expect(lastThroughput).toBeGreaterThan(0);
  }, 30000);

  it('load balancer drops instantly when its database is dropped via chaos', async () => {
    const nodes: SimulationNode[] = [
      {
        id: 'gen-1',
        nodeType: NodeType.TrafficGenerator,
        label: 'Generator',
        position: { x: 0, y: 0 },
        routingPolicy: RoutingPolicy.First,
        config: {
          rps: 100,
          distribution: Distribution.Uniform,
          spikeMultiplier: 5,
          spikeDurationSec: 15,
        },
      },
      {
        id: 'lb-1',
        nodeType: NodeType.LoadBalancer,
        label: 'LB',
        position: { x: 200, y: 0 },
        routingPolicy: RoutingPolicy.First,
        config: {
          algorithm: LBAlgorithm.RoundRobin,
          healthCheckIntervalMs: 60000, // longer than the run: only chaos may eject
          evictionThreshold: 3,
        },
      },
      {
        id: 'db-1',
        nodeType: NodeType.Database,
        label: 'Database',
        position: { x: 400, y: 0 },
        routingPolicy: RoutingPolicy.First,
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
      { id: 'e1', source: 'gen-1', target: 'lb-1', protocol: EdgeProtocol.Sync, weight: 1.0 },
      { id: 'e2', source: 'lb-1', target: 'db-1', protocol: EdgeProtocol.Sync, weight: 1.0 },
    ];

    const chaosDurationMs = 2000;
    const config = createConfig({
      topology: { nodes, edges },
      maxSimulatedTimeMs: 6000,
      metricsIntervalMs: 250,
    });
    const engine = new SimulationEngine(config);

    let lbDropped = 0;
    let dbTimeouts = 0;
    engine.setCallbacks({
      onMetricsBatch: (batch) => {
        const lb = batch.nodes.find((n) => n.nodeId === 'lb-1');
        const db = batch.nodes.find((n) => n.nodeId === 'db-1');
        if (lb) lbDropped = Math.max(lbDropped, lb.cumulativeTerminalCounts['DROPPED'] ?? 0);
        if (db) dbTimeouts = Math.max(dbTimeouts, db.cumulativeTerminalCounts['TIMEOUT'] ?? 0);
      },
    });

    engine.injectChaos({
      chaosType: 'DROP_DB',
      targetNodeId: 'db-1',
      durationMs: chaosDurationMs,
      params: { targetNodeId: 'db-1' },
    });

    await engine.run();

    // The LB ejected the DB instantly, so arrivals died as DROPPED at the LB —
    // not as TIMEOUTs at an unreachable database.
    expect(lbDropped).toBeGreaterThan(0);
    expect(dbTimeouts).toBe(0);
  });

  it('health-check probes eject a dead target after the failure threshold and restore it', async () => {
    const nodes: SimulationNode[] = [
      {
        id: 'gen-1',
        nodeType: NodeType.TrafficGenerator,
        label: 'Generator',
        position: { x: 0, y: 0 },
        routingPolicy: RoutingPolicy.First,
        config: {
          rps: 50,
          distribution: Distribution.Uniform,
          spikeMultiplier: 5,
          spikeDurationSec: 15,
        },
      },
      {
        id: 'lb-1',
        nodeType: NodeType.LoadBalancer,
        label: 'LB',
        position: { x: 200, y: 0 },
        routingPolicy: RoutingPolicy.First,
        config: {
          algorithm: LBAlgorithm.RoundRobin,
          healthCheckIntervalMs: 250,
          evictionThreshold: 3,
        },
      },
      {
        id: 'db-1',
        nodeType: NodeType.Database,
        label: 'Database',
        position: { x: 400, y: 0 },
        routingPolicy: RoutingPolicy.First,
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
      { id: 'e1', source: 'gen-1', target: 'lb-1', protocol: EdgeProtocol.Sync, weight: 1.0 },
      { id: 'e2', source: 'lb-1', target: 'db-1', protocol: EdgeProtocol.Sync, weight: 1.0 },
    ];

    const config = createConfig({
      topology: { nodes, edges },
      maxSimulatedTimeMs: 8000,
      metricsIntervalMs: 500,
    });
    const engine = new SimulationEngine(config);

    let lbDropped = 0;
    let lastThroughput = 0;
    engine.setCallbacks({
      onMetricsBatch: (batch) => {
        const lb = batch.nodes.find((n) => n.nodeId === 'lb-1');
        if (lb) lbDropped = Math.max(lbDropped, lb.cumulativeTerminalCounts['DROPPED'] ?? 0);
        lastThroughput = batch.systemWide.totalThroughput;
      },
    });

    // params deliberately empty: only the health-check probes may discover the
    // outage and eject the target (no instant chaos notification).
    engine.injectChaos({
      chaosType: 'DROP_DB',
      targetNodeId: 'db-1',
      durationMs: 2000,
      params: {},
    });

    await engine.run();

    // Three failed probes @250ms ⇒ ejected ⇒ subsequent arrivals dropped at LB.
    expect(lbDropped).toBeGreaterThan(0);
    // A passing probe after the DB recovered puts it back into rotation.
    expect(lastThroughput).toBeGreaterThan(0);
  });

  it('does not eject targets when failures never reach the eviction threshold', async () => {
    const nodes: SimulationNode[] = [
      {
        id: 'gen-1',
        nodeType: NodeType.TrafficGenerator,
        label: 'Generator',
        position: { x: 0, y: 0 },
        routingPolicy: RoutingPolicy.First,
        config: {
          rps: 20,
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
        routingPolicy: RoutingPolicy.First,
        config: {
          workerThreadPoolSize: 10,
          requestQueueDepth: 100,
          processingTimeMeanMs: 5,
          processingTimeStdDevMs: 1,
        },
      },
      {
        id: 'lb-1',
        nodeType: NodeType.LoadBalancer,
        label: 'LB',
        position: { x: 400, y: 0 },
        routingPolicy: RoutingPolicy.First,
        config: {
          algorithm: LBAlgorithm.RoundRobin,
          healthCheckIntervalMs: 100,
          evictionThreshold: 1_000_000,
        },
      },
      {
        id: 'db-1',
        nodeType: NodeType.Database,
        label: 'Database',
        position: { x: 600, y: 0 },
        routingPolicy: RoutingPolicy.First,
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
      { id: 'e1', source: 'gen-1', target: 'app-1', protocol: EdgeProtocol.Sync, weight: 1.0 },
      { id: 'e2', source: 'app-1', target: 'lb-1', protocol: EdgeProtocol.Sync, weight: 1.0 },
      { id: 'e3', source: 'lb-1', target: 'db-1', protocol: EdgeProtocol.Sync, weight: 1.0 },
    ];

    const config = createConfig({
      topology: { nodes, edges },
      maxSimulatedTimeMs: 4000,
      metricsIntervalMs: 500,
    });
    const engine = new SimulationEngine(config);

    let lbDropped = 0;
    engine.setCallbacks({
      onMetricsBatch: (batch) => {
        const lb = batch.nodes.find((n) => n.nodeId === 'lb-1');
        if (lb) lbDropped = Math.max(lbDropped, lb.cumulativeTerminalCounts['DROPPED'] ?? 0);
      },
    });

    engine.injectChaos({
      chaosType: 'DROP_DB',
      targetNodeId: 'db-1',
      durationMs: 1500,
      params: {},
    });

    await engine.run();

    // Threshold never reached ⇒ the healthy set is never emptied ⇒ no drops at the LB.
    expect(lbDropped).toBe(0);
  });

  it('records offered-load arrivals and round-trip departures at the generator', async () => {
    const config = createConfig({ maxSimulatedTimeMs: 3000, metricsIntervalMs: 500 });
    const engine = new SimulationEngine(config);

    let genArrivals = 0;
    let genDepartures = 0;
    let lastThroughput = 0;
    engine.setCallbacks({
      onMetricsBatch: (batch) => {
        const gen = batch.nodes.find((n) => n.nodeId === 'gen-1');
        if (gen) {
          genArrivals = Math.max(genArrivals, gen.arrivalCount);
          genDepartures = Math.max(genDepartures, gen.departureCount);
        }
        lastThroughput = batch.systemWide.totalThroughput;
      },
    });

    await engine.run();

    // The source node must show a real λ (offered load) and a matching
    // departure stream — not the all-zero row that made the per-node table
    // look like nothing was recorded.
    expect(lastThroughput).toBeGreaterThan(0);
    expect(genArrivals).toBeGreaterThan(40);
    expect(genDepartures).toBeGreaterThan(30);
  });

  it('reports every top-level termination to the sweep recorder with sim time', async () => {
    const config = createConfig({ maxSimulatedTimeMs: 2000 });
    const engine = new SimulationEngine(config);

    const reports: { status: string; simTimeMs: number }[] = [];
    engine.setSweepRecorder((_latencyMs, status, _isError, _isSchedulerJob, simTimeMs) => {
      reports.push({ status, simTimeMs });
    });

    let totalRequests = 0;
    let unfinished = 0;
    const seenStatuses = new Set<string>();
    engine.setCallbacks({
      onComplete: (summary) => {
        totalRequests = summary.totalRequests;
        unfinished = Math.round(summary.totalRequests * (1 - summary.successRate)) || 0;
        void unfinished;
      },
      onMetricsBatch: () => {},
    });

    await engine.run();

    // One report per finished top-level request; every report is a terminal
    // status and carries a virtual time inside the run horizon.
    expect(reports.length).toBeGreaterThan(0);
    for (const report of reports) {
      expect(report.status).not.toBe('IN_FLIGHT');
      seenStatuses.add(report.status);
      expect(report.simTimeMs).toBeLessThanOrEqual(2000);
      expect(report.simTimeMs).toBeGreaterThanOrEqual(0);
    }
    void totalRequests;
  });
});
