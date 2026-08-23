import { describe, it, expect } from 'vitest';
import { round6, AnalysisError } from '@/utils/round6';
import {
  FindingBuilder,
  FindingResultMap,
  deriveFindingId,
  deriveConfidence,
} from './FindingBuilder';
import { AnalysisWindowStore, checkSteadyState } from './AnalysisWindowStore';
import { exportJSON, importJSON, isImportError } from './report';
import { sortFindingsForDisplay } from '@/store/analysisStore';
import type { Finding } from '@/types/findings';
import { NodeType } from '@/types/nodes';

// ─── round6 Tests ────────────────────────────────────────────────

describe('round6', () => {
  it('rounds positive values to 6 decimal places half-up', () => {
    expect(round6(1.23456789)).toBe(1.234568);
    expect(round6(0.1234565)).toBe(0.123457); // half-up
    expect(round6(0.1234564)).toBe(0.123456);
  });

  it('handles negatives with half-up semantics (half away from zero)', () => {
    expect(round6(-1.23456789)).toBe(-1.234568);
    // -0.1234565: magnitude rounds up → -0.123457
    expect(round6(-0.1234565)).toBe(-0.123457);
  });

  it('throws on non-finite values', () => {
    expect(() => round6(Infinity)).toThrow(AnalysisError);
    expect(() => round6(-Infinity)).toThrow(AnalysisError);
    expect(() => round6(NaN)).toThrow(AnalysisError);
  });

  it('preserves zero', () => {
    expect(round6(0)).toBe(0);
    expect(round6(-0)).toBe(0);
  });

  it('passes through values with fewer than 6 decimal places', () => {
    expect(round6(1.5)).toBe(1.5);
    expect(round6(42)).toBe(42);
  });
});

// ─── FindingBuilder Tests ────────────────────────────────────────

describe('FindingBuilder', () => {
  const baseFinding = {
    ruleId: 'test.rule',
    category: 'Bottleneck' as const,
    severity: 'Warning' as const,
    subjectNodeIds: ['node-b', 'node-a'],
    evidence: [
      {
        metricName: 'utilization',
        value: 0.85123456789,
        unit: 'fraction',
        scope: 'node-a',
        primary: true as const,
      },
      { metricName: 'throughput', value: 100.999999999, unit: 'req/s', scope: 'node-b' },
    ],
    constraint: 'Node exceeds 85% utilization threshold',
    action: {
      nodeId: 'node-a',
      parameter: 'workerThreadPoolSize',
      direction: 'increase' as const,
      multiplier: 1.5,
    },
    tradeoff: 'Increased memory usage from additional worker threads',
    lowestCompletedCount: 250,
    allSubjectsInSteadyState: true,
    window: { startMs: 0, endMs: 500 },
  };

  it('rounds numeric evidence values to 6 decimal places', () => {
    const f = FindingBuilder.build(baseFinding);
    expect(f.evidence[0]!.value).toBe(0.851235);
    expect(f.evidence[1]!.value).toBe(101);
  });

  it('derives stable identifier from ruleId, category, and sorted node IDs', () => {
    const f = FindingBuilder.build(baseFinding);
    expect(f.id).toBe('test.rule:Bottleneck:node-a,node-b');
  });

  it('derives High confidence at ≥200 with all subjects steady', () => {
    const f = FindingBuilder.build(baseFinding);
    expect(f.confidence).toBe('High');
  });

  it('derives Medium confidence at ≥200 with non-steady subjects', () => {
    const f = FindingBuilder.build({ ...baseFinding, allSubjectsInSteadyState: false });
    expect(f.confidence).toBe('Medium');
  });

  it('derives Medium confidence at 30–199', () => {
    const f = FindingBuilder.build({ ...baseFinding, lowestCompletedCount: 50 });
    expect(f.confidence).toBe('Medium');
  });

  it('derives Low confidence below 30', () => {
    const f = FindingBuilder.build({ ...baseFinding, lowestCompletedCount: 10 });
    expect(f.confidence).toBe('Low');
  });

  it('rejects more than one primary evidence entry', () => {
    const bad = {
      ...baseFinding,
      evidence: [
        { metricName: 'a', value: 1, unit: 'x', scope: 's', primary: true as const },
        { metricName: 'b', value: 2, unit: 'y', scope: 's', primary: true as const },
      ],
    };
    expect(() => FindingBuilder.build(bad)).toThrow('exactly one primary');
  });

  it('rejects zero primary evidence entries', () => {
    const bad = {
      ...baseFinding,
      evidence: [{ metricName: 'a', value: 1, unit: 'x', scope: 's' }],
    };
    expect(() => FindingBuilder.build(bad)).toThrow('exactly one primary');
  });

  it('rejects unit strings outside 1–20 characters', () => {
    const bad = {
      ...baseFinding,
      evidence: [{ metricName: 'a', value: 1, unit: '', scope: 's', primary: true as const }],
    };
    expect(() => FindingBuilder.build(bad)).toThrow('unit must be 1–20 chars');
  });
});

