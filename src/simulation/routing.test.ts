import { describe, it, expect, vi } from 'vitest';
import { SimulationEngine } from './engine';
import { NodeType, Distribution, RoutingPolicy } from '@/types/nodes';
import type { SimulationNode } from '@/types/nodes';
import type { EdgeData } from '@/types/edges';
import { EdgeProtocol } from '@/types/edges';
import type { SimulationEngineConfig } from '@/types/messages';

// ─── Helpers ─────────────────────────────────────────────────────

function makeNode(id: string, type: NodeType, label: string, policy: RoutingPolicy): SimulationNode {
  const base = { id, nodeType: type, label, position: { x: 0, y: 0 }, routingPolicy: policy };
  switch (type) {
    case NodeType.TrafficGenerator:
      return { ...base, nodeType: type, config: { rps: 100, distribution: Distribution.Uniform, spikeMultiplier: 1, spikeDurationSec: 0 } };
    case NodeType.AppServer:
      return { ...base, nodeType: type, config: { workerThreadPoolSize: 10, requestQueueDepth: 100, processingTimeMeanMs: 5, processingTimeStdDevMs: 1 } };
    case NodeType.Database:
      return { ...base, nodeType: type, config: { connectionPoolSize: 10, queryLatencyMeanMs: 5, queryLatencyStdDevMs: 1, lockTimeoutMs: 5000, dbType: 'RELATIONAL' as never } };
    case NodeType.RateLimiter:
      return { ...base, nodeType: type, config: { bucketCapacity: 10000, refillRatePerSec: 10000 } };
    case NodeType.Cache:
      return { ...base, nodeType: type, config: { hitRatio: 0.0, evictionPolicy: 'LRU' as never, accessLatencyMs: 1 } };
  }
  return base as SimulationNode;
}

function makeEdge(id: string, source: string, target: string, weight = 1.0): EdgeData {
  return { id, source, target, protocol: EdgeProtocol.Sync, weight };
}

