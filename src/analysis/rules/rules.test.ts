import { describe, it, expect } from 'vitest';
import type { AnalysisContext, NodeMetricsWindow } from '@/analysis/AnalysisWindowStore';
import type { NodeMetricsSnapshot } from '@/types/metrics';
import type { SimulationNode } from '@/types/nodes';
import { NodeType, RoutingPolicy } from '@/types/nodes';
import {
  analysisUtilization,
  latencyShare,
  rankNodes,
  bottleneckRankRule,
  bottleneckCoLimitingRule,
  bottleneckNoConstraintRule,
  bottleneckNoneEligibleRule,
} from './bottleneck';
import { saturationRule } from './saturation';
import { instabilityDepthGrowthRule, instabilityLittlesLawRule } from './instability';
import { dlqGrowthRule, admissionDominatesRule } from './reliability';
import { workerPoolConcurrencyRule } from './capacity';
import { schedulerCollisionRule } from './configuration';
import { headroomRule } from './headroom';
import { RULE_REGISTRY } from './index';

// ─── Test Helpers ────────────────────────────────────────────────

function makeNodeSnapshot(overrides: Partial<NodeMetricsSnapshot> & { nodeId: string }): NodeMetricsSnapshot {
  return {
    nodeId: overrides.nodeId,
    timestamp: 0,
    throughput: overrides.throughput ?? 100,
    errorRate: 0,
    latencyPercentiles: { p50: 10, p90: 50, p99: 100 },
    queueDepth: overrides.queueDepth ?? 0,
    activeConnections: 0,
    bufferOccupancy: 0,
    utilization: overrides.utilization ?? { kind: 'value', value: 0.5, idle: false },
    littlesLaw: overrides.littlesLaw ?? { nodeId: overrides.nodeId, L: 5, lambda: 10, W: 0.5, deviation: 0.01, isStable: true },
    healthStatus: 'green',
    terminalCounts: overrides.terminalCounts ?? {},
    cumulativeTerminalCounts: overrides.cumulativeTerminalCounts ?? { Success: 200 },
    timeInSystemAtNodeMs: overrides.timeInSystemAtNodeMs ?? 100,
    pathTimeInSystemMs: overrides.pathTimeInSystemMs ?? 400,
    terminatedThroughNodeCount: overrides.terminatedThroughNodeCount ?? 50,
    monitoredDepth: overrides.monitoredDepth ?? null,
    monitoredDepthBound: overrides.monitoredDepthBound ?? null,
    arrivalCount: overrides.arrivalCount ?? 50,
    departureCount: overrides.departureCount ?? 50,
    durationMs: overrides.durationMs ?? 500,
    ...(overrides.retainedByUpstreamNode !== undefined ? { retainedByUpstreamNode: overrides.retainedByUpstreamNode } : {}),
  };
}

function makeWindow(nodes: NodeMetricsSnapshot[], durationMs = 500, startMs = 0): NodeMetricsWindow {
  return {
    startMs,
    endMs: startMs + durationMs,
    durationMs,
    nodes,
    systemWide: {
      totalThroughput: nodes.reduce((s, n) => s + n.throughput, 0),
      endToEndLatency: { p50: 10, p90: 50, p99: 100 },
      totalErrorRate: 0,
      activeRequests: 10,
      failureClassRates: { admission: 0, capacityReliability: 0, topologyConfiguration: 0 },
    },
  };
}

function makeAppServerNode(id: string, label?: string): SimulationNode {
  return {
    id,
    nodeType: NodeType.AppServer,
    label: label ?? id,
    position: { x: 0, y: 0 },
    routingPolicy: RoutingPolicy.First,
    config: {
      workerThreadPoolSize: 10,
      requestQueueDepth: 100,
      processingTimeMeanMs: 50,
      processingTimeStdDevMs: 10,
    },
  };
}

function makeContext(
  windows: NodeMetricsWindow[],
  nodes?: SimulationNode[],
  overrides?: Partial<AnalysisContext>,
): AnalysisContext {
  const nodeIds = new Set<string>();
  for (const w of windows) for (const n of w.nodes) nodeIds.add(n.nodeId);

  const topoNodes = nodes ?? [...nodeIds].map((id) => makeAppServerNode(id));

  const nodeCompletedCounts = new Map<string, number>();
  for (const w of windows) {
    for (const n of w.nodes) {
      const total = Object.values(n.cumulativeTerminalCounts).reduce((s, v) => s + v, 0);
      nodeCompletedCounts.set(n.nodeId, total);
    }
  }

  const steadyStateMap = new Map<string, { nodeId: string; isSteady: boolean; consecutiveStableWindows: number }>();
  for (const id of nodeIds) {
    steadyStateMap.set(id, { nodeId: id, isSteady: true, consecutiveStableWindows: 3 });
  }

  return {
    windows,
    cumulative: {
      totalSimulatedMs: windows[windows.length - 1]?.endMs ?? 0,
      totalThroughput: windows.reduce((s, w) => s + w.systemWide.totalThroughput, 0),
      completedWindowCount: windows.filter((w) => w.durationMs > 0).length,
      nodeCompletedCounts,
      systemCompletedCount: [...nodeCompletedCounts.values()].reduce((s, v) => s + v, 0),
    },
    topology: { nodes: topoNodes, edges: [] },
    labelOf: (id: string) => topoNodes.find((n) => n.id === id)?.label ?? id.slice(0, 8),
    eventLog: [],
    steadyStateMap,
    ...overrides,
  };
}

/** Run a generator rule to completion. */
function runRule(rule: { evaluate: (ctx: AnalysisContext) => Generator<void, unknown[], void> }, ctx: AnalysisContext): unknown[] {
  const gen = rule.evaluate(ctx);
  let result = gen.next();
  while (!result.done) {
    result = gen.next();
  }
  return result.value;
}

// ─── analysisUtilization Tests (Task 465) ────────────────────────