// ─── FindingResultMap Tests ──────────────────────────────────────

describe('FindingResultMap', () => {
  it('enforces exactly one Finding per stable identifier', () => {
    const map = new FindingResultMap();
    const f1 = FindingBuilder.build({
      ruleId: 'test.rule',
      category: 'Bottleneck',
      severity: 'Warning',
      subjectNodeIds: ['node-a'],
      evidence: [
        {
          metricName: 'util',
          value: 0.9,
          unit: 'fraction',
          scope: 'node-a',
          primary: true as const,
        },
      ],
      constraint: 'High utilization',
      action: { nodeId: 'node-a', parameter: 'pool', direction: 'increase' },
      tradeoff: 'More memory',
      lowestCompletedCount: 200,
      allSubjectsInSteadyState: true,
      window: { startMs: 0, endMs: 500 },
    });
    const f2 = FindingBuilder.build({
      ruleId: 'test.rule',
      category: 'Bottleneck',
      severity: 'Critical',
      subjectNodeIds: ['node-a'],
      evidence: [
        {
          metricName: 'util',
          value: 0.95,
          unit: 'fraction',
          scope: 'node-a',
          primary: true as const,
        },
      ],
      constraint: 'Very high utilization',
      action: { nodeId: 'node-a', parameter: 'pool', direction: 'increase' },
      tradeoff: 'More memory',
      lowestCompletedCount: 200,
      allSubjectsInSteadyState: true,
      window: { startMs: 0, endMs: 500 },
    });

    map.add(f1);
    map.add(f2);
    expect(map.size()).toBe(1);
    expect(map.values()[0]!.severity).toBe('Critical'); // The latter replaces the former
  });
});

// ─── deriveFindingId Tests ───────────────────────────────────────

describe('deriveFindingId', () => {
  it('sorts node IDs ascending', () => {
    expect(deriveFindingId('rule', 'Saturation', ['z', 'a', 'm'])).toBe('rule:Saturation:a,m,z');
  });

  it('handles empty node IDs (system-wide)', () => {
    expect(deriveFindingId('rule', 'Capacity', [])).toBe('rule:Capacity:');
  });
});

// ─── deriveConfidence Tests ──────────────────────────────────────

describe('deriveConfidence', () => {
  it('returns High for ≥200 and all steady', () => {
    expect(deriveConfidence(200, true)).toBe('High');
    expect(deriveConfidence(1000, true)).toBe('High');
  });

  it('returns Medium for ≥200 but not all steady', () => {
    expect(deriveConfidence(200, false)).toBe('Medium');
  });

  it('returns Medium for 30–199', () => {
    expect(deriveConfidence(30, true)).toBe('Medium');
    expect(deriveConfidence(199, true)).toBe('Medium');
  });

  it('returns Low for <30', () => {
    expect(deriveConfidence(29, true)).toBe('Low');
    expect(deriveConfidence(0, true)).toBe('Low');
  });
});

// ─── AnalysisWindowStore Tests ───────────────────────────────────