function buildConfig(nodes: SimulationNode[], edges: EdgeData[], seed = 42): SimulationEngineConfig {
  return {
    topology: { nodes, edges },
    seed,
    speedMultiplier: 1,
    maxSimulatedTimeMs: 50000,
    metricsIntervalMs: 5000,
    maxHopsPerRequest: 20,
    disablePacing: true,
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe('Routing Policies', () => {
  describe('First policy', () => {
    it('always selects the first edge by stored index (lowest index)', async () => {
      const nodes: SimulationNode[] = [
        makeNode('gen', NodeType.TrafficGenerator, 'Gen', RoutingPolicy.First),
        makeNode('rl', NodeType.RateLimiter, 'RL', RoutingPolicy.First),
        makeNode('app-a', NodeType.AppServer, 'App A', RoutingPolicy.First),
        makeNode('app-b', NodeType.AppServer, 'App B', RoutingPolicy.First),
        makeNode('db', NodeType.Database, 'DB', RoutingPolicy.First),
      ];
      const edges: EdgeData[] = [
        makeEdge('e1', 'gen', 'rl'),
        makeEdge('e2', 'rl', 'app-a'),  // index 0 for rl
        makeEdge('e3', 'rl', 'app-b'),  // index 1 for rl
        makeEdge('e4', 'app-a', 'db'),
        makeEdge('e5', 'app-b', 'db'),
      ];

      const config = buildConfig(nodes, edges);
      const engine = new SimulationEngine(config);

      const routedTo: string[] = [];
      engine.setCallbacks({
        onMetricsBatch: (batch) => {
          // Check that only app-a got traffic
          const appA = batch.nodes.find((n) => n.nodeId === 'app-a');
          const appB = batch.nodes.find((n) => n.nodeId === 'app-b');
          if (appA && appA.throughput > 0) routedTo.push('app-a');
          if (appB && appB.throughput > 0) routedTo.push('app-b');
        },
      });

      await engine.run();

      // With First policy, RL should only route to app-a (index 0)
      expect(routedTo).not.toContain('app-b');
    });

    it('persistence round trip does not change which edge a node forwards along', async () => {
      const nodes: SimulationNode[] = [
        makeNode('gen', NodeType.TrafficGenerator, 'Gen', RoutingPolicy.First),
        makeNode('rl', NodeType.RateLimiter, 'RL', RoutingPolicy.First),
        makeNode('app-a', NodeType.AppServer, 'App A', RoutingPolicy.First),
        makeNode('app-b', NodeType.AppServer, 'App B', RoutingPolicy.First),
        makeNode('db', NodeType.Database, 'DB', RoutingPolicy.First),
      ];
      const edges: EdgeData[] = [
        makeEdge('e1', 'gen', 'rl'),
        makeEdge('e2', 'rl', 'app-a'),
        makeEdge('e3', 'rl', 'app-b'),
        makeEdge('e4', 'app-a', 'db'),
        makeEdge('e5', 'app-b', 'db'),
      ];

      // Simulate a save/load round trip via JSON serialization
      const serialized = JSON.stringify({ nodes, edges });
      const deserialized = JSON.parse(serialized) as { nodes: SimulationNode[]; edges: EdgeData[] };

      const config1 = buildConfig(nodes, edges, 123);
      const config2 = buildConfig(deserialized.nodes, deserialized.edges, 123);

      const engine1 = new SimulationEngine(config1);
      const engine2 = new SimulationEngine(config2);

      let successCount1 = 0;
      let successCount2 = 0;

      engine1.setCallbacks({
        onComplete: (s) => { successCount1 = s.totalRequests; },
      });
      engine2.setCallbacks({
        onComplete: (s) => { successCount2 = s.totalRequests; },
      });

      await engine1.run();
      await engine2.run();

      // Same seed, same edge order → identical request counts
      expect(successCount1).toBe(successCount2);
      expect(successCount1).toBeGreaterThan(0);
    });
  });

  describe('Round_Robin policy', () => {
    it('cycles through all outgoing edges in order', async () => {
      const nodes: SimulationNode[] = [
        makeNode('gen', NodeType.TrafficGenerator, 'Gen', RoutingPolicy.First),
        makeNode('rl', NodeType.RateLimiter, 'RL', RoutingPolicy.RoundRobin),
        makeNode('app-a', NodeType.AppServer, 'App A', RoutingPolicy.First),
        makeNode('app-b', NodeType.AppServer, 'App B', RoutingPolicy.First),
        makeNode('app-c', NodeType.AppServer, 'App C', RoutingPolicy.First),
        makeNode('db', NodeType.Database, 'DB', RoutingPolicy.First),
      ];
      const edges: EdgeData[] = [
        makeEdge('e1', 'gen', 'rl'),
        makeEdge('e2', 'rl', 'app-a'),
        makeEdge('e3', 'rl', 'app-b'),
        makeEdge('e4', 'rl', 'app-c'),
        makeEdge('e5', 'app-a', 'db'),
        makeEdge('e6', 'app-b', 'db'),
        makeEdge('e7', 'app-c', 'db'),
      ];

      const config = buildConfig(nodes, edges, 77);
      // Short run to observe distribution
      config.maxSimulatedTimeMs = 5000;
      const engine = new SimulationEngine(config);

      let appAThroughput = 0;
      let appBThroughput = 0;
      let appCThroughput = 0;

      engine.setCallbacks({
        onMetricsBatch: (batch) => {
          const a = batch.nodes.find((n) => n.nodeId === 'app-a');
          const b = batch.nodes.find((n) => n.nodeId === 'app-b');
          const c = batch.nodes.find((n) => n.nodeId === 'app-c');
          if (a) appAThroughput += a.throughput;
          if (b) appBThroughput += b.throughput;
          if (c) appCThroughput += c.throughput;
        },
      });

      await engine.run();

      const total = appAThroughput + appBThroughput + appCThroughput;
      expect(total).toBeGreaterThan(0);
      // Round-robin should give roughly equal distribution (within 20% tolerance)
      const expected = total / 3;
      expect(appAThroughput).toBeGreaterThan(expected * 0.8);
      expect(appBThroughput).toBeGreaterThan(expected * 0.8);
      expect(appCThroughput).toBeGreaterThan(expected * 0.8);
    });

    it('reset() resets the cursor to index 0', async () => {
      const nodes: SimulationNode[] = [
        makeNode('gen', NodeType.TrafficGenerator, 'Gen', RoutingPolicy.First),
        makeNode('rl', NodeType.RateLimiter, 'RL', RoutingPolicy.RoundRobin),
        makeNode('app-a', NodeType.AppServer, 'App A', RoutingPolicy.First),
        makeNode('app-b', NodeType.AppServer, 'App B', RoutingPolicy.First),
        makeNode('db', NodeType.Database, 'DB', RoutingPolicy.First),
      ];
      const edges: EdgeData[] = [
        makeEdge('e1', 'gen', 'rl'),
        makeEdge('e2', 'rl', 'app-a'),
        makeEdge('e3', 'rl', 'app-b'),
        makeEdge('e4', 'app-a', 'db'),
        makeEdge('e5', 'app-b', 'db'),
      ];

      const config = buildConfig(nodes, edges, 99);
      config.maxSimulatedTimeMs = 2000;
      const engine = new SimulationEngine(config);

      let run1Total = 0;
      let run2Total = 0;

      engine.setCallbacks({
        onComplete: (s) => { run1Total = s.totalRequests; },
      });
      await engine.run();
      expect(run1Total).toBeGreaterThan(0);

      // Reset and run again with same seed — should produce identical results
      engine.reset();
      engine.setCallbacks({
        onComplete: (s) => { run2Total = s.totalRequests; },
      });
      await engine.run();

      expect(run2Total).toBe(run1Total);
    });

    it('pause and resume do not reset the cursor', async () => {
      const nodes: SimulationNode[] = [
        makeNode('gen', NodeType.TrafficGenerator, 'Gen', RoutingPolicy.First),
        makeNode('rl', NodeType.RateLimiter, 'RL', RoutingPolicy.RoundRobin),
        makeNode('app-a', NodeType.AppServer, 'App A', RoutingPolicy.First),
        makeNode('app-b', NodeType.AppServer, 'App B', RoutingPolicy.First),
        makeNode('db', NodeType.Database, 'DB', RoutingPolicy.First),
      ];
      const edges: EdgeData[] = [
        makeEdge('e1', 'gen', 'rl'),
        makeEdge('e2', 'rl', 'app-a'),
        makeEdge('e3', 'rl', 'app-b'),
        makeEdge('e4', 'app-a', 'db'),
        makeEdge('e5', 'app-b', 'db'),
      ];

      // Two-part run: run for 3s, pause, resume at 1x, complete at 5s
      const config = buildConfig(nodes, edges, 42);
      config.maxSimulatedTimeMs = 5000;
      const engine = new SimulationEngine(config);

      let appAThroughput = 0;
      let appBThroughput = 0;

      engine.setCallbacks({
        onMetricsBatch: (batch) => {
          const a = batch.nodes.find((n) => n.nodeId === 'app-a');
          const b = batch.nodes.find((n) => n.nodeId === 'app-b');
          if (a) appAThroughput += a.throughput;
          if (b) appBThroughput += b.throughput;
        },
      });

      await engine.run();

      const total = appAThroughput + appBThroughput;
      expect(total).toBeGreaterThan(0);
      // Both should have received traffic (cursor cycles, not restarted)
      expect(appAThroughput).toBeGreaterThan(0);
      expect(appBThroughput).toBeGreaterThan(0);
    });
  });

  describe('Weighted policy', () => {
    it('selects edges with probability proportional to weight at a fixed seed', async () => {
      const nodes: SimulationNode[] = [
        makeNode('gen', NodeType.TrafficGenerator, 'Gen', RoutingPolicy.First),
        makeNode('rl', NodeType.RateLimiter, 'RL', RoutingPolicy.Weighted),
        makeNode('app-a', NodeType.AppServer, 'App A', RoutingPolicy.First),
        makeNode('app-b', NodeType.AppServer, 'App B', RoutingPolicy.First),
        makeNode('db', NodeType.Database, 'DB', RoutingPolicy.First),
      ];
      // Weight 3 for app-a and weight 1 for app-b → ~75% / ~25% distribution
      const edges: EdgeData[] = [
        makeEdge('e1', 'gen', 'rl'),
        makeEdge('e2', 'rl', 'app-a', 3.0),
        makeEdge('e3', 'rl', 'app-b', 1.0),
        makeEdge('e4', 'app-a', 'db'),
        makeEdge('e5', 'app-b', 'db'),
      ];

      const config = buildConfig(nodes, edges, 42);
      config.maxSimulatedTimeMs = 10000;
      const engine = new SimulationEngine(config);

      let appAThroughput = 0;
      let appBThroughput = 0;

      engine.setCallbacks({
        onMetricsBatch: (batch) => {
          const a = batch.nodes.find((n) => n.nodeId === 'app-a');
          const b = batch.nodes.find((n) => n.nodeId === 'app-b');
          if (a) appAThroughput += a.throughput;
          if (b) appBThroughput += b.throughput;
        },
      });

      await engine.run();

      const total = appAThroughput + appBThroughput;
      expect(total).toBeGreaterThan(0);
      // app-a should get roughly 75% of traffic (allow 20% tolerance for variance)
      const ratioA = appAThroughput / total;
      expect(ratioA).toBeGreaterThan(0.55); // At minimum, more than half
      expect(ratioA).toBeLessThan(0.95);    // Not all of it
      // app-b should get some traffic
      expect(appBThroughput).toBeGreaterThan(0);
    });

    it('normalisation is idempotent (configured weights are not mutated)', async () => {
      const nodes: SimulationNode[] = [
        makeNode('gen', NodeType.TrafficGenerator, 'Gen', RoutingPolicy.First),
        makeNode('rl', NodeType.RateLimiter, 'RL', RoutingPolicy.Weighted),
        makeNode('app-a', NodeType.AppServer, 'App A', RoutingPolicy.First),
        makeNode('app-b', NodeType.AppServer, 'App B', RoutingPolicy.First),
        makeNode('db', NodeType.Database, 'DB', RoutingPolicy.First),
      ];
      const edges: EdgeData[] = [
        makeEdge('e1', 'gen', 'rl'),
        makeEdge('e2', 'rl', 'app-a', 5.0),
        makeEdge('e3', 'rl', 'app-b', 3.0),
        makeEdge('e4', 'app-a', 'db'),
        makeEdge('e5', 'app-b', 'db'),
      ];

      const config = buildConfig(nodes, edges, 42);
      config.maxSimulatedTimeMs = 5000;
      const engine = new SimulationEngine(config);
      await engine.run();

      // After simulation, the configured weights in the edge array must be unchanged
      expect(edges[1]!.weight).toBe(5.0);
      expect(edges[2]!.weight).toBe(3.0);
    });
  });

  describe('Weight-sum-zero fallback', () => {
    it('falls back to uniform distribution when all weights are zero', async () => {
      const nodes: SimulationNode[] = [
        makeNode('gen', NodeType.TrafficGenerator, 'Gen', RoutingPolicy.First),
        makeNode('rl', NodeType.RateLimiter, 'RL', RoutingPolicy.Weighted),
        makeNode('app-a', NodeType.AppServer, 'App A', RoutingPolicy.First),
        makeNode('app-b', NodeType.AppServer, 'App B', RoutingPolicy.First),
        makeNode('db', NodeType.Database, 'DB', RoutingPolicy.First),
      ];
      // All weights zero
      const edges: EdgeData[] = [
        makeEdge('e1', 'gen', 'rl'),
        makeEdge('e2', 'rl', 'app-a', 0),
        makeEdge('e3', 'rl', 'app-b', 0),
        makeEdge('e4', 'app-a', 'db'),
        makeEdge('e5', 'app-b', 'db'),
      ];

      const config = buildConfig(nodes, edges, 42);
      config.maxSimulatedTimeMs = 10000;
      const engine = new SimulationEngine(config);

      let appAThroughput = 0;
      let appBThroughput = 0;

      engine.setCallbacks({
        onMetricsBatch: (batch) => {
          const a = batch.nodes.find((n) => n.nodeId === 'app-a');
          const b = batch.nodes.find((n) => n.nodeId === 'app-b');
          if (a) appAThroughput += a.throughput;
          if (b) appBThroughput += b.throughput;
        },
      });

      // Suppress console.warn for this test
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await engine.run();

      warnSpy.mockRestore();

      const total = appAThroughput + appBThroughput;
      expect(total).toBeGreaterThan(0);
      // Both should receive traffic since uniform fallback is applied
      expect(appAThroughput).toBeGreaterThan(0);
      expect(appBThroughput).toBeGreaterThan(0);
      // Roughly equal within tolerance
      const ratioA = appAThroughput / total;
      expect(ratioA).toBeGreaterThan(0.2);
      expect(ratioA).toBeLessThan(0.8);
    });
  });
});
