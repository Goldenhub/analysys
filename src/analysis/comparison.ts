import type { BaselineRun, WholeRunAggregates, PerNodeAggregates } from '@/types/baseline';

// ─── Types ───────────────────────────────────────────────────────

export interface ComparisonSelection {
  /** Display name (the baseline name or "Current Run"). */
  name: string;
  run: BaselineRun;
}

export interface MetricDifference {
  metric: string;
  unit: string;
  valueA: number;
  valueB: number;
  /** B - A */
  absoluteDiff: number;
  /** ((B - A) / |A|) * 100, to 2 decimal places. null when A is 0. */
  percentDiff: number | null;
}

export interface PerNodeDifference {
  nodeId: string;
  nodeType: string;
  label: string;
  metrics: MetricDifference[];
}

export interface UnmatchedNode {
  nodeId: string;
  nodeType: string;
  label: string;
  /** Which run contains this node: 'A' or 'B'. */
  presentIn: 'A' | 'B';
}

export interface ConfigDifference {
  nodeId: string;
  label: string;
  parameter: string;
  valueA: unknown;
  valueB: unknown;
}

export type ComparisonLabel =
  | { kind: 'controlled' }
  | {
      kind: 'uncontrolled';
      differences: Array<{ attribute: string; valueA: unknown; valueB: unknown }>;
    };

export interface ComparisonResult {
  label: ComparisonLabel;
  nameA: string;
  nameB: string;
  systemMetrics: MetricDifference[];
  perNode: PerNodeDifference[];
  unmatchedNodes: UnmatchedNode[];
  configDifferences: ConfigDifference[];
}

export interface ComparisonError {
  message: string;
}

// ─── Difference Calculation (Task 530–531) ───────────────────────

/**
 * Compute signed difference B - A and percentage over |A| to 2dp.
 */
export function computeDifference(
  metric: string,
  unit: string,
  a: number,
  b: number,
): MetricDifference {
  const absoluteDiff = b - a;
  const percentDiff = a === 0 ? null : Math.round(((b - a) / Math.abs(a)) * 10000) / 100;
  return { metric, unit, valueA: a, valueB: b, absoluteDiff, percentDiff };
}

// ─── Node Matching (Task 533) ────────────────────────────────────

export interface MatchedNode {
  nodeIdA: string;
  nodeIdB: string;
  nodeType: string;
  label: string;
}

/**
 * Match nodes across two runs:
 * 1. Same identifier + same type → matched.
 * 2. Fallback: same type + same case-insensitive label, where the identifier
 *    appears in one run only and exactly one candidate per run.
 * Everything else is listed as not-present.
 */
export function matchNodes(
  nodesA: Record<string, PerNodeAggregates>,
  nodesB: Record<string, PerNodeAggregates>,
): { matched: MatchedNode[]; unmatched: UnmatchedNode[] } {
  const matched: MatchedNode[] = [];
  const matchedIdsA = new Set<string>();
  const matchedIdsB = new Set<string>();

  // Pass 1: same id + same type
  for (const [idA, nodeA] of Object.entries(nodesA)) {
    const nodeB = nodesB[idA];
    if (nodeB && nodeA.nodeType === nodeB.nodeType) {
      matched.push({
        nodeIdA: idA,
        nodeIdB: idA,
        nodeType: nodeA.nodeType,
        label: nodeA.label,
      });
      matchedIdsA.add(idA);
      matchedIdsB.add(idA);
    }
  }

  // Pass 2: fallback — same type + same case-insensitive label
  // Only consider nodes whose ID appears in one run only
  const unmatchedA = Object.entries(nodesA).filter(([id]) => !matchedIdsA.has(id));
  const unmatchedB = Object.entries(nodesB).filter(([id]) => !matchedIdsB.has(id));

  for (const [idA, nodeA] of unmatchedA) {
    // ID must appear in only one run (not in B)
    if (idA in nodesB) continue;

    // Find candidates in B: same type + same label (case-insensitive)
    const candidates = unmatchedB.filter(
      ([idB, nodeB]) =>
        !matchedIdsB.has(idB) &&
        nodeB.nodeType === nodeA.nodeType &&
        nodeB.label.toLowerCase() === nodeA.label.toLowerCase(),
    );

    // Also check that the candidate ID is unique to run B (not in A)
    const validCandidates = candidates.filter(([idB]) => !(idB in nodesA));

    if (validCandidates.length === 1) {
      const [idB] = validCandidates[0]!;
      matched.push({
        nodeIdA: idA,
        nodeIdB: idB,
        nodeType: nodeA.nodeType,
        label: nodeA.label,
      });
      matchedIdsA.add(idA);
      matchedIdsB.add(idB);
    }
  }

  // Build unmatched list
  const unmatched: UnmatchedNode[] = [];
  for (const [id, node] of Object.entries(nodesA)) {
    if (!matchedIdsA.has(id)) {
      unmatched.push({ nodeId: id, nodeType: node.nodeType, label: node.label, presentIn: 'A' });
    }
  }
  for (const [id, node] of Object.entries(nodesB)) {
    if (!matchedIdsB.has(id)) {
      unmatched.push({ nodeId: id, nodeType: node.nodeType, label: node.label, presentIn: 'B' });
    }
  }

  return { matched, unmatched };
}

// ─── Controlled Comparison (Task 535) ────────────────────────────

const OFFERED_LOAD_TOLERANCE = 0.01;