describe('analysisUtilization', () => {
  it('computes the mean over the 3 most recent completed windows', () => {
    const windows: NodeMetricsWindow[] = [
      makeWindow([makeNodeSnapshot({ nodeId: 'n1', utilization: { kind: 'value', value: 0.6, idle: false } })], 500, 0),
      makeWindow([makeNodeSnapshot({ nodeId: 'n1', utilization: { kind: 'value', value: 0.7, idle: false } })], 500, 500),
      makeWindow([makeNodeSnapshot({ nodeId: 'n1', utilization: { kind: 'value', value: 0.8, idle: false } })], 500, 1000),
    ];
    const result = analysisUtilization('n1', windows);
    expect(result).toBeCloseTo(0.7, 6);
  });

  it('returns null for fewer than 3 completed windows', () => {
    const windows: NodeMetricsWindow[] = [
      makeWindow([makeNodeSnapshot({ nodeId: 'n1', utilization: { kind: 'value', value: 0.6, idle: false } })], 500, 0),
      makeWindow([makeNodeSnapshot({ nodeId: 'n1', utilization: { kind: 'value', value: 0.7, idle: false } })], 500, 500),
    ];
    expect(analysisUtilization('n1', windows)).toBeNull();
  });

  it('returns null when utilization is not-applicable', () => {
    const windows: NodeMetricsWindow[] = [
      makeWindow([makeNodeSnapshot({ nodeId: 'n1', utilization: { kind: 'not-applicable', reason: 'no resource' } })], 500, 0),
      makeWindow([makeNodeSnapshot({ nodeId: 'n1', utilization: { kind: 'value', value: 0.7, idle: false } })], 500, 500),
      makeWindow([makeNodeSnapshot({ nodeId: 'n1', utilization: { kind: 'value', value: 0.8, idle: false } })], 500, 1000),
    ];
    expect(analysisUtilization('n1', windows)).toBeNull();
  });

  it('excludes zero-duration windows', () => {
    const windows: NodeMetricsWindow[] = [
      makeWindow([makeNodeSnapshot({ nodeId: 'n1', utilization: { kind: 'value', value: 0.6, idle: false } })], 500, 0),
      makeWindow([makeNodeSnapshot({ nodeId: 'n1', utilization: { kind: 'value', value: 0.7, idle: false } })], 500, 500),
      makeWindow([makeNodeSnapshot({ nodeId: 'n1', utilization: { kind: 'value', value: 0.99, idle: false } })], 0, 1000), // zero-duration
      makeWindow([makeNodeSnapshot({ nodeId: 'n1', utilization: { kind: 'value', value: 0.8, idle: false } })], 500, 1000),
    ];
    // Should use the 3 completed (non-zero-duration) windows: 0.6, 0.7, 0.8
    expect(analysisUtilization('n1', windows)).toBeCloseTo(0.7, 6);
  });
});

// ─── latencyShare Tests (Task 465) ───────────────────────────────

describe('latencyShare', () => {
  it('computes timeInSystemAtNodeMs / pathTimeInSystemMs × 100', () => {
    const windows = [
      makeWindow([makeNodeSnapshot({ nodeId: 'n1', timeInSystemAtNodeMs: 100, pathTimeInSystemMs: 400 })], 500, 0),
      makeWindow([makeNodeSnapshot({ nodeId: 'n1', timeInSystemAtNodeMs: 100, pathTimeInSystemMs: 400 })], 500, 500),
      makeWindow([makeNodeSnapshot({ nodeId: 'n1', timeInSystemAtNodeMs: 100, pathTimeInSystemMs: 400 })], 500, 1000),
    ];
    expect(latencyShare('n1', windows)).toBeCloseTo(25, 6);
  });

  it('returns null when pathTimeInSystemMs is 0', () => {
    const windows = [
      makeWindow([makeNodeSnapshot({ nodeId: 'n1', timeInSystemAtNodeMs: 0, pathTimeInSystemMs: 0 })], 500, 0),
      makeWindow([makeNodeSnapshot({ nodeId: 'n1', timeInSystemAtNodeMs: 0, pathTimeInSystemMs: 0 })], 500, 500),
      makeWindow([makeNodeSnapshot({ nodeId: 'n1', timeInSystemAtNodeMs: 0, pathTimeInSystemMs: 0 })], 500, 1000),
    ];
    expect(latencyShare('n1', windows)).toBeNull();
  });
});

// ─── Ranking Tests (Task 466) ────────────────────────────────────