describe('AnalysisWindowStore', () => {
  it('retains at most 16 windows', () => {
    const store = new AnalysisWindowStore();
    for (let i = 1; i <= 20; i++) {
      store.pushBatch({
        simulatedTimeMs: i * 500,
        nodes: [],
        systemWide: {
          totalThroughput: 100,
          endToEndLatency: { p50: 10, p90: 50, p99: 100 },
          totalErrorRate: 0,
          activeRequests: 0,
        },
      });
    }
    expect(store.windows.length).toBe(16);
  });

  it('excludes zero-duration windows from completed count', () => {
    const store = new AnalysisWindowStore();
    // First real window
    store.pushBatch({
      simulatedTimeMs: 500,
      nodes: [],
      systemWide: {
        totalThroughput: 100,
        endToEndLatency: { p50: 10, p90: 50, p99: 100 },
        totalErrorRate: 0,
        activeRequests: 0,
      },
    });
    // Zero-duration window (same timestamp)
    store.pushBatch({
      simulatedTimeMs: 500,
      nodes: [],
      systemWide: {
        totalThroughput: 0,
        endToEndLatency: { p50: 0, p90: 0, p99: 0 },
        totalErrorRate: 0,
        activeRequests: 0,
      },
    });
    expect(store.completedWindowCount).toBe(1);
  });

  it('reports hasMinimumWindows only at ≥3 completed windows', () => {
    const store = new AnalysisWindowStore();
    store.pushBatch({
      simulatedTimeMs: 500,
      nodes: [],
      systemWide: {
        totalThroughput: 100,
        endToEndLatency: { p50: 10, p90: 50, p99: 100 },
        totalErrorRate: 0,
        activeRequests: 0,
      },
    });
    store.pushBatch({
      simulatedTimeMs: 1000,
      nodes: [],
      systemWide: {
        totalThroughput: 100,
        endToEndLatency: { p50: 10, p90: 50, p99: 100 },
        totalErrorRate: 0,
        activeRequests: 0,
      },
    });
    expect(store.hasMinimumWindows).toBe(false);
    store.pushBatch({
      simulatedTimeMs: 1500,
      nodes: [],
      systemWide: {
        totalThroughput: 100,
        endToEndLatency: { p50: 10, p90: 50, p99: 100 },
        totalErrorRate: 0,
        activeRequests: 0,
      },
    });
    expect(store.hasMinimumWindows).toBe(true);
  });

  it('resets all state', () => {
    const store = new AnalysisWindowStore();
    store.pushBatch({
      simulatedTimeMs: 500,
      nodes: [],
      systemWide: {
        totalThroughput: 100,
        endToEndLatency: { p50: 10, p90: 50, p99: 100 },
        totalErrorRate: 0,
        activeRequests: 0,
      },
    });
    store.reset();
    expect(store.windows.length).toBe(0);
    expect(store.completedWindowCount).toBe(0);
  });
});

// ─── Steady_State Detection Tests ────────────────────────────────

describe('checkSteadyState', () => {
  function makeWindow(arrivalCount: number, queueDepth: number, durationMs = 500) {
    return {
      startMs: 0,
      endMs: durationMs,
      durationMs,
      nodes: [
        {
          nodeId: 'n1',
          timestamp: 0,
          throughput: 0,
          errorRate: 0,
          latencyPercentiles: { p50: 0, p90: 0, p99: 0 },
          queueDepth,
          activeConnections: 0,
          bufferOccupancy: 0,
          utilization: { kind: 'value' as const, value: 0.5, idle: false },
          littlesLaw: { nodeId: 'n1', L: 0, lambda: 0, W: 0, deviation: 0, isStable: true },
          healthStatus: 'green' as const,
          terminalCounts: {},
          cumulativeTerminalCounts: {},
          arrivalCount,
          departureCount: arrivalCount,
          timeInSystemAtNodeMs: 0,
          pathTimeInSystemMs: 0,
          terminatedThroughNodeCount: 0,
          monitoredDepth: null,
          monitoredDepthBound: null,
          durationMs,
        },
      ],
      systemWide: {
        totalThroughput: 0,
        endToEndLatency: { p50: 0, p90: 0, p99: 0 },
        totalErrorRate: 0,
        activeRequests: 0,
      },
    };
  }

  it('detects steady state with stable arrival rate and queue depth', () => {
    const windows = [makeWindow(100, 10), makeWindow(100, 10), makeWindow(100, 10)];
    const result = checkSteadyState('n1', windows);
    expect(result.isSteady).toBe(true);
  });

  it('rejects steady state with >10% arrival rate variation', () => {
    const windows = [
      makeWindow(100, 10),
      makeWindow(120, 10), // 20% variation
      makeWindow(100, 10),
    ];
    const result = checkSteadyState('n1', windows);
    expect(result.isSteady).toBe(false);
  });

  it('requires at least 3 windows', () => {
    const windows = [makeWindow(100, 10), makeWindow(100, 10)];
    const result = checkSteadyState('n1', windows);
    expect(result.isSteady).toBe(false);
  });
});

