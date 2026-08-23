import { describe, it, expect } from 'vitest';
import type { SimulationNode } from '@/types/nodes';
import { NodeType } from '@/types/nodes';
import type { EdgeData } from '@/types/edges';
import { EdgeProtocol } from '@/types/edges';
import type { NodeRuntimeState, SimRequest } from '../types';
import { RequestStatus } from '../types';
import { AnalysisAggregatesAccumulator } from './analysisAggregates';
import { MetricsCollector } from './MetricsCollector';
import { RunCumulativeAccumulator } from './RunCumulativeAccumulator';

// ─── Helpers ─────────────────────────────────────────────────────

function makeNode(
  id: string,
  nodeType: NodeType,
  config: Record<string, unknown> = {},
): SimulationNode {
  return {
    id,
    nodeType,
    label: id,
    position: { x: 0, y: 0 },
    config,
  } as SimulationNode;
}

function makeEdge(id: string, source: string, target: string): EdgeData {
  return { id, source, target, protocol: EdgeProtocol.Sync, weight: 1 };
}

function makeRequest(overrides: Partial<SimRequest>): SimRequest {
  return {
    id: 'req-1',
    originNodeId: 'A',
    createdAt: 0,
    status: RequestStatus.Success,
    hopCount: 3,
    maxHops: 10,
    path: ['A', 'B', 'C'],
    accumulatedLatencyMs: 300,
    fanOutDepth: 0,
    emittedByNodeId: 'A',
    ...overrides,
  };
}

function makeNodeState(nodeId: string): NodeRuntimeState {
  return {
    nodeId,
    processor: {
      onRequestArrived: () => {},
      onChaosApplied: () => {},
      onChaosReverted: () => {},
      getUtilization: () => ({ kind: 'value', value: 0.5, idle: false }),
    },
    activeConnections: 0,
    queuedRequests: [],
    bufferedMessages: 0,
    totalProcessed: 0,
    totalDropped: 0,
    totalTimedOut: 0,
    latencySamples: [],
    terminalCounts: {
      SUCCESS: 0,
      TIMEOUT: 0,
      DROPPED: 0,
      LOOP_DETECTED: 0,
      NO_ROUTE: 0,
      UNAUTHENTICATED: 0,
      FORBIDDEN: 0,
      RETRY_EXHAUSTED: 0,
      DEAD_LETTERED: 0,
    },
    cumulativeTerminalCounts: {
      SUCCESS: 0,
      TIMEOUT: 0,
      DROPPED: 0,
      LOOP_DETECTED: 0,
      NO_ROUTE: 0,
      UNAUTHENTICATED: 0,
      FORBIDDEN: 0,
      RETRY_EXHAUSTED: 0,
      DEAD_LETTERED: 0,
    },
  } as unknown as NodeRuntimeState;
}

// ─── Tests ───────────────────────────────────────────────────────