describe('rankNodes', () => {
  it('ranks by descending utilization', () => {
    const windows = [
      makeWindow([
        makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.5, idle: false } }),
        makeNodeSnapshot({ nodeId: 'b', utilization: { kind: 'value', value: 0.9, idle: false } }),
      ], 500, 0),
      makeWindow([
        makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.5, idle: false } }),
        makeNodeSnapshot({ nodeId: 'b', utilization: { kind: 'value', value: 0.9, idle: false } }),
      ], 500, 500),
      makeWindow([
        makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.5, idle: false } }),
        makeNodeSnapshot({ nodeId: 'b', utilization: { kind: 'value', value: 0.9, idle: false } }),
      ], 500, 1000),
    ];
    const ctx = makeContext(windows);
    const ranked = rankNodes(ctx);
    expect(ranked[0]!.nodeId).toBe('b');
    expect(ranked[1]!.nodeId).toBe('a');
  });

  it('tie-breaks within 0.001 by descending latencyShare', () => {
    const windows = [
      makeWindow([
        makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.8005, idle: false }, timeInSystemAtNodeMs: 200, pathTimeInSystemMs: 400 }),
        makeNodeSnapshot({ nodeId: 'b', utilization: { kind: 'value', value: 0.8000, idle: false }, timeInSystemAtNodeMs: 300, pathTimeInSystemMs: 400 }),
      ], 500, 0),
      makeWindow([
        makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.8005, idle: false }, timeInSystemAtNodeMs: 200, pathTimeInSystemMs: 400 }),
        makeNodeSnapshot({ nodeId: 'b', utilization: { kind: 'value', value: 0.8000, idle: false }, timeInSystemAtNodeMs: 300, pathTimeInSystemMs: 400 }),
      ], 500, 500),
      makeWindow([
        makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.8005, idle: false }, timeInSystemAtNodeMs: 200, pathTimeInSystemMs: 400 }),
        makeNodeSnapshot({ nodeId: 'b', utilization: { kind: 'value', value: 0.8000, idle: false }, timeInSystemAtNodeMs: 300, pathTimeInSystemMs: 400 }),
      ], 500, 1000),
    ];
    const ctx = makeContext(windows);
    const ranked = rankNodes(ctx);
    // Within 0.001 tolerance (0.8005 - 0.8000 = 0.0005 < 0.001), tie-break by latencyShare
    // b has higher latencyShare (300/400 = 75%) vs a (200/400 = 50%)
    expect(ranked[0]!.nodeId).toBe('b');
  });

  it('tie-breaks by ascending node ID as final fallback', () => {
    const windows = [
      makeWindow([
        makeNodeSnapshot({ nodeId: 'z', utilization: { kind: 'value', value: 0.5, idle: false }, timeInSystemAtNodeMs: 100, pathTimeInSystemMs: 400, throughput: 100 }),
        makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.5, idle: false }, timeInSystemAtNodeMs: 100, pathTimeInSystemMs: 400, throughput: 100 }),
      ], 500, 0),
      makeWindow([
        makeNodeSnapshot({ nodeId: 'z', utilization: { kind: 'value', value: 0.5, idle: false }, timeInSystemAtNodeMs: 100, pathTimeInSystemMs: 400, throughput: 100 }),
        makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.5, idle: false }, timeInSystemAtNodeMs: 100, pathTimeInSystemMs: 400, throughput: 100 }),
      ], 500, 500),
      makeWindow([
        makeNodeSnapshot({ nodeId: 'z', utilization: { kind: 'value', value: 0.5, idle: false }, timeInSystemAtNodeMs: 100, pathTimeInSystemMs: 400, throughput: 100 }),
        makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.5, idle: false }, timeInSystemAtNodeMs: 100, pathTimeInSystemMs: 400, throughput: 100 }),
      ], 500, 1000),
    ];
    const ctx = makeContext(windows);
    const ranked = rankNodes(ctx);
    expect(ranked[0]!.nodeId).toBe('a');
    expect(ranked[1]!.nodeId).toBe('z');
  });
});

// ─── Bottleneck Rule Tests (Tasks 467-470) ───────────────────────

describe('bottleneckRankRule', () => {
  it('designates exactly one node — the highest utilization at or above 0.85', () => {
    const windows = [
      makeWindow([
        makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.90, idle: false } }),
        makeNodeSnapshot({ nodeId: 'b', utilization: { kind: 'value', value: 0.70, idle: false } }),
      ], 500, 0),
      makeWindow([
        makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.90, idle: false } }),
        makeNodeSnapshot({ nodeId: 'b', utilization: { kind: 'value', value: 0.70, idle: false } }),
      ], 500, 500),
      makeWindow([
        makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.90, idle: false } }),
        makeNodeSnapshot({ nodeId: 'b', utilization: { kind: 'value', value: 0.70, idle: false } }),
      ], 500, 1000),
    ];
    const ctx = makeContext(windows);
    const findings = runRule(bottleneckRankRule, ctx);
    expect(findings.length).toBe(1);
    expect((findings[0] as { subjectNodeIds: string[] }).subjectNodeIds).toEqual(['a']);
  });

  it('falls back to greatest latencyShare when no node ≥0.85', () => {
    const windows = [
      makeWindow([
        makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.60, idle: false }, timeInSystemAtNodeMs: 100, pathTimeInSystemMs: 400 }),
        makeNodeSnapshot({ nodeId: 'b', utilization: { kind: 'value', value: 0.50, idle: false }, timeInSystemAtNodeMs: 300, pathTimeInSystemMs: 400 }),
      ], 500, 0),
      makeWindow([
        makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.60, idle: false }, timeInSystemAtNodeMs: 100, pathTimeInSystemMs: 400 }),
        makeNodeSnapshot({ nodeId: 'b', utilization: { kind: 'value', value: 0.50, idle: false }, timeInSystemAtNodeMs: 300, pathTimeInSystemMs: 400 }),
      ], 500, 500),
      makeWindow([
        makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.60, idle: false }, timeInSystemAtNodeMs: 100, pathTimeInSystemMs: 400 }),
        makeNodeSnapshot({ nodeId: 'b', utilization: { kind: 'value', value: 0.50, idle: false }, timeInSystemAtNodeMs: 300, pathTimeInSystemMs: 400 }),
      ], 500, 1000),
    ];
    const ctx = makeContext(windows);
    const findings = runRule(bottleneckRankRule, ctx);
    expect(findings.length).toBe(1);
    // b has higher latencyShare (75% vs 25%)
    expect((findings[0] as { subjectNodeIds: string[] }).subjectNodeIds).toEqual(['b']);
  });

  it('sets confidence Low when fewer than 30 completions (Task 468)', () => {
    const windows = [
      makeWindow([makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.90, idle: false }, cumulativeTerminalCounts: { Success: 10 } })], 500, 0),
      makeWindow([makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.90, idle: false }, cumulativeTerminalCounts: { Success: 10 } })], 500, 500),
      makeWindow([makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.90, idle: false }, cumulativeTerminalCounts: { Success: 10 } })], 500, 1000),
    ];
    const ctx = makeContext(windows);
    const findings = runRule(bottleneckRankRule, ctx);
    expect((findings[0] as { confidence: string }).confidence).toBe('Low');
  });
});

describe('bottleneckCoLimitingRule', () => {
  it('identifies nodes within 0.05 of a saturated bottleneck', () => {
    const windows = [
      makeWindow([
        makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.90, idle: false } }),
        makeNodeSnapshot({ nodeId: 'b', utilization: { kind: 'value', value: 0.87, idle: false } }),
        makeNodeSnapshot({ nodeId: 'c', utilization: { kind: 'value', value: 0.50, idle: false } }),
      ], 500, 0),
      makeWindow([
        makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.90, idle: false } }),
        makeNodeSnapshot({ nodeId: 'b', utilization: { kind: 'value', value: 0.87, idle: false } }),
        makeNodeSnapshot({ nodeId: 'c', utilization: { kind: 'value', value: 0.50, idle: false } }),
      ], 500, 500),
      makeWindow([
        makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.90, idle: false } }),
        makeNodeSnapshot({ nodeId: 'b', utilization: { kind: 'value', value: 0.87, idle: false } }),
        makeNodeSnapshot({ nodeId: 'c', utilization: { kind: 'value', value: 0.50, idle: false } }),
      ], 500, 1000),
    ];
    const ctx = makeContext(windows);
    const findings = runRule(bottleneckCoLimitingRule, ctx);
    expect(findings.length).toBe(1);
    expect((findings[0] as { subjectNodeIds: string[] }).subjectNodeIds).toEqual(['b']);
  });
});

