import type { Finding, EvidenceEntry } from '@/types/findings';
import { SYSTEM_WIDE_SCOPE } from '@/types/findings';
import type { AnalysisContext, NodeMetricsWindow } from '@/analysis/AnalysisWindowStore';
import { FindingBuilder } from '@/analysis/FindingBuilder';
import type { AnalysisRule } from './index';
import type { SimulationNode } from '@/types/nodes';

// ─── Constants ───────────────────────────────────────────────────

/** Yield every N nodes to keep main-thread occupancy ≤33 ms (R41.9, Task 488). */
const YIELD_BATCH_SIZE = 8;

/** Utilization threshold for Bottleneck designation (R36.2). */
const BOTTLENECK_THRESHOLD = 0.85;

/** Tie-break tolerance for utilization ranking (R36.1). */
const UTILIZATION_TOLERANCE = 0.001;

/** Co-limiting proximity threshold (R36.3). */
const CO_LIMITING_THRESHOLD = 0.05;

/** No-constraint upper bound (R36.4). */
const NO_CONSTRAINT_THRESHOLD = 0.6;

// ─── Analysis Utilization (Task 465) ─────────────────────────────

/**
 * Compute Analysis_Utilization: arithmetic mean of per-window numeric utilization
 * over the 3 most recently completed windows.
 *
 * Returns null if the node has fewer than 3 numeric readings in the most recent
 * 3 completed windows.
 */
export function analysisUtilization(
  nodeId: string,
  windows: readonly NodeMetricsWindow[],
): number | null {
  // Completed windows are those with durationMs > 0
  const completed = windows.filter((w) => w.durationMs > 0);
  const recent3 = completed.slice(-3);
  if (recent3.length < 3) return null;

  const values: number[] = [];
  for (const w of recent3) {
    const node = w.nodes.find((n) => n.nodeId === nodeId);
    if (!node) return null;
    if (node.utilization.kind !== 'value') return null;
    values.push(node.utilization.value);
  }

  if (values.length < 3) return null;
  return (values[0]! + values[1]! + values[2]!) / 3;
}

// ─── Latency Share (Task 465) ────────────────────────────────────

/**
 * Compute Latency_Share: timeInSystemAtNodeMs / pathTimeInSystemMs × 100.
 * Returns null (not applicable) when pathTimeInSystemMs is 0.
 */
export function latencyShare(nodeId: string, windows: readonly NodeMetricsWindow[]): number | null {
  const completed = windows.filter((w) => w.durationMs > 0);
  const recent3 = completed.slice(-3);
  if (recent3.length < 3) return null;

  let totalTimeAtNode = 0;
  let totalPathTime = 0;
  for (const w of recent3) {
    const node = w.nodes.find((n) => n.nodeId === nodeId);
    if (!node) return null;
    totalTimeAtNode += node.timeInSystemAtNodeMs;
    totalPathTime += node.pathTimeInSystemMs;
  }

  if (totalPathTime === 0) return null;
  return (totalTimeAtNode / totalPathTime) * 100;
}

// ─── Ranking (Task 466) ──────────────────────────────────────────

export interface RankedNode {
  nodeId: string;
  utilization: number | null;
  latencySharePct: number | null;
  throughput: number;
  eligible: boolean;
  exclusionReason: string | null;
}

/**
 * Compute throughput as the sum over the 3 most recent completed windows.
 */
function nodeThroughput(nodeId: string, windows: readonly NodeMetricsWindow[]): number {
  const completed = windows.filter((w) => w.durationMs > 0);
  const recent3 = completed.slice(-3);
  let total = 0;
  for (const w of recent3) {
    const node = w.nodes.find((n) => n.nodeId === nodeId);
    if (node) total += node.throughput;
  }
  return total;
}

/**
 * Check eligibility: numeric utilization reading + ≥1 arrival in the analysis window.
 * A node stays eligible at 0 throughput (Task 468).
 */
