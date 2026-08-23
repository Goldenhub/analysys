import type { Finding, EvidenceEntry } from '@/types/findings';
import { SYSTEM_WIDE_SCOPE } from '@/types/findings';
import type { AnalysisContext, NodeMetricsWindow } from '@/analysis/AnalysisWindowStore';
import type { SimulationNode } from '@/types/nodes';
import { FindingBuilder } from '@/analysis/FindingBuilder';
import type { AnalysisRule } from './index';
import { rankNodes } from './bottleneck';

// ─── Constants ───────────────────────────────────────────────────

const YIELD_BATCH_SIZE = 8;
const SATURATION_THRESHOLD = 0.85;

// ─── headroomRule (Tasks 482-486) ────────────────────────────────

/**
 * Reports per-node Headroom as (1 - analysisUtilization) × 100 with the bounding
 * parameter name and its configured value and unit.
 *
 * Reports system Headroom as (0.85 / U - 1) × 100 percent and L × (0.85 / U - 1) RPS,
 * where U is the highest eligible analysisUtilization and L is the offered load.
 *
 * States alongside every numeric figure that it assumes proportional growth of the
 * highest-utilization node and that no other node saturates sooner, and that a
 * Capacity_Sweep produces a measured Sustainable_Load in its place (Task 486).
 */
export const headroomRule: AnalysisRule = {
  id: 'capacity.headroom',
  category: 'Capacity',
  requiredMetrics: ['utilization'],

  *evaluate(ctx: AnalysisContext): Generator<void, Finding[], void> {
    const completed = ctx.windows.filter((w) => w.durationMs > 0);
    if (completed.length < 3) return [];

    const findings: Finding[] = [];

    // ─── Per-Node Headroom (Tasks 482-483) ─────────────────────

    const ranked = rankNodes(ctx);
    let yielded = 0;

    for (const node of ranked) {
      const nodeId = node.nodeId;
      const util = node.utilization;

      // Not applicable: utilization is not-applicable or zero arrivals (Task 483)
      if (util === null) {
        yielded++;
        if (yielded % YIELD_BATCH_SIZE === 0) yield;
        continue;
      }

      // Check arrivals
      let totalArrivals = 0;
      const recent3 = completed.slice(-3);
      for (const w of recent3) {
        const n = w.nodes.find((nd) => nd.nodeId === nodeId);
        if (n) totalArrivals += n.arrivalCount;
      }

      if (totalArrivals < 1) {
        yielded++;
        if (yielded % YIELD_BATCH_SIZE === 0) yield;
        continue;
      }

      const headroomPct = (1 - util) * 100;
      const topoNode = ctx.topology.nodes.find((n) => n.id === nodeId);
      const boundParam = getBoundingParam(topoNode);
      const completedCount = ctx.cumulative.nodeCompletedCounts.get(nodeId) ?? 0;
      const steady = ctx.steadyStateMap.get(nodeId)?.isSteady ?? false;
      const lastWindow = completed[completed.length - 1]!;

      const evidence: EvidenceEntry[] = [
        { metricName: 'headroom', value: headroomPct, unit: 'percent', scope: nodeId, primary: true },
        { metricName: 'analysisUtilization', value: util, unit: 'fraction', scope: nodeId },
      ];
      if (boundParam) {
        evidence.push({ metricName: 'boundingParameter', value: boundParam.value, unit: boundParam.unit, scope: nodeId });
      }

      findings.push(
        FindingBuilder.build({
          ruleId: 'capacity.headroom',
          category: 'Capacity',
          severity: 'Info',
          subjectNodeIds: [nodeId],
          evidence,
          constraint: boundParam
            ? `${ctx.labelOf(nodeId)} bounded by ${boundParam.parameter} at ${String(boundParam.value)} ${boundParam.unit}`
            : `${ctx.labelOf(nodeId)} headroom from current utilization`,
          action: {
            nodeId,
            parameter: boundParam?.parameter ?? 'capacity',
            direction: 'increase',
          },
          tradeoff: 'Assumes proportional growth of the highest-utilization node and that no other node saturates sooner; a Capacity_Sweep produces a measured Sustainable_Load in its place',
          lowestCompletedCount: completedCount,
          allSubjectsInSteadyState: steady,
          window: { startMs: lastWindow.startMs, endMs: lastWindow.endMs },
        }),
      );

      yielded++;
      if (yielded % YIELD_BATCH_SIZE === 0) yield;
    }

    // ─── System Headroom (Tasks 484-486) ───────────────────────

    yield;

    const systemFinding = computeSystemHeadroom(ctx, completed);
    if (systemFinding) {
      findings.push(systemFinding);
    }

    return findings;
  },
};