describe('bottleneckNoConstraintRule', () => {
  it('emits Info when all nodes below 0.60 with no instability', () => {
    const windows = [
      makeWindow([
        makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.30, idle: false } }),
        makeNodeSnapshot({ nodeId: 'b', utilization: { kind: 'value', value: 0.40, idle: false } }),
      ], 500, 0),
      makeWindow([
        makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.30, idle: false } }),
        makeNodeSnapshot({ nodeId: 'b', utilization: { kind: 'value', value: 0.40, idle: false } }),
      ], 500, 500),
      makeWindow([
        makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.30, idle: false } }),
        makeNodeSnapshot({ nodeId: 'b', utilization: { kind: 'value', value: 0.40, idle: false } }),
      ], 500, 1000),
    ];
    const ctx = makeContext(windows);
    const findings = runRule(bottleneckNoConstraintRule, ctx);
    expect(findings.length).toBe(1);
    expect((findings[0] as { severity: string }).severity).toBe('Info');
  });
});

describe('bottleneckNoneEligibleRule', () => {
  it('emits Info naming counts of excluded nodes', () => {
    const windows = [
      makeWindow([
        makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'not-applicable', reason: 'no bound' }, arrivalCount: 10 }),
        makeNodeSnapshot({ nodeId: 'b', utilization: { kind: 'value', value: 0.5, idle: false }, arrivalCount: 0 }),
      ], 500, 0),
      makeWindow([
        makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'not-applicable', reason: 'no bound' }, arrivalCount: 10 }),
        makeNodeSnapshot({ nodeId: 'b', utilization: { kind: 'value', value: 0.5, idle: false }, arrivalCount: 0 }),
      ], 500, 500),
      makeWindow([
        makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'not-applicable', reason: 'no bound' }, arrivalCount: 10 }),
        makeNodeSnapshot({ nodeId: 'b', utilization: { kind: 'value', value: 0.5, idle: false }, arrivalCount: 0 }),
      ], 500, 1000),
    ];
    const ctx = makeContext(windows);
    const findings = runRule(bottleneckNoneEligibleRule, ctx);
    expect(findings.length).toBe(1);
    const f = findings[0] as { severity: string; evidence: { metricName: string; value: number }[] };
    expect(f.severity).toBe('Info');
    const naEvidence = f.evidence.find((e) => e.metricName === 'excludedNotApplicable');
    const zeroEvidence = f.evidence.find((e) => e.metricName === 'excludedZeroArrivals');
    expect(naEvidence!.value).toBe(1);
    expect(zeroEvidence!.value).toBe(1);
  });
});

// ─── Saturation Rule Tests (Task 471, 476) ───────────────────────

describe('saturationRule', () => {
  it('fires when a node is ≥0.85 in each of 3 most recent windows', () => {
    const windows = [
      makeWindow([makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.90, idle: false } })], 500, 0),
      makeWindow([makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.88, idle: false } })], 500, 500),
      makeWindow([makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.92, idle: false } })], 500, 1000),
    ];
    const ctx = makeContext(windows);
    const findings = runRule(saturationRule, ctx);
    expect(findings.length).toBe(1);
    expect((findings[0] as { severity: string }).severity).toBe('Critical');
  });

  it('reports the maximal run length in evidence', () => {
    // 5 windows all ≥0.85 — the run length should be 5
    const windows = Array.from({ length: 5 }, (_, i) =>
      makeWindow([makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.90, idle: false } })], 500, i * 500),
    );
    const ctx = makeContext(windows);
    const findings = runRule(saturationRule, ctx);
    expect(findings.length).toBe(1);
    const f = findings[0] as { evidence: { metricName: string; value: number }[] };
    const runLenEvidence = f.evidence.find((e) => e.metricName === 'runLength');
    expect(runLenEvidence!.value).toBe(5);
  });

  it('does not fire when one of the 3 recent windows is below 0.85', () => {
    const windows = [
      makeWindow([makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.90, idle: false } })], 500, 0),
      makeWindow([makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.80, idle: false } })], 500, 500), // below
      makeWindow([makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.90, idle: false } })], 500, 1000),
    ];
    const ctx = makeContext(windows);
    const findings = runRule(saturationRule, ctx);
    expect(findings.length).toBe(0);
  });
});

// ─── Instability Tests (Tasks 472-476) ───────────────────────────