function checkEligibility(
  nodeId: string,
  windows: readonly NodeMetricsWindow[],
): { eligible: boolean; reason: string | null } {
  const completed = windows.filter((w) => w.durationMs > 0);
  const recent3 = completed.slice(-3);
  if (recent3.length < 3) return { eligible: false, reason: 'fewer than 3 completed windows' };

  // Check numeric utilization
  let hasNumericUtil = true;
  for (const w of recent3) {
    const node = w.nodes.find((n) => n.nodeId === nodeId);
    if (!node) return { eligible: false, reason: 'node not present in window' };
    if (node.utilization.kind !== 'value') {
      hasNumericUtil = false;
      break;
    }
  }
  if (!hasNumericUtil) {
    return { eligible: false, reason: 'not-applicable utilization' };
  }

  // Check ≥1 arrival across the 3 windows
  let totalArrivals = 0;
  for (const w of recent3) {
    const node = w.nodes.find((n) => n.nodeId === nodeId);
    if (node) totalArrivals += node.arrivalCount;
  }
  if (totalArrivals < 1) {
    return { eligible: false, reason: 'zero arrivals' };
  }

  return { eligible: true, reason: null };
}

/**
 * Rank all nodes by the total order: descending utilization (within 0.001 tolerance),
 * then descending latencyShare, then descending throughput, then ascending node ID.
 */
export function rankNodes(ctx: AnalysisContext): RankedNode[] {
  const nodeIds = new Set<string>();
  for (const w of ctx.windows) {
    for (const n of w.nodes) nodeIds.add(n.nodeId);
  }

  const ranked: RankedNode[] = [];
  for (const nodeId of nodeIds) {
    const util = analysisUtilization(nodeId, ctx.windows);
    const ls = latencyShare(nodeId, ctx.windows);
    const tp = nodeThroughput(nodeId, ctx.windows);
    const elig = checkEligibility(nodeId, ctx.windows);
    ranked.push({
      nodeId,
      utilization: util,
      latencySharePct: ls,
      throughput: tp,
      eligible: elig.eligible,
      exclusionReason: elig.reason,
    });
  }

  ranked.sort((a, b) => {
    // Descending utilization (nulls last)
    const aUtil = a.utilization ?? -1;
    const bUtil = b.utilization ?? -1;
    if (Math.abs(aUtil - bUtil) > UTILIZATION_TOLERANCE) {
      return bUtil - aUtil;
    }
    // Tie-break: descending latencyShare (nulls last)
    const aLs = a.latencySharePct ?? -1;
    const bLs = b.latencySharePct ?? -1;
    if (aLs !== bLs) return bLs - aLs;
    // Tie-break: descending throughput
    if (a.throughput !== b.throughput) return b.throughput - a.throughput;
    // Tie-break: ascending node ID
    return a.nodeId.localeCompare(b.nodeId);
  });

  return ranked;
}

// ─── Helper: get bounding parameter for a node ───────────────────

function getBoundingParameter(
  nodeId: string,
  ctx: AnalysisContext,
): { parameter: string; value: number; unit: string } | null {
  const node = ctx.topology.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  return getBoundingParamForNode(node);
}

function getBoundingParamForNode(
  node: SimulationNode,
): { parameter: string; value: number; unit: string } | null {
  switch (node.nodeType) {
    case 'APP_SERVER':
      return {
        parameter: 'workerThreadPoolSize',
        value: node.config.workerThreadPoolSize,
        unit: 'threads',
      };
    case 'DATABASE':
      return {
        parameter: 'connectionPoolSize',
        value: node.config.connectionPoolSize,
        unit: 'connections',
      };
    case 'RATE_LIMITER':
      return { parameter: 'refillRatePerSec', value: node.config.refillRatePerSec, unit: 'req/s' };
    case 'CACHE':
      return { parameter: 'hitRatio', value: node.config.hitRatio, unit: 'fraction' };
    case 'AUTH_SERVICE':
      return { parameter: 'concurrencyLimit', value: node.config.concurrencyLimit, unit: 'slots' };
    case 'AUTHZ_SERVICE':
      return { parameter: 'concurrencyLimit', value: node.config.concurrencyLimit, unit: 'slots' };
    case 'WORKER_POOL':
      return { parameter: 'concurrency', value: node.config.concurrency, unit: 'slots' };
    case 'MESSAGE_QUEUE':
      return { parameter: 'bufferCapacity', value: node.config.bufferCapacity, unit: 'messages' };
    case 'OBJECT_STORE':
      return {
        parameter: 'maxConcurrentTransfers',
        value: node.config.maxConcurrentTransfers,
        unit: 'transfers',
      };
    case 'CIRCUIT_BREAKER':
      return { parameter: 'probeCount', value: node.config.probeCount, unit: 'requests' };
    default:
      return null;
  }
}

// ─── Helper: get lowest completed count for subject nodes ────────