export function determineComparisonLabel(a: BaselineRun, b: BaselineRun): ComparisonLabel {
  const differences: Array<{ attribute: string; valueA: unknown; valueB: unknown }> = [];

  if (a.seed !== b.seed) {
    differences.push({ attribute: 'seed', valueA: a.seed, valueB: b.seed });
  }
  if (a.simulatedDurationMs !== b.simulatedDurationMs) {
    differences.push({
      attribute: 'simulatedDurationMs',
      valueA: a.simulatedDurationMs,
      valueB: b.simulatedDurationMs,
    });
  }
  if (Math.abs(a.totalOfferedRps - b.totalOfferedRps) > OFFERED_LOAD_TOLERANCE) {
    differences.push({
      attribute: 'totalOfferedRps',
      valueA: a.totalOfferedRps,
      valueB: b.totalOfferedRps,
    });
  }

  if (differences.length === 0) {
    return { kind: 'controlled' };
  }
  return { kind: 'uncontrolled', differences };
}

// ─── System Metrics Comparison (Task 531) ────────────────────────

const TERMINAL_STATUS_NAMES = [
  'SUCCESS',
  'TIMEOUT',
  'DROPPED',
  'LOOP_DETECTED',
  'NO_ROUTE',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'RETRY_EXHAUSTED',
  'DEAD_LETTERED',
];

function computeSystemMetrics(a: WholeRunAggregates, b: WholeRunAggregates): MetricDifference[] {
  const diffs: MetricDifference[] = [];

  diffs.push(computeDifference('p50', 'ms', a.latency.p50, b.latency.p50));
  diffs.push(computeDifference('p90', 'ms', a.latency.p90, b.latency.p90));
  diffs.push(computeDifference('p99', 'ms', a.latency.p99, b.latency.p99));
  diffs.push(computeDifference('throughput', 'req/s', a.throughput, b.throughput));
  diffs.push(computeDifference('errorRate', 'fraction', a.errorRate, b.errorRate));

  for (const status of TERMINAL_STATUS_NAMES) {
    const rateA = a.terminalStatusRates[status] ?? 0;
    const rateB = b.terminalStatusRates[status] ?? 0;
    diffs.push(computeDifference(`${status}_rate`, 'fraction', rateA, rateB));
  }

  return diffs;
}

// ─── Per-Node Metrics Comparison (Task 532) ──────────────────────

function computePerNodeMetrics(
  nodeA: PerNodeAggregates,
  nodeB: PerNodeAggregates,
): MetricDifference[] {
  return [
    computeDifference('meanUtilization', 'fraction', nodeA.meanUtilization, nodeB.meanUtilization),
    computeDifference('throughput', 'req/s', nodeA.throughput, nodeB.throughput),
    computeDifference('errorRate', 'fraction', nodeA.errorRate, nodeB.errorRate),
    computeDifference('meanQueueDepth', 'items', nodeA.meanQueueDepth, nodeB.meanQueueDepth),
  ];
}

// ─── Config Differences (Task 534) ──────────────────────────────

function computeConfigDifferences(
  matched: MatchedNode[],
  nodesA: Record<string, PerNodeAggregates>,
  nodesB: Record<string, PerNodeAggregates>,
): ConfigDifference[] {
  const diffs: ConfigDifference[] = [];

  for (const match of matched) {
    const configA = nodesA[match.nodeIdA]?.config ?? {};
    const configB = nodesB[match.nodeIdB]?.config ?? {};
    const allKeys = new Set([...Object.keys(configA), ...Object.keys(configB)]);

    for (const key of allKeys) {
      const vA = configA[key];
      const vB = configB[key];
      if (JSON.stringify(vA) !== JSON.stringify(vB)) {
        diffs.push({
          nodeId: match.nodeIdA,
          label: match.label,
          parameter: key,
          valueA: vA,
          valueB: vB,
        });
      }
    }
  }

  return diffs;
}

// ─── Main Comparison (Task 530) ──────────────────────────────────

/**
 * Compare two baseline runs, designated A and B.
 * Every signed difference is B − A.
 * Returns an error if both selections name the same run.
 */
export function compareRuns(
  selectionA: ComparisonSelection,
  selectionB: ComparisonSelection,
): ComparisonResult | ComparisonError {
  // Same run check
  if (selectionA.name === selectionB.name) {
    return { message: 'Both selections name the same run. Select two different runs to compare.' };
  }

  const runA = selectionA.run;
  const runB = selectionB.run;

  // Comparison label (Task 535)
  const label = determineComparisonLabel(runA, runB);

  // System metrics (Task 531)
  const systemMetrics = computeSystemMetrics(runA.wholeRun, runB.wholeRun);

  // Node matching (Task 533)
  const { matched, unmatched: unmatchedNodes } = matchNodes(runA.perNode, runB.perNode);

  // Per-node metrics (Task 532)
  const perNode: PerNodeDifference[] = matched.map((m) => {
    const nodeA = runA.perNode[m.nodeIdA]!;
    const nodeB = runB.perNode[m.nodeIdB]!;
    return {
      nodeId: m.nodeIdA,
      nodeType: m.nodeType,
      label: m.label,
      metrics: computePerNodeMetrics(nodeA, nodeB),
    };
  });

  // Config differences (Task 534)
  const configDifferences = computeConfigDifferences(matched, runA.perNode, runB.perNode);

  return {
    label,
    nameA: selectionA.name,
    nameB: selectionB.name,
    systemMetrics,
    perNode,
    unmatchedNodes,
    configDifferences,
  };
}

/**
 * Type guard for ComparisonError.
 */
export function isComparisonError(
  result: ComparisonResult | ComparisonError,
): result is ComparisonError {
  return 'message' in result;
}