describe('instabilityDepthGrowthRule', () => {
  it('fires with 4 consecutive depth increases and ≥20% growth', () => {
    const windows = Array.from({ length: 5 }, (_, i) =>
      makeWindow([makeNodeSnapshot({
        nodeId: 'a',
        monitoredDepth: 100 + i * 30, // 100, 130, 160, 190, 220 (120% growth from oldest)
        monitoredDepthBound: 500,
      })], 500, i * 500),
    );
    const ctx = makeContext(windows);
    const findings = runRule(instabilityDepthGrowthRule, ctx);
    expect(findings.length).toBe(1);
    expect((findings[0] as { category: string }).category).toBe('Instability');
  });

  it('does not fire when growth is below 20% floor (slow sawtooth)', () => {
    // Growth from 100 to 110 = 10% — below the 20% floor
    const windows = Array.from({ length: 5 }, (_, i) =>
      makeWindow([makeNodeSnapshot({
        nodeId: 'a',
        monitoredDepth: 100 + i * 2.5, // 100, 102.5, 105, 107.5, 110
        monitoredDepthBound: 500,
      })], 500, i * 500),
    );
    const ctx = makeContext(windows);
    const findings = runRule(instabilityDepthGrowthRule, ctx);
    expect(findings.length).toBe(0);
  });

  it('does not fire with only 4 windows (requires 5)', () => {
    const windows = Array.from({ length: 4 }, (_, i) =>
      makeWindow([makeNodeSnapshot({
        nodeId: 'a',
        monitoredDepth: 100 + i * 50,
        monitoredDepthBound: 500,
      })], 500, i * 500),
    );
    const ctx = makeContext(windows);
    const findings = runRule(instabilityDepthGrowthRule, ctx);
    expect(findings.length).toBe(0);
  });

  it('reports projection as not applicable when no bound is available', () => {
    const windows = Array.from({ length: 5 }, (_, i) =>
      makeWindow([makeNodeSnapshot({
        nodeId: 'a',
        monitoredDepth: 100 + i * 30,
        monitoredDepthBound: null, // no bound
      })], 500, i * 500),
    );
    const ctx = makeContext(windows);
    const findings = runRule(instabilityDepthGrowthRule, ctx);
    expect(findings.length).toBe(1);
    const f = findings[0] as { constraint: string };
    expect(f.constraint).toContain('not applicable');
  });

  it('folds sustained utilization when node also satisfies saturation (precedence)', () => {
    const windows = Array.from({ length: 5 }, (_, i) =>
      makeWindow([makeNodeSnapshot({
        nodeId: 'a',
        monitoredDepth: 100 + i * 30,
        monitoredDepthBound: 500,
        utilization: { kind: 'value', value: 0.90, idle: false },
      })], 500, i * 500),
    );
    const ctx = makeContext(windows);
    const findings = runRule(instabilityDepthGrowthRule, ctx);
    expect(findings.length).toBe(1);
    const f = findings[0] as { evidence: { metricName: string; value: number }[] };
    const sustainedEvidence = f.evidence.find((e) => e.metricName === 'sustainedUtilization');
    expect(sustainedEvidence).toBeDefined();
    expect(sustainedEvidence!.value).toBeCloseTo(0.90, 2);
  });
});

describe('instabilityLittlesLawRule', () => {
  it('fires when deviation exceeds 5% in all 3 recent windows', () => {
    const windows = [
      makeWindow([makeNodeSnapshot({ nodeId: 'a', littlesLaw: { nodeId: 'a', L: 5, lambda: 10, W: 0.5, deviation: 0.10, isStable: false } })], 500, 0),
      makeWindow([makeNodeSnapshot({ nodeId: 'a', littlesLaw: { nodeId: 'a', L: 5, lambda: 10, W: 0.5, deviation: 0.08, isStable: false } })], 500, 500),
      makeWindow([makeNodeSnapshot({ nodeId: 'a', littlesLaw: { nodeId: 'a', L: 5, lambda: 10, W: 0.5, deviation: 0.12, isStable: false } })], 500, 1000),
    ];
    const ctx = makeContext(windows);
    const findings = runRule(instabilityLittlesLawRule, ctx);
    expect(findings.length).toBe(1);
    expect((findings[0] as { category: string }).category).toBe('Instability');
  });

  it('does not fire when deviation is below 5% in one window', () => {
    const windows = [
      makeWindow([makeNodeSnapshot({ nodeId: 'a', littlesLaw: { nodeId: 'a', L: 5, lambda: 10, W: 0.5, deviation: 0.10, isStable: false } })], 500, 0),
      makeWindow([makeNodeSnapshot({ nodeId: 'a', littlesLaw: { nodeId: 'a', L: 5, lambda: 10, W: 0.5, deviation: 0.03, isStable: true } })], 500, 500), // below threshold
      makeWindow([makeNodeSnapshot({ nodeId: 'a', littlesLaw: { nodeId: 'a', L: 5, lambda: 10, W: 0.5, deviation: 0.12, isStable: false } })], 500, 1000),
    ];
    const ctx = makeContext(windows);
    const findings = runRule(instabilityLittlesLawRule, ctx);
    expect(findings.length).toBe(0);
  });
});

// ─── DLQ Growth Rule Test (Task 477) ─────────────────────────────

describe('dlqGrowthRule', () => {
  it('fires when retained count rises in 3 consecutive windows', () => {
    const windows = [
      makeWindow([makeNodeSnapshot({ nodeId: 'dlq1', monitoredDepth: 10, retainedByUpstreamNode: { wp1: 5 } })], 500, 0),
      makeWindow([makeNodeSnapshot({ nodeId: 'dlq1', monitoredDepth: 15, retainedByUpstreamNode: { wp1: 8 } })], 500, 500),
      makeWindow([makeNodeSnapshot({ nodeId: 'dlq1', monitoredDepth: 22, retainedByUpstreamNode: { wp1: 12 } })], 500, 1000),
    ];
    const dlqNode: SimulationNode = {
      id: 'dlq1',
      nodeType: NodeType.DeadLetterQueue,
      label: 'DLQ-1',
      position: { x: 0, y: 0 },
      routingPolicy: RoutingPolicy.First,
      config: { capacity: 1000, retentionPeriodMs: 86400000, redriveMode: 'MANUAL', redriveIntervalMs: 60000, redriveBatchSize: 10, maxRedriveAttempts: 3 },
    } as SimulationNode;
    const ctx = makeContext(windows, [dlqNode]);
    const findings = runRule(dlqGrowthRule, ctx);
    expect(findings.length).toBe(1);
    expect((findings[0] as { category: string }).category).toBe('Reliability');
  });

  it('does not fire when depth decreases in one window', () => {
    const windows = [
      makeWindow([makeNodeSnapshot({ nodeId: 'dlq1', monitoredDepth: 10, retainedByUpstreamNode: { wp1: 5 } })], 500, 0),
      makeWindow([makeNodeSnapshot({ nodeId: 'dlq1', monitoredDepth: 8, retainedByUpstreamNode: { wp1: 3 } })], 500, 500), // decreased
      makeWindow([makeNodeSnapshot({ nodeId: 'dlq1', monitoredDepth: 15, retainedByUpstreamNode: { wp1: 8 } })], 500, 1000),
    ];
    const dlqNode: SimulationNode = {
      id: 'dlq1',
      nodeType: NodeType.DeadLetterQueue,
      label: 'DLQ-1',
      position: { x: 0, y: 0 },
      routingPolicy: RoutingPolicy.First,
      config: { capacity: 1000, retentionPeriodMs: 86400000, redriveMode: 'MANUAL', redriveIntervalMs: 60000, redriveBatchSize: 10, maxRedriveAttempts: 3 },
    } as SimulationNode;
    const ctx = makeContext(windows, [dlqNode]);
    const findings = runRule(dlqGrowthRule, ctx);
    expect(findings.length).toBe(0);
  });
});