function lowestCompletedCount(nodeIds: string[], ctx: AnalysisContext): number {
  if (nodeIds.length === 0) return ctx.cumulative.systemCompletedCount;
  let min = Infinity;
  for (const id of nodeIds) {
    const count = ctx.cumulative.nodeCompletedCounts.get(id) ?? 0;
    if (count < min) min = count;
  }
  return min === Infinity ? 0 : min;
}

/** Check if all subjects are in steady state. */
function allSubjectsSteady(nodeIds: string[], ctx: AnalysisContext): boolean {
  for (const id of nodeIds) {
    const status = ctx.steadyStateMap.get(id);
    if (!status?.isSteady) return false;
  }
  return true;
}

/** Get the last window span. */
function lastWindowSpan(ctx: AnalysisContext): { startMs: number; endMs: number } {
  const completed = ctx.windows.filter((w) => w.durationMs > 0);
  const last = completed[completed.length - 1];
  if (!last) return { startMs: 0, endMs: 0 };
  return { startMs: last.startMs, endMs: last.endMs };
}

// ─── bottleneckRankRule (Task 467) ───────────────────────────────

export const bottleneckRankRule: AnalysisRule = {
  id: 'bottleneck.rank',
  category: 'Bottleneck',
  requiredMetrics: ['utilization'],

  *evaluate(ctx: AnalysisContext): Generator<void, Finding[], void> {
    const ranked = rankNodes(ctx);
    const eligible = ranked.filter((n) => n.eligible);

    if (eligible.length === 0) return [];

    // Find the designated node: highest utilization ≥0.85, else greatest latencyShare
    let designated: RankedNode;
    let selectionRule: 'utilization' | 'latencyShare';

    const saturated = eligible.filter(
      (n) => n.utilization !== null && n.utilization >= BOTTLENECK_THRESHOLD,
    );
    if (saturated.length > 0) {
      designated = saturated[0]!; // Already sorted by ranking
      selectionRule = 'utilization';
    } else {
      // Greatest latencyShare among eligible
      const withLs = eligible.filter((n) => n.latencySharePct !== null);
      if (withLs.length > 0) {
        withLs.sort((a, b) => (b.latencySharePct ?? 0) - (a.latencySharePct ?? 0));
        designated = withLs[0]!;
        selectionRule = 'latencyShare';
      } else {
        // Fall back to the first eligible by ranking
        designated = eligible[0]!;
        selectionRule = 'utilization';
      }
    }

    yield; // Yield after ranking computation

    const nodeId = designated.nodeId;
    const util = designated.utilization ?? 0;
    const ls = designated.latencySharePct ?? 0;
    const tp = designated.throughput;
    const bounding = getBoundingParameter(nodeId, ctx);
    const completedCount = lowestCompletedCount([nodeId], ctx);
    const steady = allSubjectsSteady([nodeId], ctx);
    const window = lastWindowSpan(ctx);

    // Build the 6 evidence entries
    const evidence: EvidenceEntry[] = [
      {
        metricName: 'analysisUtilization',
        value: util,
        unit: 'fraction',
        scope: nodeId,
        primary: true,
      },
      { metricName: 'latencyShare', value: ls, unit: 'percent', scope: nodeId },
      { metricName: 'throughput', value: tp, unit: 'req/s', scope: nodeId },
      {
        metricName: 'selectionRule',
        value: selectionRule === 'utilization' ? 1 : 0,
        unit: 'flag',
        scope: nodeId,
      },
      {
        metricName: 'boundingParameter',
        value: bounding?.value ?? 0,
        unit: bounding?.unit ?? 'n/a',
        scope: nodeId,
      },
      { metricName: 'completedCount', value: completedCount, unit: 'requests', scope: nodeId },
    ];

    const constraint = bounding
      ? `${ctx.labelOf(nodeId)} bounded by ${bounding.parameter} at ${String(bounding.value)} ${bounding.unit}`
      : `${ctx.labelOf(nodeId)} is the highest-utilization eligible node`;

    const tradeoff = `Reducing ${ctx.labelOf(nodeId)}'s contribution to 0 ms reduces end-to-end p99 by at most ${ls.toFixed(1)}%`;

    const severity = util >= BOTTLENECK_THRESHOLD ? ('Critical' as const) : ('Warning' as const);

    const finding = FindingBuilder.build({
      ruleId: 'bottleneck.rank',
      category: 'Bottleneck',
      severity,
      subjectNodeIds: [nodeId],
      evidence,
      constraint,
      action: {
        nodeId,
        parameter: bounding?.parameter ?? 'capacity',
        direction: 'increase',
        ...(bounding ? { targetValue: { value: bounding.value * 2, unit: bounding.unit } } : {}),
      },
      tradeoff,
      lowestCompletedCount: completedCount,
      allSubjectsInSteadyState: steady,
      window,
    });

    return [finding];
  },
};

