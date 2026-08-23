import type { Finding } from '@/types/findings';
import type { AnalysisContext, NodeMetricsWindow } from '@/analysis/AnalysisWindowStore';
import type { SimulationNode } from '@/types/nodes';
import { FindingBuilder } from '@/analysis/FindingBuilder';
import type { AnalysisRule } from './index';
import { analysisUtilization } from './bottleneck';

// ─── Constants ───────────────────────────────────────────────────

const YIELD_BATCH_SIZE = 8;
const SATURATION_THRESHOLD = 0.85;

// ─── Saturation Rule (Task 471) ──────────────────────────────────

/**
 * Saturation: per-window utilization ≥0.85 in EACH of the 3 most recent completed windows.
 * The reported sustained Utilization is the mean over the *maximal* run of consecutive
 * windows at or above 0.85 ending at the most recent one, which may be longer than 3.
 */
export const saturationRule: AnalysisRule = {
  id: 'saturation.main',
  category: 'Saturation',
  requiredMetrics: ['utilization'],

  *evaluate(ctx: AnalysisContext): Generator<void, Finding[], void> {
    const completed = ctx.windows.filter((w) => w.durationMs > 0);
    if (completed.length < 3) return [];

    const nodeIds = new Set<string>();
    for (const w of completed) {
      for (const n of w.nodes) nodeIds.add(n.nodeId);
    }

    const findings: Finding[] = [];
    let yielded = 0;

    for (const nodeId of nodeIds) {
      // Check if the 3 most recent completed windows all have ≥0.85
      const recent3 = completed.slice(-3);
      let allSaturated = true;
      for (const w of recent3) {
        const node = w.nodes.find((n) => n.nodeId === nodeId);
        if (!node || node.utilization.kind !== 'value' || node.utilization.value < SATURATION_THRESHOLD) {
          allSaturated = false;
          break;
        }
      }

      if (!allSaturated) {
        yielded++;
        if (yielded % YIELD_BATCH_SIZE === 0) yield;
        continue;
      }

      // Find the maximal run of consecutive windows ≥0.85 ending at the most recent
      const { sustainedUtilization, runLength } = computeMaximalRun(nodeId, completed);

      // Get bounding parameter info
      const topoNode = ctx.topology.nodes.find((n) => n.id === nodeId);
      const boundParam = getBoundingParam(topoNode);

      const completedCount = ctx.cumulative.nodeCompletedCounts.get(nodeId) ?? 0;
      const steady = ctx.steadyStateMap.get(nodeId)?.isSteady ?? false;
      const lastWindow = completed[completed.length - 1]!;

      findings.push(
        FindingBuilder.build({
          ruleId: 'saturation.main',
          category: 'Saturation',
          severity: 'Critical',
          subjectNodeIds: [nodeId],
          evidence: [
            { metricName: 'sustainedUtilization', value: sustainedUtilization, unit: 'fraction', scope: nodeId, primary: true },
            { metricName: 'runLength', value: runLength, unit: 'windows', scope: nodeId },
            { metricName: 'analysisUtilization', value: analysisUtilization(nodeId, ctx.windows) ?? 0, unit: 'fraction', scope: nodeId },
          ],
          constraint: boundParam
            ? `${ctx.labelOf(nodeId)} bounded by ${boundParam.parameter} at ${String(boundParam.value)} ${boundParam.unit}`
            : `${ctx.labelOf(nodeId)} sustained at or above 85% utilization`,
          action: {
            nodeId,
            parameter: boundParam?.parameter ?? 'capacity',
            direction: 'increase',
            ...(boundParam ? { multiplier: 1.5 } : {}),
          },
          tradeoff: `Increasing capacity at ${ctx.labelOf(nodeId)} may shift the bottleneck elsewhere`,
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

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Compute the maximal run of consecutive windows at or above 0.85 ending at the
 * most recent completed window, and return the mean utilization over that run.
 */
function computeMaximalRun(
  nodeId: string,
  completedWindows: NodeMetricsWindow[],
): { sustainedUtilization: number; runLength: number } {
  let runLength = 0;
  let sum = 0;

  // Work backwards from the most recent
  for (let i = completedWindows.length - 1; i >= 0; i--) {
    const node = completedWindows[i]!.nodes.find((n) => n.nodeId === nodeId);
    if (!node || node.utilization.kind !== 'value' || node.utilization.value < SATURATION_THRESHOLD) {
      break;
    }
    sum += node.utilization.value;
    runLength++;
  }

  return {
    sustainedUtilization: runLength > 0 ? sum / runLength : 0,
    runLength,
  };
}

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
