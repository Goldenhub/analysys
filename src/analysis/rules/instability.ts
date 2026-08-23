import type { Finding, EvidenceEntry } from '@/types/findings';
import type { AnalysisContext } from '@/analysis/AnalysisWindowStore';
import type { SimulationNode } from '@/types/nodes';
import { FindingBuilder } from '@/analysis/FindingBuilder';
import type { AnalysisRule } from './index';
import { analysisUtilization } from './bottleneck';

// ─── Constants ───────────────────────────────────────────────────

const YIELD_BATCH_SIZE = 8;
const SATURATION_THRESHOLD = 0.85;
const INSTABILITY_WINDOW_COUNT = 5;
const GROWTH_FLOOR_PCT = 0.20;
const LITTLES_LAW_DEVIATION_THRESHOLD = 0.05;

// ─── instabilityDepthGrowthRule (Tasks 472-474) ──────────────────

/**
 * Instability inspects 5 windows: the monitored depth must increase at each of
 * the 4 most recent boundaries AND the newest value must exceed the oldest by
 * ≥20% of the oldest.
 *
 * Precedence (Task 474): where a node satisfies both Saturation and Instability in
 * one recomputation, emit only the Instability Finding with the sustained Utilization
 * folded into its evidence.
 */
export const instabilityDepthGrowthRule: AnalysisRule = {
  id: 'instability.depth-growth',
  category: 'Instability',
  requiredMetrics: ['monitoredDepth'],

  *evaluate(ctx: AnalysisContext): Generator<void, Finding[], void> {
    const completed = ctx.windows.filter((w) => w.durationMs > 0);
    if (completed.length < INSTABILITY_WINDOW_COUNT) return [];

    const recent5 = completed.slice(-INSTABILITY_WINDOW_COUNT);
    const nodeIds = new Set<string>();
    for (const w of recent5) {
      for (const n of w.nodes) {
        if (n.monitoredDepth !== null) nodeIds.add(n.nodeId);
      }
    }

    const findings: Finding[] = [];
    let yielded = 0;

    for (const nodeId of nodeIds) {
      const depths: number[] = [];
      for (const w of recent5) {
        const node = w.nodes.find((n) => n.nodeId === nodeId);
        if (node?.monitoredDepth === null || node?.monitoredDepth === undefined) {
          break;
        }
        depths.push(node.monitoredDepth);
      }

      if (depths.length < INSTABILITY_WINDOW_COUNT) {
        yielded++;
        if (yielded % YIELD_BATCH_SIZE === 0) yield;
        continue;
      }

      // Check 4 consecutive increases
      let allIncreasing = true;
      for (let i = 1; i < depths.length; i++) {
        if (depths[i]! <= depths[i - 1]!) {
          allIncreasing = false;
          break;
        }
      }

      if (!allIncreasing) {
        yielded++;
        if (yielded % YIELD_BATCH_SIZE === 0) yield;
        continue;
      }

      // 20% floor check
      const oldest = depths[0]!;
      const newest = depths[depths.length - 1]!;
      const netGrowth = newest - oldest;
      if (oldest > 0 && netGrowth < oldest * GROWTH_FLOOR_PCT) {
        yielded++;
        if (yielded % YIELD_BATCH_SIZE === 0) yield;
        continue;
      }
      // If oldest is 0, any positive growth qualifies (cannot compute 20% of 0)
      if (oldest === 0 && newest === 0) {
        yielded++;
        if (yielded % YIELD_BATCH_SIZE === 0) yield;
        continue;
      }

      // Compute growth rate (Task 473)
      const totalDurationMs = recent5.reduce((s, w) => s + w.durationMs, 0);
      const growthRatePerSec = totalDurationMs > 0 ? (netGrowth / totalDurationMs) * 1000 : 0;

      // Projected time to bound (Task 473)
      const lastNode = recent5[recent5.length - 1]!.nodes.find((n) => n.nodeId === nodeId);
      const bound = lastNode?.monitoredDepthBound ?? null;
      let projectedTimeMs: number | null = null;
      let projectionNotApplicableReason: string | null = null;

      if (growthRatePerSec <= 0) {
        projectionNotApplicableReason = 'growth rate is at or below 0 items/s';
      } else if (bound === null) {
        projectionNotApplicableReason = 'no configured bound available';
      } else {
        const remaining = bound - newest;
        if (remaining <= 0) {
          projectedTimeMs = 0;
        } else {
          projectedTimeMs = (remaining / growthRatePerSec) * 1000;
        }
      }

      // Check precedence: if this node also satisfies Saturation, fold sustained util into evidence
      const util = analysisUtilization(nodeId, ctx.windows);
      let sustainedUtil: number | null = null;
      if (util !== null && util >= SATURATION_THRESHOLD) {
        // Check all 3 recent windows ≥0.85
        const recent3 = completed.slice(-3);
        const allSaturated = recent3.every((w) => {
          const n = w.nodes.find((nd) => nd.nodeId === nodeId);
          return n && n.utilization.kind === 'value' && n.utilization.value >= SATURATION_THRESHOLD;
        });
        if (allSaturated) {
          sustainedUtil = util;
        }
      }

      const completedCount = ctx.cumulative.nodeCompletedCounts.get(nodeId) ?? 0;
      const steady = ctx.steadyStateMap.get(nodeId)?.isSteady ?? false;
      const lastWindow = completed[completed.length - 1]!;

      const evidence: EvidenceEntry[] = [
        { metricName: 'monitoredDepthNewest', value: newest, unit: 'items', scope: nodeId, primary: true },
        { metricName: 'monitoredDepthOldest', value: oldest, unit: 'items', scope: nodeId },
        { metricName: 'growthRate', value: growthRatePerSec, unit: 'items/s', scope: nodeId },
        { metricName: 'netGrowth', value: netGrowth, unit: 'items', scope: nodeId },
      ];

      if (projectedTimeMs !== null) {
        evidence.push({ metricName: 'projectedTimeToBound', value: projectedTimeMs, unit: 'ms', scope: nodeId });
      }

      if (sustainedUtil !== null) {
        evidence.push({ metricName: 'sustainedUtilization', value: sustainedUtil, unit: 'fraction', scope: nodeId });
      }

      const constraintParts: string[] = [
        `${ctx.labelOf(nodeId)} depth grew from ${String(oldest)} to ${String(newest)} over ${String(INSTABILITY_WINDOW_COUNT)} windows`,
      ];
      if (projectionNotApplicableReason) {
        constraintParts.push(`projection not applicable: ${projectionNotApplicableReason}`);
      } else if (projectedTimeMs !== null) {
        constraintParts.push(`projected ${(projectedTimeMs / 1000).toFixed(1)}s to bound while growth rate continues`);
      }

      const constraint = constraintParts.join('; ').slice(0, 500);

      const topoNode = ctx.topology.nodes.find((n) => n.id === nodeId);
      const boundParam = getDepthBoundParam(topoNode);

      findings.push(
        FindingBuilder.build({
          ruleId: 'instability.depth-growth',
          category: 'Instability',
          severity: 'Critical',
          subjectNodeIds: [nodeId],
          evidence,
          constraint,
          action: {
            nodeId,
            parameter: boundParam?.parameter ?? 'capacity',
            direction: 'increase',
            ...(boundParam ? { targetValue: { value: boundParam.value * 2, unit: boundParam.unit } } : {}),
          },
          tradeoff: `Increasing ${boundParam?.parameter ?? 'capacity'} delays overflow but does not address the root cause of unbounded growth`,
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

// ─── instabilityLittlesLawRule (Task 475) ────────────────────────

/**
 * A node exceeding 5% Little's Law deviation in each of the 3 most recent windows.
 * Suppresses every Capacity Finding for that node.
 */
export const instabilityLittlesLawRule: AnalysisRule = {
  id: 'instability.littles-law',
  category: 'Instability',
  requiredMetrics: ['utilization'],

  *evaluate(ctx: AnalysisContext): Generator<void, Finding[], void> {
    const completed = ctx.windows.filter((w) => w.durationMs > 0);
    if (completed.length < 3) return [];

    const recent3 = completed.slice(-3);
    const nodeIds = new Set<string>();
    for (const w of recent3) {
      for (const n of w.nodes) nodeIds.add(n.nodeId);
    }

    const findings: Finding[] = [];
    let yielded = 0;

    for (const nodeId of nodeIds) {
      let allExceedDeviation = true;
      const deviations: number[] = [];

      for (const w of recent3) {
        const node = w.nodes.find((n) => n.nodeId === nodeId);
        if (!node) {
          allExceedDeviation = false;
          break;
        }
        const deviation = Math.abs(node.littlesLaw.deviation);
        if (deviation < LITTLES_LAW_DEVIATION_THRESHOLD) {
          allExceedDeviation = false;
          break;
        }
        deviations.push(deviation);
      }

      if (!allExceedDeviation || deviations.length < 3) {
        yielded++;
        if (yielded % YIELD_BATCH_SIZE === 0) yield;
        continue;
      }

      const meanDeviation = deviations.reduce((s, d) => s + d, 0) / deviations.length;
      const completedCount = ctx.cumulative.nodeCompletedCounts.get(nodeId) ?? 0;
      const steady = ctx.steadyStateMap.get(nodeId)?.isSteady ?? false;
      const lastWindow = completed[completed.length - 1]!;

      findings.push(
        FindingBuilder.build({
          ruleId: 'instability.littles-law',
          category: 'Instability',
          severity: 'Warning',
          subjectNodeIds: [nodeId],
          evidence: [
            { metricName: 'littlesLawDeviation', value: meanDeviation, unit: 'fraction', scope: nodeId, primary: true },
            { metricName: 'analysisUtilization', value: analysisUtilization(nodeId, ctx.windows) ?? 0, unit: 'fraction', scope: nodeId },
          ],
          constraint: `${ctx.labelOf(nodeId)} exceeds 5% Little's Law deviation across 3 consecutive windows (measured outside Steady_State)`,
          action: {
            nodeId,
            parameter: 'capacity',
            direction: 'increase',
          },
          tradeoff: `Capacity Finding suppressed for ${ctx.labelOf(nodeId)} while instability persists`,
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

/**
 * Get the set of node IDs that have Little's Law instability (for suppression checks).
 */
export function getLittlesLawUnstableNodes(ctx: AnalysisContext): Set<string> {
  const completed = ctx.windows.filter((w) => w.durationMs > 0);
  if (completed.length < 3) return new Set();

  const recent3 = completed.slice(-3);
  const unstable = new Set<string>();
  const nodeIds = new Set<string>();
  for (const w of recent3) {
    for (const n of w.nodes) nodeIds.add(n.nodeId);
  }

  for (const nodeId of nodeIds) {
    let allExceedDeviation = true;
    for (const w of recent3) {
      const node = w.nodes.find((n) => n.nodeId === nodeId);
      if (!node || Math.abs(node.littlesLaw.deviation) < LITTLES_LAW_DEVIATION_THRESHOLD) {
        allExceedDeviation = false;
        break;
      }
    }
    if (allExceedDeviation) unstable.add(nodeId);
  }

  return unstable;
}

/**
 * Get the set of nodes that satisfy depth-growth instability (for precedence check
 * against Saturation — Task 474).
 */
export function getDepthGrowthUnstableNodes(ctx: AnalysisContext): Set<string> {
  const completed = ctx.windows.filter((w) => w.durationMs > 0);
  if (completed.length < INSTABILITY_WINDOW_COUNT) return new Set();

  const recent5 = completed.slice(-INSTABILITY_WINDOW_COUNT);
  const unstable = new Set<string>();
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
      if (node?.monitoredDepth === null || node?.monitoredDepth === undefined) break;
      depths.push(node.monitoredDepth);
    }
    if (depths.length < INSTABILITY_WINDOW_COUNT) continue;

    let allIncreasing = true;
    for (let i = 1; i < depths.length; i++) {
      if (depths[i]! <= depths[i - 1]!) { allIncreasing = false; break; }
    }
    if (!allIncreasing) continue;

    const oldest = depths[0]!;
    const newest = depths[depths.length - 1]!;
    if (oldest > 0 && (newest - oldest) < oldest * GROWTH_FLOOR_PCT) continue;
    if (oldest === 0 && newest === 0) continue;

    unstable.add(nodeId);
  }

  return unstable;
}

// ─── Helpers ─────────────────────────────────────────────────────

function getDepthBoundParam(
  node: SimulationNode | undefined | null,
): { parameter: string; value: number; unit: string } | null {
  if (!node) return null;
  switch (node.nodeType) {
    case 'APP_SERVER':
      return { parameter: 'requestQueueDepth', value: node.config.requestQueueDepth, unit: 'slots' };
    case 'MESSAGE_QUEUE':
      return { parameter: 'bufferCapacity', value: node.config.bufferCapacity, unit: 'messages' };
    case 'WORKER_POOL':
      return { parameter: 'prefetchBufferDepth', value: node.config.prefetchBufferDepth, unit: 'slots' };
    case 'DEAD_LETTER_QUEUE':
      return { parameter: 'capacity', value: node.config.capacity, unit: 'messages' };
    default:
      return null;
  }
}