// ─── Worker Pool Concurrency Rule Test (Task 478) ────────────────

describe('workerPoolConcurrencyRule', () => {
  it('fires when required concurrency exceeds configured', () => {
    // arrivalRate = 50/0.5s per window × 3 windows = 150 arrivals / 1.5s = 100/s
    // meanProcessingTime = 50ms = 0.05s
    // requiredConcurrency = ceil(100 * 0.05) = ceil(5) = 5
    // configured = 3, so should fire
    const wpNode: SimulationNode = {
      id: 'wp1',
      nodeType: NodeType.WorkerPool,
      label: 'WP-1',
      position: { x: 0, y: 0 },
      routingPolicy: RoutingPolicy.First,
      config: {
        concurrency: 3,
        jobProcessingMeanMs: 50,
        jobProcessingStdDevMs: 10,
        prefetchBufferDepth: 100,
        jobFailureRate: 0,
        maxRetries: 0,
        retryBackoff: 'FIXED',
        retryBaseDelayMs: 1000,
        jobTimeoutMs: 60000,
      },
    } as SimulationNode;

    const windows = [
      makeWindow([makeNodeSnapshot({ nodeId: 'wp1', arrivalCount: 50, utilization: { kind: 'value', value: 0.8, idle: false }, cumulativeTerminalCounts: { Success: 100 } })], 500, 0),
      makeWindow([makeNodeSnapshot({ nodeId: 'wp1', arrivalCount: 50, utilization: { kind: 'value', value: 0.8, idle: false }, cumulativeTerminalCounts: { Success: 100 } })], 500, 500),
      makeWindow([makeNodeSnapshot({ nodeId: 'wp1', arrivalCount: 50, utilization: { kind: 'value', value: 0.8, idle: false }, cumulativeTerminalCounts: { Success: 100 } })], 500, 1000),
    ];
    const ctx = makeContext(windows, [wpNode]);
    const findings = runRule(workerPoolConcurrencyRule, ctx);
    expect(findings.length).toBe(1);
    const f = findings[0] as { evidence: { metricName: string; value: number }[] };
    const req = f.evidence.find((e) => e.metricName === 'requiredConcurrency');
    expect(req!.value).toBe(5);
  });

  it('does not fire when required ≤ configured', () => {
    const wpNode: SimulationNode = {
      id: 'wp1',
      nodeType: NodeType.WorkerPool,
      label: 'WP-1',
      position: { x: 0, y: 0 },
      routingPolicy: RoutingPolicy.First,
      config: {
        concurrency: 100,
        jobProcessingMeanMs: 50,
        jobProcessingStdDevMs: 10,
        prefetchBufferDepth: 100,
        jobFailureRate: 0,
        maxRetries: 0,
        retryBackoff: 'FIXED',
        retryBaseDelayMs: 1000,
        jobTimeoutMs: 60000,
      },
    } as SimulationNode;

    const windows = [
      makeWindow([makeNodeSnapshot({ nodeId: 'wp1', arrivalCount: 50, utilization: { kind: 'value', value: 0.3, idle: false }, cumulativeTerminalCounts: { Success: 100 } })], 500, 0),
      makeWindow([makeNodeSnapshot({ nodeId: 'wp1', arrivalCount: 50, utilization: { kind: 'value', value: 0.3, idle: false }, cumulativeTerminalCounts: { Success: 100 } })], 500, 500),
      makeWindow([makeNodeSnapshot({ nodeId: 'wp1', arrivalCount: 50, utilization: { kind: 'value', value: 0.3, idle: false }, cumulativeTerminalCounts: { Success: 100 } })], 500, 1000),
    ];
    const ctx = makeContext(windows, [wpNode]);
    const findings = runRule(workerPoolConcurrencyRule, ctx);
    expect(findings.length).toBe(0);
  });

  it('does not fire with 0 completed attempts (minimum-sample gate)', () => {
    const wpNode: SimulationNode = {
      id: 'wp1',
      nodeType: NodeType.WorkerPool,
      label: 'WP-1',
      position: { x: 0, y: 0 },
      routingPolicy: RoutingPolicy.First,
      config: {
        concurrency: 3,
        jobProcessingMeanMs: 50,
        jobProcessingStdDevMs: 10,
        prefetchBufferDepth: 100,
        jobFailureRate: 0,
        maxRetries: 0,
        retryBackoff: 'FIXED',
        retryBaseDelayMs: 1000,
        jobTimeoutMs: 60000,
      },
    } as SimulationNode;

    const windows = [
      makeWindow([makeNodeSnapshot({ nodeId: 'wp1', arrivalCount: 50, utilization: { kind: 'value', value: 0.8, idle: false }, cumulativeTerminalCounts: {} })], 500, 0),
      makeWindow([makeNodeSnapshot({ nodeId: 'wp1', arrivalCount: 50, utilization: { kind: 'value', value: 0.8, idle: false }, cumulativeTerminalCounts: {} })], 500, 500),
      makeWindow([makeNodeSnapshot({ nodeId: 'wp1', arrivalCount: 50, utilization: { kind: 'value', value: 0.8, idle: false }, cumulativeTerminalCounts: {} })], 500, 1000),
    ];
    const ctx = makeContext(windows, [wpNode]);
    const findings = runRule(workerPoolConcurrencyRule, ctx);
    expect(findings.length).toBe(0);
  });
});

// ─── Admission Dominates Rule Test (Task 480, 481) ───────────────

