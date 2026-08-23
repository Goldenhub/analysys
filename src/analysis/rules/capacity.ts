import type { Finding } from '@/types/findings';
import type { AnalysisContext } from '@/analysis/AnalysisWindowStore';
import { FindingBuilder } from '@/analysis/FindingBuilder';
import type { AnalysisRule } from './index';
import { getLittlesLawUnstableNodes } from './instability';
import type { SweepStepResult, KneePointResult } from '@/analysis/CapacitySweepController';

// ─── Constants ───────────────────────────────────────────────────

const YIELD_BATCH_SIZE = 8;
const MAX_WORKER_POOL_CONCURRENCY = 10_000;

// ─── workerPoolConcurrencyRule (Task 478) ────────────────────────

/**
 * Computes required concurrency as arrival rate × mean processing time (in seconds),
 * rounded up. Names the configured concurrency and the 10,000 maximum where the
 * computed value exceeds it. Gated on at least 1 completed attempt in the window span.
 *
 * Suppressed for nodes with Little's Law instability (Task 475).
 */
export const workerPoolConcurrencyRule: AnalysisRule = {
  id: 'capacity.worker-pool-concurrency',
  category: 'Capacity',
  requiredMetrics: ['utilization'],

  *evaluate(ctx: AnalysisContext): Generator<void, Finding[], void> {
    const completed = ctx.windows.filter((w) => w.durationMs > 0);
    if (completed.length < 3) return [];

    const recent3 = completed.slice(-3);
    const unstableNodes = getLittlesLawUnstableNodes(ctx);

    // Find Worker Pool nodes
    const wpNodes = ctx.topology.nodes.filter((n) => n.nodeType === 'WORKER_POOL');
    if (wpNodes.length === 0) return [];

    const findings: Finding[] = [];
    let yielded = 0;

    for (const wpNode of wpNodes) {
      const nodeId = wpNode.id;

      // Suppressed by Little's Law instability
      if (unstableNodes.has(nodeId)) {
        yielded++;
        if (yielded % YIELD_BATCH_SIZE === 0) yield;
        continue;
      }

      // Gate: at least 1 completed attempt in the window span
      const completedCount = ctx.cumulative.nodeCompletedCounts.get(nodeId) ?? 0;
      if (completedCount < 1) {
        yielded++;
        if (yielded % YIELD_BATCH_SIZE === 0) yield;
        continue;
      }

      // Compute arrival rate over the 3 windows
      let totalArrivals = 0;
      let totalDurationMs = 0;
      for (const w of recent3) {
        const node = w.nodes.find((n) => n.nodeId === nodeId);
        if (node) {
          totalArrivals += node.arrivalCount;
          totalDurationMs += w.durationMs;
        }
      }

      if (totalArrivals < 1) {
        yielded++;
        if (yielded % YIELD_BATCH_SIZE === 0) yield;
        continue;
      }

      const arrivalRatePerSec = totalDurationMs > 0 ? (totalArrivals / totalDurationMs) * 1000 : 0;

      // Get mean processing time from config
      const config = wpNode.config as { concurrency: number; jobProcessingMeanMs: number };
      const meanProcessingTimeSec = config.jobProcessingMeanMs / 1000;
      const configuredConcurrency = config.concurrency;

      // Required concurrency = ceil(arrivalRate × meanProcessingTime)
      let requiredConcurrency = Math.ceil(arrivalRatePerSec * meanProcessingTimeSec);
      const exceedsMax = requiredConcurrency > MAX_WORKER_POOL_CONCURRENCY;
      if (exceedsMax) {
        requiredConcurrency = MAX_WORKER_POOL_CONCURRENCY;
      }

      // Only emit if required > configured
      if (requiredConcurrency <= configuredConcurrency) {
        yielded++;
        if (yielded % YIELD_BATCH_SIZE === 0) yield;
        continue;
      }

      const steady = ctx.steadyStateMap.get(nodeId)?.isSteady ?? false;
      const lastWindow = completed[completed.length - 1]!;

      const constraint = exceedsMax
        ? `${ctx.labelOf(nodeId)} requires ${String(requiredConcurrency)} concurrency (capped at ${String(MAX_WORKER_POOL_CONCURRENCY)} maximum), configured at ${String(configuredConcurrency)} slots`
        : `${ctx.labelOf(nodeId)} requires ${String(requiredConcurrency)} concurrency, configured at ${String(configuredConcurrency)} slots`;

      findings.push(
        FindingBuilder.build({
          ruleId: 'capacity.worker-pool-concurrency',
          category: 'Capacity',
          severity: 'Warning',
          subjectNodeIds: [nodeId],
          evidence: [
            { metricName: 'requiredConcurrency', value: requiredConcurrency, unit: 'slots', scope: nodeId, primary: true },
            { metricName: 'configuredConcurrency', value: configuredConcurrency, unit: 'slots', scope: nodeId },
            { metricName: 'arrivalRate', value: arrivalRatePerSec, unit: 'req/s', scope: nodeId },
            { metricName: 'meanProcessingTime', value: meanProcessingTimeSec, unit: 's', scope: nodeId },
          ],
          constraint,
          action: {
            nodeId,
            parameter: 'concurrency',
            direction: 'increase',
            targetValue: { value: Math.min(requiredConcurrency, MAX_WORKER_POOL_CONCURRENCY), unit: 'slots' },
          },
          tradeoff: `Increasing concurrency at ${ctx.labelOf(nodeId)} consumes more memory per active job`,
          lowestCompletedCount: completedCount,
          allSubjectsInSteadyState: steady,
          window: { startMs: lastWindow.startMs, endMs: lastWindow.endMs },
        }),
      );

      yielded++;
      if (yielded % YIELD_BATCH_SIZE === 0) yield;
    }

    return findings;
  },
};