describe('AnalysisAggregatesAccumulator', () => {
  describe('window scoping and reset', () => {
    it('resets all per-window aggregates on resetWindow', () => {
      const nodes = [
        makeNode('A', NodeType.AppServer, {
          requestQueueDepth: 100,
          workerThreadPoolSize: 4,
          processingTimeMeanMs: 50,
          processingTimeStdDevMs: 10,
        }),
        makeNode('B', NodeType.AppServer, {
          requestQueueDepth: 100,
          workerThreadPoolSize: 4,
          processingTimeMeanMs: 50,
          processingTimeStdDevMs: 10,
        }),
      ];
      const edges = [makeEdge('e1', 'A', 'B')];
      const acc = new AnalysisAggregatesAccumulator(nodes, edges);

      const nodeStates = new Map<string, NodeRuntimeState>();
      nodeStates.set('A', makeNodeState('A'));
      nodeStates.set('B', makeNodeState('B'));

      const allRequests = new Map<string, SimRequest>();
      const req = makeRequest({ id: 'req-1', path: ['A', 'B'], accumulatedLatencyMs: 200 });
      allRequests.set('req-1', req);

      acc.recordTermination(req, nodeStates, allRequests);
      acc.recordArrival('A');
      acc.recordDeparture('B');

      // Before reset — aggregates should be non-zero
      const aggA = acc.getAggregates('A');
      expect(aggA.timeInSystemAtNodeMs).toBeGreaterThan(0);
      expect(aggA.arrivalCount).toBe(1);
      const aggB = acc.getAggregates('B');
      expect(aggB.departureCount).toBe(1);
      expect(aggB.terminatedThroughNodeCount).toBe(1);

      // Reset
      acc.resetWindow();

      // After reset — all should be zero
      const aggAAfter = acc.getAggregates('A');
      expect(aggAAfter.timeInSystemAtNodeMs).toBe(0);
      expect(aggAAfter.pathTimeInSystemMs).toBe(0);
      expect(aggAAfter.terminatedThroughNodeCount).toBe(0);
      expect(aggAAfter.arrivalCount).toBe(0);
      expect(aggAAfter.departureCount).toBe(0);

      const aggBAfter = acc.getAggregates('B');
      expect(aggBAfter.timeInSystemAtNodeMs).toBe(0);
      expect(aggBAfter.pathTimeInSystemMs).toBe(0);
      expect(aggBAfter.terminatedThroughNodeCount).toBe(0);
      expect(aggBAfter.arrivalCount).toBe(0);
      expect(aggBAfter.departureCount).toBe(0);
    });

    it('accumulates across multiple terminations within a window', () => {
      const nodes = [
        makeNode('A', NodeType.AppServer, {
          requestQueueDepth: 100,
          workerThreadPoolSize: 4,
          processingTimeMeanMs: 50,
          processingTimeStdDevMs: 10,
        }),
        makeNode('B', NodeType.AppServer, {
          requestQueueDepth: 100,
          workerThreadPoolSize: 4,
          processingTimeMeanMs: 50,
          processingTimeStdDevMs: 10,
        }),
      ];
      const edges = [makeEdge('e1', 'A', 'B')];
      const acc = new AnalysisAggregatesAccumulator(nodes, edges);

      const nodeStates = new Map<string, NodeRuntimeState>();
      nodeStates.set('A', makeNodeState('A'));
      nodeStates.set('B', makeNodeState('B'));

      const allRequests = new Map<string, SimRequest>();
      const req1 = makeRequest({ id: 'req-1', path: ['A', 'B'], accumulatedLatencyMs: 200 });
      const req2 = makeRequest({ id: 'req-2', path: ['A', 'B'], accumulatedLatencyMs: 400 });
      allRequests.set('req-1', req1);
      allRequests.set('req-2', req2);

      acc.recordTermination(req1, nodeStates, allRequests);
      acc.recordTermination(req2, nodeStates, allRequests);

      const aggA = acc.getAggregates('A');
      // Two requests: each contributes (latency / 2) for node A
      // req1: 200/2 = 100, req2: 400/2 = 200 → total = 300
      expect(aggA.timeInSystemAtNodeMs).toBe(300);
      // pathTimeInSystemMs: req1 contributes 200, req2 contributes 400 → total = 600
      expect(aggA.pathTimeInSystemMs).toBe(600);
      expect(aggA.terminatedThroughNodeCount).toBe(2);
    });
  });

  describe('Latency_Share hand-computed (three-node topology)', () => {
    /**
     * Three-node topology: A → B → C
     *
     * Request paths and latencies:
     * - req-1: path [A, B, C], total latency 300ms
     *   → per-hop: 100ms each
     * - req-2: path [A, B], total latency 200ms
     *   → per-hop: 100ms each
     *
     * Latency_Share(B) = timeInSystemAtB / pathTimeInSystemAtB × 100
     *   timeInSystemAtB = 100 (from req-1) + 100 (from req-2) = 200
     *   pathTimeInSystemAtB = 300 (from req-1) + 200 (from req-2) = 500
     *   Latency_Share(B) = 200 / 500 × 100 = 40%
     *
     * Latency_Share(A) = timeInSystemAtA / pathTimeInSystemAtA × 100
     *   timeInSystemAtA = 100 (from req-1) + 100 (from req-2) = 200
     *   pathTimeInSystemAtA = 300 (from req-1) + 200 (from req-2) = 500
     *   Latency_Share(A) = 200 / 500 × 100 = 40%
     *
     * Latency_Share(C) = timeInSystemAtC / pathTimeInSystemAtC × 100
     *   timeInSystemAtC = 100 (from req-1 only)
     *   pathTimeInSystemAtC = 300 (from req-1 only)
     *   Latency_Share(C) = 100 / 300 × 100 ≈ 33.3%
     */
    it('computes correct Latency_Share for each node', () => {
      const nodes = [
        makeNode('A', NodeType.AppServer, {
          requestQueueDepth: 100,
          workerThreadPoolSize: 4,
          processingTimeMeanMs: 50,
          processingTimeStdDevMs: 10,
        }),
        makeNode('B', NodeType.AppServer, {
          requestQueueDepth: 100,
          workerThreadPoolSize: 4,
          processingTimeMeanMs: 50,
          processingTimeStdDevMs: 10,
        }),
        makeNode('C', NodeType.AppServer, {
          requestQueueDepth: 100,
          workerThreadPoolSize: 4,
          processingTimeMeanMs: 50,
          processingTimeStdDevMs: 10,
        }),
      ];
      const edges = [makeEdge('e1', 'A', 'B'), makeEdge('e2', 'B', 'C')];
      const acc = new AnalysisAggregatesAccumulator(nodes, edges);
      const nodeStates = new Map<string, NodeRuntimeState>();
      nodeStates.set('A', makeNodeState('A'));
      nodeStates.set('B', makeNodeState('B'));
      nodeStates.set('C', makeNodeState('C'));
      const allRequests = new Map<string, SimRequest>();

      // req-1: A→B→C with 300ms total latency
      const req1 = makeRequest({
        id: 'req-1',
        path: ['A', 'B', 'C'],
        accumulatedLatencyMs: 300,
      });
      // req-2: A→B with 200ms total latency
      const req2 = makeRequest({
        id: 'req-2',
        path: ['A', 'B'],
        accumulatedLatencyMs: 200,
      });
      allRequests.set('req-1', req1);
      allRequests.set('req-2', req2);

      acc.recordTermination(req1, nodeStates, allRequests);
      acc.recordTermination(req2, nodeStates, allRequests);

      const aggA = acc.getAggregates('A');
      const aggB = acc.getAggregates('B');
      const aggC = acc.getAggregates('C');

      // Latency_Share(A) = 200 / 500 × 100 = 40%
      const latencyShareA = (aggA.timeInSystemAtNodeMs / aggA.pathTimeInSystemMs) * 100;
      expect(latencyShareA).toBeCloseTo(40, 1);

      // Latency_Share(B) = 200 / 500 × 100 = 40%
      const latencyShareB = (aggB.timeInSystemAtNodeMs / aggB.pathTimeInSystemMs) * 100;
      expect(latencyShareB).toBeCloseTo(40, 1);

      // Latency_Share(C) = 100 / 300 × 100 ≈ 33.33%
      const latencyShareC = (aggC.timeInSystemAtNodeMs / aggC.pathTimeInSystemMs) * 100;
      expect(latencyShareC).toBeCloseTo(33.33, 1);
    });
  });

  describe('Blast_Radius hand-computed (three-node topology)', () => {
    /**
     * Three-node topology: A → B → C
     *
     * System has 3 terminations total in this window.
     *
     * - req-1: path [A, B, C] → nodes touched: {A, B, C}
     * - req-2: path [A, B]    → nodes touched: {A, B}
     * - req-3: path [A, C]    → nodes touched: {A, C}
     *
     * terminatedThroughNodeCount:
     *   A: 3 (all requests go through A)
     *   B: 2 (req-1, req-2)
     *   C: 2 (req-1, req-3)
     *
     * Blast_Radius(node) = terminatedThroughNodeCount / systemTerminatedCount × 100
     *   Blast_Radius(A) = 3/3 × 100 = 100%
     *   Blast_Radius(B) = 2/3 × 100 ≈ 66.7%
     *   Blast_Radius(C) = 2/3 × 100 ≈ 66.7%
     */
    it('computes correct Blast_Radius for each node', () => {
      const nodes = [
        makeNode('A', NodeType.AppServer, {
          requestQueueDepth: 100,
          workerThreadPoolSize: 4,
          processingTimeMeanMs: 50,
          processingTimeStdDevMs: 10,
        }),
        makeNode('B', NodeType.AppServer, {
          requestQueueDepth: 100,
          workerThreadPoolSize: 4,
          processingTimeMeanMs: 50,
          processingTimeStdDevMs: 10,
        }),
        makeNode('C', NodeType.AppServer, {
          requestQueueDepth: 100,
          workerThreadPoolSize: 4,
          processingTimeMeanMs: 50,
          processingTimeStdDevMs: 10,
        }),
      ];
      const edges = [makeEdge('e1', 'A', 'B'), makeEdge('e2', 'A', 'C')];
      const acc = new AnalysisAggregatesAccumulator(nodes, edges);
      const nodeStates = new Map<string, NodeRuntimeState>();
      nodeStates.set('A', makeNodeState('A'));
      nodeStates.set('B', makeNodeState('B'));
      nodeStates.set('C', makeNodeState('C'));
      const allRequests = new Map<string, SimRequest>();

      const req1 = makeRequest({ id: 'req-1', path: ['A', 'B', 'C'], accumulatedLatencyMs: 300 });
      const req2 = makeRequest({ id: 'req-2', path: ['A', 'B'], accumulatedLatencyMs: 200 });
      const req3 = makeRequest({ id: 'req-3', path: ['A', 'C'], accumulatedLatencyMs: 150 });
      allRequests.set('req-1', req1);
      allRequests.set('req-2', req2);
      allRequests.set('req-3', req3);

      acc.recordTermination(req1, nodeStates, allRequests);
      acc.recordTermination(req2, nodeStates, allRequests);
      acc.recordTermination(req3, nodeStates, allRequests);

      const systemTerminatedCount = 3;

      const aggA = acc.getAggregates('A');
      const aggB = acc.getAggregates('B');
      const aggC = acc.getAggregates('C');

      // Blast_Radius(A) = 3/3 × 100 = 100%
      const blastRadiusA = (aggA.terminatedThroughNodeCount / systemTerminatedCount) * 100;
      expect(blastRadiusA).toBeCloseTo(100, 1);

      // Blast_Radius(B) = 2/3 × 100 ≈ 66.67%
      const blastRadiusB = (aggB.terminatedThroughNodeCount / systemTerminatedCount) * 100;
      expect(blastRadiusB).toBeCloseTo(66.67, 1);

      // Blast_Radius(C) = 2/3 × 100 ≈ 66.67%
      const blastRadiusC = (aggC.terminatedThroughNodeCount / systemTerminatedCount) * 100;
      expect(blastRadiusC).toBeCloseTo(66.67, 1);
    });

    it('folds branch paths into terminatedThroughNodeCount', () => {
      const nodes = [
        makeNode('A', NodeType.AppServer, {
          requestQueueDepth: 100,
          workerThreadPoolSize: 4,
          processingTimeMeanMs: 50,
          processingTimeStdDevMs: 10,
        }),
        makeNode('B', NodeType.AppServer, {
          requestQueueDepth: 100,
          workerThreadPoolSize: 4,
          processingTimeMeanMs: 50,
          processingTimeStdDevMs: 10,
        }),
        makeNode('C', NodeType.AppServer, {
          requestQueueDepth: 100,
          workerThreadPoolSize: 4,
          processingTimeMeanMs: 50,
          processingTimeStdDevMs: 10,
        }),
      ];
      const edges = [makeEdge('e1', 'A', 'B'), makeEdge('e2', 'B', 'C')];
      const acc = new AnalysisAggregatesAccumulator(nodes, edges);
      const nodeStates = new Map<string, NodeRuntimeState>();
      nodeStates.set('A', makeNodeState('A'));
      nodeStates.set('B', makeNodeState('B'));
      nodeStates.set('C', makeNodeState('C'));

      // Parent request at A with a branch that goes through C
      const branch = makeRequest({
        id: 'branch-1',
        path: ['B', 'C'],
        accumulatedLatencyMs: 100,
        parentRequestId: 'req-parent',
      });
      const parent = makeRequest({
        id: 'req-parent',
        path: ['A', 'B'],
        accumulatedLatencyMs: 250,
        pendingBranchIds: new Set(['branch-1']),
      });

      const allRequests = new Map<string, SimRequest>();
      allRequests.set('req-parent', parent);
      allRequests.set('branch-1', branch);

      acc.recordTermination(parent, nodeStates, allRequests);

      const aggA = acc.getAggregates('A');
      const aggB = acc.getAggregates('B');
      const aggC = acc.getAggregates('C');

      // Parent path is [A, B], branch path is [B, C]
      // touchedNodes = {A, B, C}
      expect(aggA.terminatedThroughNodeCount).toBe(1);
      expect(aggB.terminatedThroughNodeCount).toBe(1);
      expect(aggC.terminatedThroughNodeCount).toBe(1); // folded from branch path
    });
  });

  describe('monitoredDepth and monitoredDepthBound', () => {
    it('returns prefetchBufferDepth + upstream MQ capacity for WorkerPool', () => {
      const nodes = [
        makeNode('mq', NodeType.MessageQueue, {
          bufferCapacity: 500,
          consumerBatchSize: 10,
          backpressureThresholdPct: 80,
          backpressureStrategy: 'DROP_OLDEST',
        }),
        makeNode('wp', NodeType.WorkerPool, {
          concurrency: 4,
          prefetchBufferDepth: 50,
          jobProcessingMeanMs: 100,
          jobProcessingStdDevMs: 20,
          jobFailureRate: 0,
          maxRetries: 3,
          retryBackoff: 'EXPONENTIAL',
          retryBaseDelayMs: 100,
          jobTimeoutMs: 5000,
        }),
      ];
      const edges = [makeEdge('e1', 'mq', 'wp')];
      const acc = new AnalysisAggregatesAccumulator(nodes, edges);

      // monitoredDepthBound for WorkerPool = prefetchBufferDepth + Σ upstream MQ capacities
      // = 50 + 500 = 550
      expect(acc.getMonitoredDepthBound('wp')).toBe(550);
    });

    it('returns bufferCapacity for MessageQueue', () => {
      const nodes = [
        makeNode('mq', NodeType.MessageQueue, {
          bufferCapacity: 1000,
          consumerBatchSize: 10,
          backpressureThresholdPct: 80,
          backpressureStrategy: 'DROP_OLDEST',
        }),
      ];
      const acc = new AnalysisAggregatesAccumulator(nodes, []);

      expect(acc.getMonitoredDepthBound('mq')).toBe(1000);
    });

    it('returns requestQueueDepth for AppServer', () => {
      const nodes = [
        makeNode('as', NodeType.AppServer, {
          requestQueueDepth: 200,
          workerThreadPoolSize: 8,
          processingTimeMeanMs: 50,
          processingTimeStdDevMs: 10,
        }),
      ];
      const acc = new AnalysisAggregatesAccumulator(nodes, []);

      expect(acc.getMonitoredDepthBound('as')).toBe(200);
    });

    it('returns null for TrafficGenerator', () => {
      const nodes = [
        makeNode('tg', NodeType.TrafficGenerator, {
          rps: 100,
          distribution: 'POISSON',
          spikeMultiplier: 1,
          spikeDurationSec: 0,
        }),
      ];
      const acc = new AnalysisAggregatesAccumulator(nodes, []);

      expect(acc.getMonitoredDepthBound('tg')).toBeNull();
    });
  });

  describe('arrivalCount and departureCount', () => {
    it('counts arrivals and departures independently per node', () => {
      const nodes = [
        makeNode('A', NodeType.AppServer, {
          requestQueueDepth: 100,
          workerThreadPoolSize: 4,
          processingTimeMeanMs: 50,
          processingTimeStdDevMs: 10,
        }),
        makeNode('B', NodeType.AppServer, {
          requestQueueDepth: 100,
          workerThreadPoolSize: 4,
          processingTimeMeanMs: 50,
          processingTimeStdDevMs: 10,
        }),
      ];
      const acc = new AnalysisAggregatesAccumulator(nodes, [makeEdge('e1', 'A', 'B')]);

      acc.recordArrival('A');
      acc.recordArrival('A');
      acc.recordArrival('B');
      acc.recordDeparture('A');
      acc.recordDeparture('B');
      acc.recordDeparture('B');

      expect(acc.getAggregates('A').arrivalCount).toBe(2);
      expect(acc.getAggregates('A').departureCount).toBe(1);
      expect(acc.getAggregates('B').arrivalCount).toBe(1);
      expect(acc.getAggregates('B').departureCount).toBe(2);
    });
  });

  describe('durationMs in MetricsCollector batch', () => {
    it('reports actual window duration in each snapshot', () => {
      const nodes = [
        makeNode('A', NodeType.AppServer, {
          requestQueueDepth: 100,
          workerThreadPoolSize: 4,
          processingTimeMeanMs: 50,
          processingTimeStdDevMs: 10,
        }),
      ];
      const edges: EdgeData[] = [];
      const collector = new MetricsCollector(nodes, 5000, edges);

      const nodeStates = new Map<string, NodeRuntimeState>();
      nodeStates.set('A', makeNodeState('A'));

      // First batch at time 3000 (partial window)
      const batch1 = collector.generateBatch(3000, nodeStates, 0);
      expect(batch1.nodes[0]!.durationMs).toBe(3000);

      // Second batch at time 8000 (5000ms window)
      const batch2 = collector.generateBatch(8000, nodeStates, 0);
      expect(batch2.nodes[0]!.durationMs).toBe(5000);

      // Zero-length window (same time as last batch)
      const batch3 = collector.generateBatch(8000, nodeStates, 0);
      // durationMs <= 0 marks the window as unavailable
      expect(batch3.nodes[0]!.durationMs).toBe(0);
    });
  });
});

