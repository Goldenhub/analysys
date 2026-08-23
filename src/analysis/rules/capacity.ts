import type { Finding } from '@/types/findings';
import type { AnalysisContext } from '@/analysis/AnalysisWindowStore';
import { FindingBuilder } from '@/analysis/FindingBuilder';
import type { AnalysisRule } from './index';
import { getLittlesLawUnstableNodes } from './instability';

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