// ─── Report Round-Trip Test (Task 464) ───────────────────────────

describe('report round-trip', () => {
  it('export then import yields a Finding set equal to the original', () => {
    const originalFindings: Finding[] = [
      FindingBuilder.build({
        ruleId: 'bottleneck.rank',
        category: 'Bottleneck',
        severity: 'Critical',
        subjectNodeIds: ['node-001'],
        evidence: [
          {
            metricName: 'utilization',
            value: 0.92345678,
            unit: 'fraction',
            scope: 'node-001',
            primary: true as const,
          },
          { metricName: 'throughput', value: 523.456789, unit: 'req/s', scope: 'node-001' },
        ],
        constraint: 'Node utilization exceeds 85% sustained threshold',
        action: {
          nodeId: 'node-001',
          parameter: 'workerThreadPoolSize',
          direction: 'increase',
          multiplier: 2.0,
        },
        tradeoff: 'Increased memory usage from additional worker threads',
        lowestCompletedCount: 500,
        allSubjectsInSteadyState: true,
        window: { startMs: 1000, endMs: 1500 },
      }),
      FindingBuilder.build({
        ruleId: 'saturation.main',
        category: 'Saturation',
        severity: 'Warning',
        subjectNodeIds: ['node-002', 'node-003'],
        evidence: [
          {
            metricName: 'utilization',
            value: 0.87,
            unit: 'fraction',
            scope: 'node-002',
            primary: true as const,
          },
        ],
        constraint: 'Sustained utilization above 85% over 3 windows',
        action: {
          nodeId: 'node-002',
          parameter: 'connectionPoolSize',
          direction: 'increase',
          targetValue: { value: 200, unit: 'connections' },
        },
        tradeoff: 'Additional database connections consume server file descriptors',
        lowestCompletedCount: 45,
        allSubjectsInSteadyState: false,
        window: { startMs: 1000, endMs: 1500 },
      }),
      FindingBuilder.build({
        ruleId: 'spof.main',
        category: 'Single_Point_Of_Failure',
        severity: 'Critical',
        subjectNodeIds: ['node-004'],
        evidence: [
          {
            metricName: 'blastRadius',
            value: 0.75,
            unit: 'fraction',
            scope: 'node-004',
            primary: true as const,
          },
        ],
        constraint: 'Removing this node disconnects 75% of traffic',
        action: {
          nodeId: 'node-004',
          nodeType: NodeType.LoadBalancer,
          change: 'add-redundant-instance-behind-a-Load_Balancer-node',
          nodesAdded: 1,
          edgesAdded: 2,
        },
        tradeoff: 'Additional infrastructure cost for redundancy',
        lowestCompletedCount: 300,
        allSubjectsInSteadyState: true,
        window: { startMs: 1000, endMs: 1500 },
      }),
    ];

    const sorted = sortFindingsForDisplay(originalFindings);

    // Export
    const json = exportJSON({
      findings: sorted,
      topology: { nodes: [], edges: [] },
      nodeConfigurations: {},
      seed: 42,
      simulatedDurationMs: 30000,
      offeredLoadRps: 1000,
    });

    // Import
    const result = importJSON(json);
    expect(isImportError(result)).toBe(false);
    if (isImportError(result)) return;

    // Imported findings must equal the original set
    expect(result.findings.length).toBe(sorted.length);
    for (let i = 0; i < sorted.length; i++) {
      const orig = sorted[i]!;
      const imported = result.findings[i]!;
      expect(imported.id).toBe(orig.id);
      expect(imported.category).toBe(orig.category);
      expect(imported.severity).toBe(orig.severity);
      expect(imported.confidence).toBe(orig.confidence);
      expect(imported.subjectNodeIds).toEqual(orig.subjectNodeIds);
      expect(imported.constraint).toBe(orig.constraint);
      expect(imported.tradeoff).toBe(orig.tradeoff);
      expect(imported.window).toEqual(orig.window);
      expect(imported.evidence).toEqual(orig.evidence);
      expect(imported.action).toEqual(orig.action);
    }

    // Label carries metadata
    expect(result.label.seed).toBe(42);
    expect(result.label.simulatedDurationMs).toBe(30000);
    expect(result.label.offeredLoadRps).toBe(1000);
  });

  it('rejects unsupported schema version', () => {
    const json = JSON.stringify({ schemaVersion: 999, findings: [] });
    const result = importJSON(json);
    expect(isImportError(result)).toBe(true);
    if (!isImportError(result)) return;
    expect(result.message).toContain('Unsupported');
    expect(result.details[0]).toContain('Required version: 1');
  });

  it('rejects missing required Finding fields', () => {
    const json = JSON.stringify({
      schemaVersion: 1,
      findings: [{ id: 'x', category: 'Bottleneck' }], // missing many fields
    });
    const result = importJSON(json);
    expect(isImportError(result)).toBe(true);
    if (!isImportError(result)) return;
    expect(result.details.some((d) => d.includes('missing required field'))).toBe(true);
  });

  it('rejects out-of-set category', () => {
    const json = JSON.stringify({
      schemaVersion: 1,
      findings: [
        {
          id: 'x',
          category: 'InvalidCategory',
          severity: 'Warning',
          confidence: 'High',
          subjectNodeIds: [],
          evidence: [{ metricName: 'a', value: 1, unit: 'x', scope: 's', primary: true }],
          constraint: 'c',
          action: { nodeId: 'n', parameter: 'p', direction: 'increase' },
          tradeoff: 't',
          window: { startMs: 0, endMs: 500 },
        },
      ],
    });
    const result = importJSON(json);
    expect(isImportError(result)).toBe(true);
    if (!isImportError(result)) return;
    expect(result.details.some((d) => d.includes('unrecognised category'))).toBe(true);
  });

  it('rejects out-of-set severity', () => {
    const json = JSON.stringify({
      schemaVersion: 1,
      findings: [
        {
          id: 'x',
          category: 'Bottleneck',
          severity: 'Extreme',
          confidence: 'High',
          subjectNodeIds: [],
          evidence: [{ metricName: 'a', value: 1, unit: 'x', scope: 's', primary: true }],
          constraint: 'c',
          action: { nodeId: 'n', parameter: 'p', direction: 'increase' },
          tradeoff: 't',
          window: { startMs: 0, endMs: 500 },
        },
      ],
    });
    const result = importJSON(json);
    expect(isImportError(result)).toBe(true);
    if (!isImportError(result)) return;
    expect(result.details.some((d) => d.includes('unrecognised severity'))).toBe(true);
  });
});

