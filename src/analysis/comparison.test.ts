import { describe, it, expect } from 'vitest';
import type { BaselineRun, PerNodeAggregates, WholeRunAggregates } from '@/types/baseline';
import {
  validateBaselineName,
  validateBaselineLimit,
  BASELINE_MAX_RECORDS,
} from '@/types/baseline';
import {
  computeDifference,
  matchNodes,
  compareRuns,
  isComparisonError,
  determineComparisonLabel,
} from './comparison';
import { comparisonObjectiveRule, comparisonUtilizationRule } from './rules/comparison';

// ─── Fixtures ────────────────────────────────────────────────────

function makeWholeRun(overrides: Partial<WholeRunAggregates> = {}): WholeRunAggregates {
  return {
    latency: { p50: 10, p90: 50, p99: 100 },
    throughput: 500,
    errorRate: 0.02,
    terminalStatusRates: {
      SUCCESS: 0.98,
      TIMEOUT: 0.005,
      DROPPED: 0.005,
      LOOP_DETECTED: 0.001,
      NO_ROUTE: 0.001,
      UNAUTHENTICATED: 0.002,
      FORBIDDEN: 0.002,
      RETRY_EXHAUSTED: 0.002,
      DEAD_LETTERED: 0.002,
    },
    ...overrides,
  };
}

function makePerNode(overrides: Partial<PerNodeAggregates> = {}): PerNodeAggregates {
  return {
    nodeId: 'node-1',
    nodeType: 'APP_SERVER',
    label: 'App Server 1',
    meanUtilization: 0.6,
    throughput: 100,
    errorRate: 0.01,
    meanQueueDepth: 5,
    config: { workerThreadPoolSize: 10 },
    ...overrides,
  };
}

function makeBaseline(overrides: Partial<BaselineRun> = {}): BaselineRun {
  return {
    schemaVersion: 2,
    name: 'Baseline A',
    createdAt: '2024-01-01T00:00:00.000Z',
    seed: 42,
    simulatedDurationMs: 30000,
    totalOfferedRps: 100,
    topology: { schemaVersion: 2, nodes: [], edges: [], subsystemGroups: [] },
    wholeRun: makeWholeRun(),
    perNode: {
      'node-1': makePerNode(),
    },
    ...overrides,
  };
}

// ─── Name Validation (Task 526) ──────────────────────────────────

describe('validateBaselineName', () => {
  it('rejects empty name after trimming', () => {
    const err = validateBaselineName('   ', []);
    expect(err).not.toBeNull();
    expect(err!.constraint).toContain('1 to 40');
  });

  it('rejects name longer than 40 characters', () => {
    const longName = 'A'.repeat(41);
    const err = validateBaselineName(longName, []);
    expect(err).not.toBeNull();
    expect(err!.constraint).toContain('1 to 40');
  });

  it('accepts name exactly at 40 characters', () => {
    const name = 'A'.repeat(40);
    const err = validateBaselineName(name, []);
    expect(err).toBeNull();
  });

  it('accepts name exactly at 1 character', () => {
    const err = validateBaselineName('X', []);
    expect(err).toBeNull();
  });

  it('trims before validating length', () => {
    const err = validateBaselineName('  A  ', []);
    expect(err).toBeNull();
  });

  it('rejects case-insensitive duplicate', () => {
    const err = validateBaselineName('My Run', ['my run']);
    expect(err).not.toBeNull();
    expect(err!.constraint).toContain('case-insensitively unique');
    expect(err!.storedNames).toEqual(['my run']);
  });

  it('allows name that differs by case from no stored name', () => {
    const err = validateBaselineName('New Run', ['Other Run']);
    expect(err).toBeNull();
  });
});

// ─── 5-Record Limit (Task 526) ───────────────────────────────────