// ─── System Headroom ─────────────────────────────────────────────

function computeSystemHeadroom(
  ctx: AnalysisContext,
  completed: readonly NodeMetricsWindow[],
): Finding | null {
  const recent3 = completed.slice(-3);

  // Precondition: fewer than 3 windows
  if (recent3.length < 3) {
    return buildNotApplicableFinding(ctx, completed, 'fewer than 3 completed windows');
  }

  // Find the eligible node with highest utilization (U)
  const ranked = rankNodes(ctx);
  const eligible = ranked.filter((n) => n.eligible && n.utilization !== null);

  // Precondition: no eligible node
  if (eligible.length === 0) {
    return buildNotApplicableFinding(ctx, completed, 'no node is eligible');
  }

  const holdingNode = eligible[0]!;
  const U = holdingNode.utilization!;

  // Precondition: U is 0.0
  if (U === 0) {
    return buildNotApplicableFinding(ctx, completed, 'highest utilization U is 0.0');
  }

  // Compute offered load over the analysis window
  let totalThroughput = 0;
  for (const w of recent3) {
    totalThroughput += w.systemWide.totalThroughput;
  }
  const totalDurationMs = recent3.reduce((s, w) => s + w.durationMs, 0);
  const offeredLoadRps = totalDurationMs > 0 ? (totalThroughput / totalDurationMs) * 1000 : 0;

  // Precondition: offered load is 0 RPS
  if (offeredLoadRps === 0) {
    return buildNotApplicableFinding(ctx, completed, 'offered load is 0 RPS');
  }

  const lastWindow = completed[completed.length - 1]!;
  const completedCount = ctx.cumulative.systemCompletedCount;

  // Task 485: at or above 0.85 → 0 percent and 0 RPS
  if (U >= SATURATION_THRESHOLD) {
    return FindingBuilder.build({
      ruleId: 'capacity.headroom',
      category: 'Capacity',
      severity: 'Info',
      subjectNodeIds: [],
      evidence: [
        { metricName: 'systemHeadroomPct', value: 0, unit: 'percent', scope: SYSTEM_WIDE_SCOPE, primary: true },
        { metricName: 'systemHeadroomRps', value: 0, unit: 'req/s', scope: SYSTEM_WIDE_SCOPE },
        { metricName: 'holdingNodeUtilization', value: U, unit: 'fraction', scope: holdingNode.nodeId },
      ],
      constraint: `${ctx.labelOf(holdingNode.nodeId)} at ${(U * 100).toFixed(1)}% utilization; system at capacity`,
      action: {
        nodeId: holdingNode.nodeId,
        parameter: 'capacity',
        direction: 'increase',
      },
      tradeoff: 'Assumes proportional growth of the highest-utilization node and that no other node saturates sooner; a Capacity_Sweep produces a measured Sustainable_Load in its place',
      lowestCompletedCount: completedCount,
      allSubjectsInSteadyState: false,
      window: { startMs: lastWindow.startMs, endMs: lastWindow.endMs },
    });
  }

  // Task 484: normal system headroom
  const headroomFraction = (SATURATION_THRESHOLD / U) - 1;
  const headroomPct = headroomFraction * 100;
  const headroomRps = offeredLoadRps * headroomFraction;

  return FindingBuilder.build({
    ruleId: 'capacity.headroom',
    category: 'Capacity',
    severity: 'Info',
    subjectNodeIds: [],
    evidence: [
      { metricName: 'systemHeadroomPct', value: headroomPct, unit: 'percent', scope: SYSTEM_WIDE_SCOPE, primary: true },
      { metricName: 'systemHeadroomRps', value: headroomRps, unit: 'req/s', scope: SYSTEM_WIDE_SCOPE },
      { metricName: 'holdingNodeUtilization', value: U, unit: 'fraction', scope: holdingNode.nodeId },
      { metricName: 'offeredLoad', value: offeredLoadRps, unit: 'req/s', scope: SYSTEM_WIDE_SCOPE },
    ],
    constraint: `${ctx.labelOf(holdingNode.nodeId)} holds at ${(U * 100).toFixed(1)}% utilization with offered load ${offeredLoadRps.toFixed(1)} RPS`,
    action: {
      nodeId: holdingNode.nodeId,
      parameter: 'capacity',
      direction: 'increase',
    },
    tradeoff: 'Assumes proportional growth of the highest-utilization node and that no other node saturates sooner; a Capacity_Sweep produces a measured Sustainable_Load in its place',
    lowestCompletedCount: completedCount,
    allSubjectsInSteadyState: false,
    window: { startMs: lastWindow.startMs, endMs: lastWindow.endMs },
  });
}