// ─── sortFindingsForDisplay Tests ────────────────────────────────

describe('sortFindingsForDisplay', () => {
  it('sorts by category declaration order first', () => {
    const f1 = { id: 'a', category: 'Saturation' } as Finding;
    const f2 = { id: 'b', category: 'Bottleneck' } as Finding;
    const sorted = sortFindingsForDisplay([f1, f2]);
    expect(sorted[0]!.category).toBe('Bottleneck');
    expect(sorted[1]!.category).toBe('Saturation');
  });

  it('within same category, sorts by severity', () => {
    const f1 = { id: 'a', category: 'Bottleneck', severity: 'Info', confidence: 'High' } as Finding;
    const f2 = {
      id: 'b',
      category: 'Bottleneck',
      severity: 'Critical',
      confidence: 'High',
    } as Finding;
    const sorted = sortFindingsForDisplay([f1, f2]);
    expect(sorted[0]!.severity).toBe('Critical');
    expect(sorted[1]!.severity).toBe('Info');
  });

  it('tie-breaks by ascending stable identifier', () => {
    const f1 = {
      id: 'z',
      category: 'Bottleneck',
      severity: 'Warning',
      confidence: 'High',
    } as Finding;
    const f2 = {
      id: 'a',
      category: 'Bottleneck',
      severity: 'Warning',
      confidence: 'High',
    } as Finding;
    const sorted = sortFindingsForDisplay([f1, f2]);
    expect(sorted[0]!.id).toBe('a');
    expect(sorted[1]!.id).toBe('z');
  });
});