// ─── bottleneckCoLimitingRule (Task 469) ─────────────────────────

export const bottleneckCoLimitingRule: AnalysisRule = {
  id: 'bottleneck.co-limiting',
  category: 'Bottleneck',
  requiredMetrics: ['utilization'],

  *evaluate(ctx: AnalysisContext): Generator<void, Finding[], void> {
    const ranked = rankNodes(ctx);
    const eligible = ranked.filter((n) => n.eligible);

    // Find the saturated bottleneck first
    const saturated = eligible.filter(
      (n) => n.utilization !== null && n.utilization >= BOTTLENECK_THRESHOLD,
    );
    if (saturated.length === 0) return [];

    const bottleneck = saturated[0]!;
    const bottleneckUtil = bottleneck.utilization!;

    // Find co-limiting nodes: within 0.05 of the bottleneck but not the bottleneck itself
    const coLimiting = eligible.filter(
      (n) =>
        n.nodeId !== bottleneck.nodeId &&
        n.utilization !== null &&
        n.utilization >= BOTTLENECK_THRESHOLD &&
        Math.abs(n.utilization - bottleneckUtil) <= CO_LIMITING_THRESHOLD,
    );

    if (coLimiting.length === 0) return [];

    const findings: Finding[] = [];
    let yielded = 0;

    for (const node of coLimiting) {
      const bounding = getBoundingParameter(node.nodeId, ctx);
      const completedCount = lowestCompletedCount([node.nodeId], ctx);
      const steady = allSubjectsSteady([node.nodeId], ctx);
      const window = lastWindowSpan(ctx);

      const evidence: EvidenceEntry[] = [
        {
          metricName: 'analysisUtilization',
          value: node.utilization!,
          unit: 'fraction',
          scope: node.nodeId,
          primary: true,
        },
        {
          metricName: 'latencyShare',
          value: node.latencySharePct ?? 0,
          unit: 'percent',
          scope: node.nodeId,
        },
        {
          metricName: 'bottleneckUtilization',
          value: bottleneckUtil,
          unit: 'fraction',
          scope: bottleneck.nodeId,
        },
      ];

      const constraint = bounding
        ? `${ctx.labelOf(node.nodeId)} bounded by ${bounding.parameter} at ${String(bounding.value)} ${bounding.unit}`
        : `${ctx.labelOf(node.nodeId)} co-limits with the bottleneck`;

      findings.push(
        FindingBuilder.build({
          ruleId: 'bottleneck.co-limiting',
          category: 'Bottleneck',
          severity: 'Warning',
          subjectNodeIds: [node.nodeId],
          evidence,
          constraint,
          action: {
            nodeId: node.nodeId,
            parameter: bounding?.parameter ?? 'capacity',
            direction: 'increase',
          },
          tradeoff: `Addressing ${ctx.labelOf(node.nodeId)} alone will not improve throughput while ${ctx.labelOf(bottleneck.nodeId)} also saturates`,
          lowestCompletedCount: completedCount,
          allSubjectsInSteadyState: steady,
          window,
        }),
      );

      yielded++;
      if (yielded % YIELD_BATCH_SIZE === 0) yield;
    }

    return findings;
  },
};

// ─── bottleneckNoConstraintRule (Task 469) ───────────────────────