describe('admissionDominatesRule', () => {
  it('fires when admission exceeds capacity by ≥20% across 3 windows with ≥30 non-Success', () => {
    const windows = [
      makeWindow([makeNodeSnapshot({ nodeId: 'a', terminalCounts: { Timeout: 12 } })], 500, 0),
      makeWindow([makeNodeSnapshot({ nodeId: 'a', terminalCounts: { Timeout: 12 } })], 500, 500),
      makeWindow([makeNodeSnapshot({ nodeId: 'a', terminalCounts: { Timeout: 12 } })], 500, 1000),
    ];
    // Override systemWide failureClassRates
    for (const w of windows) {
      w.systemWide.failureClassRates = { admission: 10, capacityReliability: 5, topologyConfiguration: 0 };
    }
    const ctx = makeContext(windows);
    const findings = runRule(admissionDominatesRule, ctx);
    expect(findings.length).toBe(1);
  });

  it('does not fire with fewer than 30 non-Success terminations (minimum-sample gate)', () => {
    const windows = [
      makeWindow([makeNodeSnapshot({ nodeId: 'a', terminalCounts: { Timeout: 5 } })], 500, 0),
      makeWindow([makeNodeSnapshot({ nodeId: 'a', terminalCounts: { Timeout: 5 } })], 500, 500),
      makeWindow([makeNodeSnapshot({ nodeId: 'a', terminalCounts: { Timeout: 5 } })], 500, 1000),
    ];
    for (const w of windows) {
      w.systemWide.failureClassRates = { admission: 10, capacityReliability: 5, topologyConfiguration: 0 };
    }
    const ctx = makeContext(windows);
    const findings = runRule(admissionDominatesRule, ctx);
    expect(findings.length).toBe(0);
  });

  it('does not fire when admission does not dominate by 20%', () => {
    const windows = [
      makeWindow([makeNodeSnapshot({ nodeId: 'a', terminalCounts: { Timeout: 20 } })], 500, 0),
      makeWindow([makeNodeSnapshot({ nodeId: 'a', terminalCounts: { Timeout: 20 } })], 500, 500),
      makeWindow([makeNodeSnapshot({ nodeId: 'a', terminalCounts: { Timeout: 20 } })], 500, 1000),
    ];
    for (const w of windows) {
      w.systemWide.failureClassRates = { admission: 5, capacityReliability: 5, topologyConfiguration: 0 };
    }
    const ctx = makeContext(windows);
    const findings = runRule(admissionDominatesRule, ctx);
    expect(findings.length).toBe(0);
  });
});

// ─── Scheduler Collision Rule Test (Task 479) ────────────────────

describe('schedulerCollisionRule', () => {
  it('fires when two schedulers have ≥2 consecutive coinciding triggers', () => {
    const s1: SimulationNode = {
      id: 's1', nodeType: NodeType.Scheduler, label: 'Sched-1',
      position: { x: 0, y: 0 }, routingPolicy: RoutingPolicy.First,
      config: { intervalMs: 1000, jobsPerTrigger: 1, startOffsetMs: 0, jitterMs: 0, overlapPolicy: 'ALLOW', maxDeferredTriggers: 10 },
    } as SimulationNode;
    const s2: SimulationNode = {
      id: 's2', nodeType: NodeType.Scheduler, label: 'Sched-2',
      position: { x: 0, y: 0 }, routingPolicy: RoutingPolicy.First,
      config: { intervalMs: 1000, jobsPerTrigger: 1, startOffsetMs: 0, jitterMs: 0, overlapPolicy: 'ALLOW', maxDeferredTriggers: 10 },
    } as SimulationNode;

    const windows = [
      makeWindow([
        makeNodeSnapshot({ nodeId: 's1' }),
        makeNodeSnapshot({ nodeId: 's2' }),
      ], 500, 0),
      makeWindow([
        makeNodeSnapshot({ nodeId: 's1' }),
        makeNodeSnapshot({ nodeId: 's2' }),
      ], 500, 500),
      makeWindow([
        makeNodeSnapshot({ nodeId: 's1' }),
        makeNodeSnapshot({ nodeId: 's2' }),
      ], 500, 1000),
    ];

    const eventLog = [
      { id: 1, timestamp: 1000, type: 'SCHEDULER_TRIGGER', nodeId: 's1', message: 'trigger fired' },
      { id: 2, timestamp: 1050, type: 'SCHEDULER_TRIGGER', nodeId: 's2', message: 'trigger fired' },
      { id: 3, timestamp: 2000, type: 'SCHEDULER_TRIGGER', nodeId: 's1', message: 'trigger fired' },
      { id: 4, timestamp: 2100, type: 'SCHEDULER_TRIGGER', nodeId: 's2', message: 'trigger fired' },
      { id: 5, timestamp: 3000, type: 'SCHEDULER_TRIGGER', nodeId: 's1', message: 'trigger fired' },
      { id: 6, timestamp: 3200, type: 'SCHEDULER_TRIGGER', nodeId: 's2', message: 'trigger fired' },
    ];

    const ctx = makeContext(windows, [s1, s2], { eventLog });
    const findings = runRule(schedulerCollisionRule, ctx);
    expect(findings.length).toBe(1);
    expect((findings[0] as { category: string }).category).toBe('Configuration');
  });

  it('does not fire with only 1 scheduler node', () => {
    const s1: SimulationNode = {
      id: 's1', nodeType: NodeType.Scheduler, label: 'Sched-1',
      position: { x: 0, y: 0 }, routingPolicy: RoutingPolicy.First,
      config: { intervalMs: 1000, jobsPerTrigger: 1, startOffsetMs: 0, jitterMs: 0, overlapPolicy: 'ALLOW', maxDeferredTriggers: 10 },
    } as SimulationNode;
    const windows = [
      makeWindow([makeNodeSnapshot({ nodeId: 's1' })], 500, 0),
      makeWindow([makeNodeSnapshot({ nodeId: 's1' })], 500, 500),
      makeWindow([makeNodeSnapshot({ nodeId: 's1' })], 500, 1000),
    ];
    const ctx = makeContext(windows, [s1]);
    const findings = runRule(schedulerCollisionRule, ctx);
    expect(findings.length).toBe(0);
  });
});