function buildNotApplicableFinding(
  ctx: AnalysisContext,
  completed: readonly NodeMetricsWindow[],
  reason: string,
): Finding {
  const lastWindow = completed[completed.length - 1];
  const window = lastWindow
    ? { startMs: lastWindow.startMs, endMs: lastWindow.endMs }
    : { startMs: 0, endMs: 0 };

  return FindingBuilder.build({
    ruleId: 'capacity.headroom',
    category: 'Capacity',
    severity: 'Info',
    subjectNodeIds: [],
    evidence: [
      { metricName: 'systemHeadroomPct', value: 0, unit: 'percent', scope: SYSTEM_WIDE_SCOPE, primary: true },
    ],
    constraint: `System headroom not applicable: ${reason}`,
    action: {
      nodeId: '',
      parameter: 'capacity',
      direction: 'increase',
    },
    tradeoff: 'Assumes proportional growth of the highest-utilization node and that no other node saturates sooner; a Capacity_Sweep produces a measured Sustainable_Load in its place',
    lowestCompletedCount: ctx.cumulative.systemCompletedCount,
    allSubjectsInSteadyState: false,
    window,
  });
}

// ─── Helpers ─────────────────────────────────────────────────────

function getBoundingParam(
  node: SimulationNode | undefined | null,
): { parameter: string; value: number; unit: string } | null {
  if (!node) return null;
  switch (node.nodeType) {
    case 'APP_SERVER':
      return { parameter: 'workerThreadPoolSize', value: node.config.workerThreadPoolSize, unit: 'threads' };
    case 'DATABASE':
      return { parameter: 'connectionPoolSize', value: node.config.connectionPoolSize, unit: 'connections' };
    case 'RATE_LIMITER':
      return { parameter: 'refillRatePerSec', value: node.config.refillRatePerSec, unit: 'req/s' };
    case 'AUTH_SERVICE':
      return { parameter: 'concurrencyLimit', value: node.config.concurrencyLimit, unit: 'slots' };
    case 'AUTHZ_SERVICE':
      return { parameter: 'concurrencyLimit', value: node.config.concurrencyLimit, unit: 'slots' };
    case 'WORKER_POOL':
      return { parameter: 'concurrency', value: node.config.concurrency, unit: 'slots' };
    case 'MESSAGE_QUEUE':
      return { parameter: 'bufferCapacity', value: node.config.bufferCapacity, unit: 'messages' };
    case 'OBJECT_STORE':
      return { parameter: 'maxConcurrentTransfers', value: node.config.maxConcurrentTransfers, unit: 'transfers' };
    default:
      return null;
  }
}