// ─── Sweep Knee Rule (Task 505) ──────────────────────────────────

/**
 * Context for the sweepKneeRule: saturation and utilization data from
 * the Knee_Point step.
 */
export interface SweepKneeContext {
  kneePoint: KneePointResult;
  kneeStepResult: SweepStepResult;
  /** Per-node utilization at the knee step (from the step's final analysis window). */
  nodeUtilizations: Map<string, number>;
  /** Nodes that reached saturation (utilization ≥ 0.85) during the knee step. */
  saturatedNodes: Array<{ nodeId: string; utilization: number; boundParam: string; boundValue: number }>;
  /** Service objective. */
  objective: { maxP99LatencyMs: number; maxErrorRate: number };
}

/**
 * Emit a Capacity Finding naming the node that reached Saturation earliest during
 * the Knee_Point step, with its bounding parameter and configured value.
 *
 * Where no node saturated, names the node holding the highest analysis Utilization
 * plus which Service_Objective condition was violated with its observed value and
 * configured limit.
 */
export function sweepKneeRule(
  ctx: AnalysisContext,
  kneeCtx: SweepKneeContext,
): Finding | null {
  const { kneePoint, kneeStepResult, saturatedNodes, nodeUtilizations, objective } = kneeCtx;

  if (saturatedNodes.length > 0) {
    // Name the node that reached Saturation earliest (highest utilization)
    const sorted = [...saturatedNodes].sort((a, b) => b.utilization - a.utilization);
    const saturated = sorted[0]!;
    const nodeId = saturated.nodeId;

    return FindingBuilder.build({
      ruleId: 'capacity.sweep-knee',
      category: 'Capacity',
      severity: 'Warning',
      subjectNodeIds: [nodeId],
      evidence: [
        {
          metricName: 'utilization',
          value: saturated.utilization,
          unit: 'fraction',
          scope: nodeId,
          primary: true,
        },
        {
          metricName: 'kneePointRps',
          value: kneePoint.offeredRps,
          unit: 'req/s',
          scope: nodeId,
        },
        {
          metricName: saturated.boundParam,
          value: saturated.boundValue,
          unit: 'configured',
          scope: nodeId,
        },
      ],
      constraint: `${ctx.labelOf(nodeId)} reached Saturation at ${String(kneePoint.offeredRps)} RPS bounded by ${saturated.boundParam} at ${String(saturated.boundValue)}`,
      action: {
        nodeId,
        parameter: saturated.boundParam,
        direction: 'increase',
        targetValue: { value: saturated.boundValue * 2, unit: 'configured' },
      },
      tradeoff: `Increasing ${saturated.boundParam} at ${ctx.labelOf(nodeId)} may shift the bottleneck to a downstream node`,
      lowestCompletedCount: 200,
      allSubjectsInSteadyState: false,
      window: kneeStepResult.measurementInterval,
    });
  }

  // No node saturated — find highest utilization node and name violated objective condition
  if (nodeUtilizations.size === 0) return null;

  let highestNodeId = '';
  let highestUtil = 0;
  for (const [nodeId, util] of nodeUtilizations) {
    if (util > highestUtil) {
      highestUtil = util;
      highestNodeId = nodeId;
    }
  }

  if (!highestNodeId) return null;

  // Determine which condition was violated
  const p99Violated = kneeStepResult.latency.p99 > objective.maxP99LatencyMs;
  const errorViolated = kneeStepResult.totalErrorRate > objective.maxErrorRate;

  let violationDesc: string;
  if (p99Violated && errorViolated) {
    violationDesc = `p99 latency ${String(kneeStepResult.latency.p99)} ms exceeds limit ${String(objective.maxP99LatencyMs)} ms and error rate ${(kneeStepResult.totalErrorRate * 100).toFixed(2)}% exceeds limit ${(objective.maxErrorRate * 100).toFixed(2)}%`;
  } else if (p99Violated) {
    violationDesc = `p99 latency ${String(kneeStepResult.latency.p99)} ms exceeds limit ${String(objective.maxP99LatencyMs)} ms`;
  } else {
    violationDesc = `error rate ${(kneeStepResult.totalErrorRate * 100).toFixed(2)}% exceeds limit ${(objective.maxErrorRate * 100).toFixed(2)}%`;
  }

  return FindingBuilder.build({
    ruleId: 'capacity.sweep-knee',
    category: 'Capacity',
    severity: 'Warning',
    subjectNodeIds: [highestNodeId],
    evidence: [
      {
        metricName: 'utilization',
        value: highestUtil,
        unit: 'fraction',
        scope: highestNodeId,
        primary: true,
      },
      {
        metricName: 'kneePointRps',
        value: kneePoint.offeredRps,
        unit: 'req/s',
        scope: highestNodeId,
      },
    ],
    constraint: `${ctx.labelOf(highestNodeId)} holds the highest utilization (${(highestUtil * 100).toFixed(1)}%) at the Knee_Point (${String(kneePoint.offeredRps)} RPS); ${violationDesc}`,
    action: {
      nodeId: highestNodeId,
      parameter: 'capacity',
      direction: 'increase',
    },
    tradeoff: `Increasing capacity at ${ctx.labelOf(highestNodeId)} may improve Service_Objective compliance at the Knee_Point`,
    lowestCompletedCount: 200,
    allSubjectsInSteadyState: false,
    window: kneeStepResult.measurementInterval,
  });
}