export const bottleneckNoConstraintRule: AnalysisRule = {
  id: 'bottleneck.no-constraint',
  category: 'Bottleneck',
  requiredMetrics: ['utilization'],

  *evaluate(ctx: AnalysisContext): Generator<void, Finding[], void> {
    const ranked = rankNodes(ctx);
    const eligible = ranked.filter((n) => n.eligible);

    if (eligible.length === 0) return [];

    // Check: every applicable (eligible) node below 0.60
    const allBelow = eligible.every(
      (n) => n.utilization !== null && n.utilization < NO_CONSTRAINT_THRESHOLD,
    );
    if (!allBelow) return [];

    // Also require no instability (check if any node has growing depth)
    // For simplicity, check that there's no depth growth in the windows
    const hasInstability = checkAnyInstability(ctx);
    if (hasInstability) return [];

    yield;

    const window = lastWindowSpan(ctx);
    const completedCount = lowestCompletedCount([], ctx);
    const steady = allSubjectsSteady(
      eligible.map((n) => n.nodeId),
      ctx,
    );

    const finding = FindingBuilder.build({
      ruleId: 'bottleneck.no-constraint',
      category: 'Bottleneck',
      severity: 'Info',
      subjectNodeIds: [],
      evidence: [
        {
          metricName: 'maxUtilization',
          value: eligible[0]?.utilization ?? 0,
          unit: 'fraction',
          scope: SYSTEM_WIDE_SCOPE,
          primary: true,
        },
      ],
      constraint: 'No node exceeds 60% utilization and no instability detected',
      action: {
        nodeId: eligible[0]?.nodeId ?? '',
        parameter: 'capacity',
        direction: 'increase',
      },
      tradeoff: 'System has headroom; increasing load may be safe',
      lowestCompletedCount: completedCount,
      allSubjectsInSteadyState: steady,
      window,
    });

    return [finding];
  },
};

/** Check if any node has depth instability (simplified check for the no-constraint rule). */
function checkAnyInstability(ctx: AnalysisContext): boolean {
  const completed = ctx.windows.filter((w) => w.durationMs > 0);
  if (completed.length < 5) return false;

  const recent5 = completed.slice(-5);
  const nodeIds = new Set<string>();
  for (const w of recent5) {
    for (const n of w.nodes) {
      if (n.monitoredDepth !== null) nodeIds.add(n.nodeId);
    }
  }

  for (const nodeId of nodeIds) {
    const depths: number[] = [];
    for (const w of recent5) {
      const node = w.nodes.find((n) => n.nodeId === nodeId);
      if (node?.monitoredDepth !== null && node?.monitoredDepth !== undefined) {
        depths.push(node.monitoredDepth);
      }
    }
    if (depths.length === 5) {
      // Check 4 consecutive increases
      let allIncreasing = true;
      for (let i = 1; i < depths.length; i++) {
        if (depths[i]! <= depths[i - 1]!) {
          allIncreasing = false;
          break;
        }
      }
      if (allIncreasing) {
        const growth = depths[4]! - depths[0]!;
        if (depths[0]! > 0 && growth >= depths[0]! * 0.2) {
          return true;
        }
      }
    }
  }
  return false;
}

// ─── bottleneckNoneEligibleRule (Task 470) ───────────────────────

export const bottleneckNoneEligibleRule: AnalysisRule = {
  id: 'bottleneck.none-eligible',
  category: 'Bottleneck',
  requiredMetrics: [],

  *evaluate(ctx: AnalysisContext): Generator<void, Finding[], void> {
    // Require minimum 3 completed windows before emitting any Finding
    const completed = ctx.windows.filter((w) => w.durationMs > 0);
    if (completed.length < 3) return [];

    const ranked = rankNodes(ctx);
    const eligible = ranked.filter((n) => n.eligible);

    // Only emit when no node is eligible
    if (eligible.length > 0) return [];

    yield;

    const excluded = ranked.filter((n) => !n.eligible);
    const naCount = excluded.filter(
      (n) => n.exclusionReason === 'not-applicable utilization',
    ).length;
    const zeroArrivalCount = excluded.filter((n) => n.exclusionReason === 'zero arrivals').length;

    const window = lastWindowSpan(ctx);
    const completedCount = lowestCompletedCount([], ctx);

    const finding = FindingBuilder.build({
      ruleId: 'bottleneck.none-eligible',
      category: 'Bottleneck',
      severity: 'Info',
      subjectNodeIds: [],
      evidence: [
        {
          metricName: 'excludedNotApplicable',
          value: naCount,
          unit: 'nodes',
          scope: SYSTEM_WIDE_SCOPE,
          primary: true,
        },
        {
          metricName: 'excludedZeroArrivals',
          value: zeroArrivalCount,
          unit: 'nodes',
          scope: SYSTEM_WIDE_SCOPE,
        },
      ],
      constraint: `${String(naCount)} excluded for not-applicable utilization, ${String(zeroArrivalCount)} excluded for zero arrivals`,
      action: {
        nodeId: '',
        parameter: 'capacity',
        direction: 'increase',
      },
      tradeoff: 'No bottleneck can be identified; consider reviewing node configurations',
      lowestCompletedCount: completedCount,
      allSubjectsInSteadyState: false,
      window,
    });

    return [finding];
  },
};