// ─── Headroom Rule Tests (Tasks 482-486) ─────────────────────────

describe('headroomRule', () => {
  it('reports per-node headroom as (1 - util) × 100', () => {
    const windows = [
      makeWindow([makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.70, idle: false } })], 500, 0),
      makeWindow([makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.70, idle: false } })], 500, 500),
      makeWindow([makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.70, idle: false } })], 500, 1000),
    ];
    const ctx = makeContext(windows);
    const findings = runRule(headroomRule, ctx);
    // Should have at least per-node and system findings
    expect(findings.length).toBeGreaterThanOrEqual(1);
    const perNode = (findings as { subjectNodeIds: string[]; evidence: { metricName: string; value: number }[] }[])
      .find((f) => f.subjectNodeIds.includes('a'));
    expect(perNode).toBeDefined();
    const headroom = perNode!.evidence.find((e) => e.metricName === 'headroom');
    expect(headroom!.value).toBeCloseTo(30, 1);
  });

  it('reports system headroom as (0.85/U - 1) × 100', () => {
    const windows = [
      makeWindow([makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.70, idle: false }, throughput: 100 })], 500, 0),
      makeWindow([makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.70, idle: false }, throughput: 100 })], 500, 500),
      makeWindow([makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.70, idle: false }, throughput: 100 })], 500, 1000),
    ];
    const ctx = makeContext(windows);
    const findings = runRule(headroomRule, ctx);
    const systemFinding = (findings as { subjectNodeIds: string[]; evidence: { metricName: string; value: number }[] }[])
      .find((f) => f.subjectNodeIds.length === 0 && f.evidence.some((e) => e.metricName === 'systemHeadroomPct'));
    expect(systemFinding).toBeDefined();
    // (0.85/0.70 - 1) × 100 ≈ 21.43%
    const pct = systemFinding!.evidence.find((e) => e.metricName === 'systemHeadroomPct');
    expect(pct!.value).toBeCloseTo(21.43, 1);
  });

  it('reports system headroom as 0% at or above 0.85', () => {
    const windows = [
      makeWindow([makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.90, idle: false }, throughput: 100 })], 500, 0),
      makeWindow([makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.90, idle: false }, throughput: 100 })], 500, 500),
      makeWindow([makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.90, idle: false }, throughput: 100 })], 500, 1000),
    ];
    const ctx = makeContext(windows);
    const findings = runRule(headroomRule, ctx);
    const systemFinding = (findings as { subjectNodeIds: string[]; evidence: { metricName: string; value: number }[] }[])
      .find((f) => f.subjectNodeIds.length === 0 && f.evidence.some((e) => e.metricName === 'systemHeadroomPct'));
    expect(systemFinding).toBeDefined();
    const pct = systemFinding!.evidence.find((e) => e.metricName === 'systemHeadroomPct');
    expect(pct!.value).toBe(0);
  });

  it('states capacity sweep assumption in tradeoff', () => {
    const windows = [
      makeWindow([makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.70, idle: false }, throughput: 100 })], 500, 0),
      makeWindow([makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.70, idle: false }, throughput: 100 })], 500, 500),
      makeWindow([makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.70, idle: false }, throughput: 100 })], 500, 1000),
    ];
    const ctx = makeContext(windows);
    const findings = runRule(headroomRule, ctx);
    for (const f of findings as { tradeoff: string }[]) {
      expect(f.tradeoff).toContain('Capacity_Sweep');
    }
  });
});

// ─── RULE_REGISTRY Tests (Tasks 487, 488, 489) ──────────────────

describe('RULE_REGISTRY', () => {
  it('has the correct order', () => {
    const expectedIds = [
      'bottleneck.rank',
      'bottleneck.co-limiting',
      'bottleneck.no-constraint',
      'bottleneck.none-eligible',
      'saturation.main',
      'instability.depth-growth',
      'instability.littles-law',
      'reliability.dlq-growth',
      'capacity.worker-pool-concurrency',
      'configuration.scheduler-collision',
      'reliability.admission-dominates',
      'capacity.headroom',
      'spof.reachability',
    ];
    expect(RULE_REGISTRY.map((r) => r.id)).toEqual(expectedIds);
  });

  it('every rule declares requiredMetrics array', () => {
    for (const rule of RULE_REGISTRY) {
      expect(Array.isArray(rule.requiredMetrics)).toBe(true);
    }
  });

  it('every rule yields (can be driven as a generator)', () => {
    // Minimal context with only 1 window — no rule should emit a Finding
    const windows = [
      makeWindow([makeNodeSnapshot({ nodeId: 'a' })], 500, 0),
    ];
    const ctx = makeContext(windows);

    for (const rule of RULE_REGISTRY) {
      const gen = rule.evaluate(ctx);
      let result = gen.next();
      while (!result.done) {
        result = gen.next();
      }
      // Should return an empty array (no Finding from single window)
      expect(Array.isArray(result.value)).toBe(true);
      expect(result.value.length).toBe(0);
    }
  });

  it('no rule emits a Finding from a single window (Task 489)', () => {
    const windows = [
      makeWindow([
        makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.99, idle: false }, monitoredDepth: 1000 }),
      ], 500, 0),
    ];
    const ctx = makeContext(windows);
    for (const rule of RULE_REGISTRY) {
      const findings = runRule(rule, ctx);
      expect(findings.length).toBe(0);
    }
  });

  it('no rule emits a Finding from two windows (minimum sample enforcement)', () => {
    const windows = [
      makeWindow([
        makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.99, idle: false }, monitoredDepth: 1000 }),
      ], 500, 0),
      makeWindow([
        makeNodeSnapshot({ nodeId: 'a', utilization: { kind: 'value', value: 0.99, idle: false }, monitoredDepth: 2000 }),
      ], 500, 500),
    ];
    const ctx = makeContext(windows);
    for (const rule of RULE_REGISTRY) {
      const findings = runRule(rule, ctx);
      expect(findings.length).toBe(0);
    }
  });
});