describe('RunCumulativeAccumulator', () => {
  it('tracks whole-run statistics correctly', () => {
    const acc = new RunCumulativeAccumulator();
    acc.setStartTime(0);

    const req1 = makeRequest({ id: 'req-1', accumulatedLatencyMs: 100 });
    const req2 = makeRequest({ id: 'req-2', accumulatedLatencyMs: 200 });
    const req3 = makeRequest({
      id: 'req-3',
      accumulatedLatencyMs: 300,
      status: RequestStatus.Timeout,
    });

    acc.recordTermination(req1, RequestStatus.Success, 1000);
    acc.recordTermination(req2, RequestStatus.Success, 2000);
    acc.recordTermination(req3, RequestStatus.Timeout, 3000);

    expect(acc.getTotalTerminations()).toBe(3);
    expect(acc.getSuccessCount()).toBe(2);
    expect(acc.getErrorRate()).toBeCloseTo(1 / 3, 4);
    expect(acc.getThroughput(3000)).toBeCloseTo(2 / 3, 4);
    expect(acc.getDurationMs()).toBe(3000);
  });

  it('resets completely', () => {
    const acc = new RunCumulativeAccumulator();
    acc.setStartTime(0);
    const req = makeRequest({ id: 'req-1', accumulatedLatencyMs: 100 });
    acc.recordTermination(req, RequestStatus.Success, 1000);

    acc.reset();

    expect(acc.getTotalTerminations()).toBe(0);
    expect(acc.getSuccessCount()).toBe(0);
    expect(acc.getErrorRate()).toBe(0);
    expect(acc.getDurationMs()).toBe(0);
  });
});