describe('validateBaselineLimit', () => {
  it('allows when under 5 records', () => {
    const err = validateBaselineLimit(['a', 'b', 'c', 'd']);
    expect(err).toBeNull();
  });

  it('rejects at 5 records', () => {
    const err = validateBaselineLimit(['a', 'b', 'c', 'd', 'e']);
    expect(err).not.toBeNull();
    expect(err!.constraint).toContain(`${BASELINE_MAX_RECORDS}`);
    expect(err!.storedNames).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

// ─── Difference Convention (Tasks 530–531) ───────────────────────

describe('computeDifference', () => {
  it('computes B - A for absolute difference', () => {
    const d = computeDifference('metric', 'ms', 100, 150);
    expect(d.absoluteDiff).toBe(50);
  });

  it('computes percentage as (B-A)/|A| * 100 to 2dp', () => {
    const d = computeDifference('metric', 'ms', 200, 250);
    expect(d.percentDiff).toBe(25.0);
  });

  it('handles negative A correctly for percentage', () => {
    // (B - A) / |A| where A = -100, B = -50 → (-50 - (-100)) / |-100| = 50/100 = 50%
    const d = computeDifference('metric', 'ms', -100, -50);
    expect(d.absoluteDiff).toBe(50);
    expect(d.percentDiff).toBe(50.0);
  });

  it('returns null percentage when A is 0', () => {
    const d = computeDifference('metric', 'ms', 0, 100);
    expect(d.percentDiff).toBeNull();
  });

  it('rounds percentage to 2 decimal places', () => {
    // (B-A)/|A| = (7-3)/3 = 4/3 = 133.333... → 133.33
    const d = computeDifference('metric', 'ms', 3, 7);
    expect(d.percentDiff).toBe(133.33);
  });
});

// ─── Node Matching (Task 533) ────────────────────────────────────

describe('matchNodes', () => {
  it('matches by same identifier and same type', () => {
    const nodesA: Record<string, PerNodeAggregates> = {
      'id-1': makePerNode({ nodeId: 'id-1', nodeType: 'APP_SERVER', label: 'Server' }),
    };
    const nodesB: Record<string, PerNodeAggregates> = {
      'id-1': makePerNode({ nodeId: 'id-1', nodeType: 'APP_SERVER', label: 'Server Renamed' }),
    };
    const { matched, unmatched } = matchNodes(nodesA, nodesB);
    expect(matched).toHaveLength(1);
    expect(matched[0]!.nodeIdA).toBe('id-1');
    expect(matched[0]!.nodeIdB).toBe('id-1');
    expect(unmatched).toHaveLength(0);
  });

  it('does NOT match same id with different type', () => {
    const nodesA: Record<string, PerNodeAggregates> = {
      'id-1': makePerNode({ nodeId: 'id-1', nodeType: 'APP_SERVER', label: 'Server' }),
    };
    const nodesB: Record<string, PerNodeAggregates> = {
      'id-1': makePerNode({ nodeId: 'id-1', nodeType: 'DATABASE', label: 'Server' }),
    };
    const { matched, unmatched } = matchNodes(nodesA, nodesB);
    expect(matched).toHaveLength(0);
    expect(unmatched).toHaveLength(2);
  });

  it('falls back to same type + same label (case-insensitive) when id is unique to one run', () => {
    const nodesA: Record<string, PerNodeAggregates> = {
      'old-uuid': makePerNode({ nodeId: 'old-uuid', nodeType: 'APP_SERVER', label: 'App Server' }),
    };
    const nodesB: Record<string, PerNodeAggregates> = {
      'new-uuid': makePerNode({ nodeId: 'new-uuid', nodeType: 'APP_SERVER', label: 'app server' }),
    };
    const { matched, unmatched } = matchNodes(nodesA, nodesB);
    expect(matched).toHaveLength(1);
    expect(matched[0]!.nodeIdA).toBe('old-uuid');
    expect(matched[0]!.nodeIdB).toBe('new-uuid');
    expect(unmatched).toHaveLength(0);
  });

  it('does NOT match fallback when multiple candidates exist', () => {
    const nodesA: Record<string, PerNodeAggregates> = {
      'old-uuid': makePerNode({ nodeId: 'old-uuid', nodeType: 'APP_SERVER', label: 'Server' }),
    };
    const nodesB: Record<string, PerNodeAggregates> = {
      'new-uuid-1': makePerNode({ nodeId: 'new-uuid-1', nodeType: 'APP_SERVER', label: 'Server' }),
      'new-uuid-2': makePerNode({ nodeId: 'new-uuid-2', nodeType: 'APP_SERVER', label: 'server' }),
    };
    const { matched, unmatched } = matchNodes(nodesA, nodesB);
    expect(matched).toHaveLength(0);
    expect(unmatched).toHaveLength(3);
  });

  it('lists unmatched nodes with their run', () => {
    const nodesA: Record<string, PerNodeAggregates> = {
      'a-only': makePerNode({ nodeId: 'a-only', nodeType: 'CACHE', label: 'Cache A' }),
    };
    const nodesB: Record<string, PerNodeAggregates> = {
      'b-only': makePerNode({ nodeId: 'b-only', nodeType: 'DATABASE', label: 'DB B' }),
    };
    const { matched, unmatched } = matchNodes(nodesA, nodesB);
    expect(matched).toHaveLength(0);
    expect(unmatched).toHaveLength(2);
    expect(unmatched.find((u) => u.nodeId === 'a-only')!.presentIn).toBe('A');
    expect(unmatched.find((u) => u.nodeId === 'b-only')!.presentIn).toBe('B');
  });
});

// ─── Controlled Comparison (Task 535) ────────────────────────────

describe('determineComparisonLabel', () => {
  it('labels controlled when seed, duration, and offered load match', () => {
    const a = makeBaseline({ seed: 42, simulatedDurationMs: 30000, totalOfferedRps: 100 });
    const b = makeBaseline({ seed: 42, simulatedDurationMs: 30000, totalOfferedRps: 100.005 });
    const label = determineComparisonLabel(a, b);
    expect(label.kind).toBe('controlled');
  });

  it('labels uncontrolled when seed differs', () => {
    const a = makeBaseline({ seed: 42 });
    const b = makeBaseline({ seed: 99 });
    const label = determineComparisonLabel(a, b);
    expect(label.kind).toBe('uncontrolled');
    if (label.kind === 'uncontrolled') {
      expect(label.differences).toContainEqual(
        expect.objectContaining({ attribute: 'seed' }),
      );
    }
  });

  it('labels uncontrolled when offered load differs by more than 0.01', () => {
    const a = makeBaseline({ totalOfferedRps: 100 });
    const b = makeBaseline({ totalOfferedRps: 100.02 });
    const label = determineComparisonLabel(a, b);
    expect(label.kind).toBe('uncontrolled');
  });

  it('labels controlled when offered load differs by at most 0.01', () => {
    const a = makeBaseline({ totalOfferedRps: 100 });
    const b = makeBaseline({ totalOfferedRps: 100.009 });
    const label = determineComparisonLabel(a, b);
    expect(label.kind).toBe('controlled');
  });
});

// ─── Full Comparison (Task 530) ──────────────────────────────────

describe('compareRuns', () => {
  it('rejects same run selections', () => {
    const run = makeBaseline({ name: 'Same' });
    const result = compareRuns(
      { name: 'Same', run },
      { name: 'Same', run },
    );
    expect(isComparisonError(result)).toBe(true);
    if (isComparisonError(result)) {
      expect(result.message).toContain('same run');
    }
  });

  it('produces system metrics with B - A convention', () => {
    const a = makeBaseline({
      name: 'A',
      wholeRun: makeWholeRun({ latency: { p50: 10, p90: 50, p99: 100 }, throughput: 500 }),
    });
    const b = makeBaseline({
      name: 'B',
      wholeRun: makeWholeRun({ latency: { p50: 15, p90: 60, p99: 120 }, throughput: 600 }),
    });
    const result = compareRuns({ name: 'A', run: a }, { name: 'B', run: b });
    expect(isComparisonError(result)).toBe(false);
    if (!isComparisonError(result)) {
      const p50 = result.systemMetrics.find((m) => m.metric === 'p50')!;
      expect(p50.absoluteDiff).toBe(5); // 15 - 10
      const tp = result.systemMetrics.find((m) => m.metric === 'throughput')!;
      expect(tp.absoluteDiff).toBe(100); // 600 - 500
    }
  });
});

// ─── Comparison Rules (Task 535) ─────────────────────────────────

describe('comparisonObjectiveRule', () => {
  it('returns null when neither run has an objective', () => {
    const a = makeBaseline({ objective: undefined });
    const b = makeBaseline({ name: 'B', objective: undefined });
    const finding = comparisonObjectiveRule(a, 'A', b, 'B');
    expect(finding).toBeNull();
  });

  it('produces a Finding when one run satisfies and the other does not', () => {
    const obj = { maxP99LatencyMs: 110, maxErrorRate: 0.05 };
    const a = makeBaseline({
      objective: obj,
      wholeRun: makeWholeRun({ latency: { p50: 10, p90: 50, p99: 100 }, errorRate: 0.02 }),
    });
    const b = makeBaseline({
      name: 'B',
      objective: obj,
      wholeRun: makeWholeRun({ latency: { p50: 20, p90: 80, p99: 200 }, errorRate: 0.04 }),
    });
    const finding = comparisonObjectiveRule(a, 'A', b, 'B');
    expect(finding).not.toBeNull();
    expect(finding!.category).toBe('Comparison');
    expect(finding!.constraint).toContain('"A" satisfies');
  });
});

describe('comparisonUtilizationRule', () => {
  it('produces a Finding for ≥0.10 utilization difference', () => {
    const a = makeBaseline({
      perNode: {
        'n1': makePerNode({ nodeId: 'n1', meanUtilization: 0.3 }),
      },
    });
    const b = makeBaseline({
      name: 'B',
      perNode: {
        'n1': makePerNode({ nodeId: 'n1', meanUtilization: 0.5 }),
      },
    });
    const matched = [{ nodeIdA: 'n1', nodeIdB: 'n1', nodeType: 'APP_SERVER', label: 'Server' }];
    const findings = comparisonUtilizationRule(a, 'A', b, 'B', matched);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('Comparison');
  });

  it('produces no Finding for <0.10 utilization difference', () => {
    const a = makeBaseline({
      perNode: {
        'n1': makePerNode({ nodeId: 'n1', meanUtilization: 0.5 }),
      },
    });
    const b = makeBaseline({
      name: 'B',
      perNode: {
        'n1': makePerNode({ nodeId: 'n1', meanUtilization: 0.55 }),
      },
    });
    const matched = [{ nodeIdA: 'n1', nodeIdB: 'n1', nodeType: 'APP_SERVER', label: 'Server' }];
    const findings = comparisonUtilizationRule(a, 'A', b, 'B', matched);
    expect(findings).toHaveLength(0);
  });
});
