import type { Finding, EvidenceEntry } from '@/types/findings';
import { SYSTEM_WIDE_SCOPE } from '@/types/findings';
import type { BaselineRun } from '@/types/baseline';
import type { ServiceObjective } from '@/analysis/AnalysisWindowStore';
import { FindingBuilder } from '@/analysis/FindingBuilder';

// ─── Comparison Rules (Task 535) ─────────────────────────────────

/**
 * Category Comparison, empty subject set. Names which run satisfies the
 * Service_Objective (or the lower p99 if both/neither satisfy it).
 *
 * This is not a standard AnalysisRule (no `evaluate` generator) because it operates
 * on a ComparisonResult pair rather than the streaming analysis context.
 */
export function comparisonObjectiveRule(
  runA: BaselineRun,
  nameA: string,
  runB: BaselineRun,
  nameB: string,
): Finding | null {
  const objA = runA.objective;
  const objB = runB.objective;

  // Use whichever objective is available; if neither has one, cannot produce a Finding
  const objective: ServiceObjective | undefined = objA ?? objB;
  if (!objective) return null;

  const aSatisfied =
    runA.wholeRun.latency.p99 <= objective.maxP99LatencyMs &&
    runA.wholeRun.errorRate <= objective.maxErrorRate;

  const bSatisfied =
    runB.wholeRun.latency.p99 <= objective.maxP99LatencyMs &&
    runB.wholeRun.errorRate <= objective.maxErrorRate;

  let constraint: string;
  let winnerName: string;

  if (aSatisfied && !bSatisfied) {
    constraint = `"${nameA}" satisfies the Service Objective; "${nameB}" does not.`;
    winnerName = nameA;
  } else if (!aSatisfied && bSatisfied) {
    constraint = `"${nameB}" satisfies the Service Objective; "${nameA}" does not.`;
    winnerName = nameB;
  } else {
    // Both or neither satisfy — pick lower p99
    if (runA.wholeRun.latency.p99 <= runB.wholeRun.latency.p99) {
      constraint = `Both runs ${aSatisfied ? 'satisfy' : 'violate'} the Service Objective. "${nameA}" has lower p99 (${runA.wholeRun.latency.p99.toFixed(2)} ms vs ${runB.wholeRun.latency.p99.toFixed(2)} ms).`;
      winnerName = nameA;
    } else {
      constraint = `Both runs ${aSatisfied ? 'satisfy' : 'violate'} the Service Objective. "${nameB}" has lower p99 (${runB.wholeRun.latency.p99.toFixed(2)} ms vs ${runA.wholeRun.latency.p99.toFixed(2)} ms).`;
      winnerName = nameB;
    }
  }

  const evidence: EvidenceEntry[] = [
    {
      metricName: 'p99_latency',
      value: runA.wholeRun.latency.p99,
      unit: 'ms',
      scope: SYSTEM_WIDE_SCOPE,
      primary: true,
    },
    {
      metricName: 'p99_latency_B',
      value: runB.wholeRun.latency.p99,
      unit: 'ms',
      scope: SYSTEM_WIDE_SCOPE,
    },
  ];

  return FindingBuilder.build({
    ruleId: 'comparison.objective',
    category: 'Comparison',
    severity: 'Info',
    subjectNodeIds: [],
    evidence,
    constraint,
    action: {
      nodeId: SYSTEM_WIDE_SCOPE,
      parameter: 'serviceObjective',
      direction: 'decrease',
    },
    tradeoff: `Selecting "${winnerName}" may not reflect production conditions if the comparison is uncontrolled.`,
    lowestCompletedCount: 1000,
    allSubjectsInSteadyState: true,
    window: { startMs: 0, endMs: Math.max(runA.simulatedDurationMs, runB.simulatedDurationMs) },
  });
}

/**
 * Category Comparison, one Finding per node with ≥0.10 Utilization difference.
 */
export function comparisonUtilizationRule(
  runA: BaselineRun,
  nameA: string,
  runB: BaselineRun,
  nameB: string,
  matchedNodes: Array<{ nodeIdA: string; nodeIdB: string; nodeType: string; label: string }>,
): Finding[] {
  const findings: Finding[] = [];
  const UTILIZATION_THRESHOLD = 0.1;

  for (const match of matchedNodes) {
    const nodeA = runA.perNode[match.nodeIdA];
    const nodeB = runB.perNode[match.nodeIdB];
    if (!nodeA || !nodeB) continue;

    const diff = nodeB.meanUtilization - nodeA.meanUtilization;
    if (Math.abs(diff) < UTILIZATION_THRESHOLD) continue;

    const direction: 'increase' | 'decrease' = diff > 0 ? 'increase' : 'decrease';
    const evidence: EvidenceEntry[] = [
      {
        metricName: 'utilization_A',
        value: nodeA.meanUtilization,
        unit: 'fraction',
        scope: match.nodeIdA,
        primary: true,
      },
      {
        metricName: 'utilization_B',
        value: nodeB.meanUtilization,
        unit: 'fraction',
        scope: match.nodeIdB,
      },
    ];

    const finding = FindingBuilder.build({
      ruleId: 'comparison.utilization',
      category: 'Comparison',
      severity: Math.abs(diff) >= 0.25 ? 'Warning' : 'Info',
      subjectNodeIds: [match.nodeIdA],
      evidence,
      constraint:
        `Utilization for "${match.label}" differs by ${(Math.abs(diff) * 100).toFixed(1)}% between runs: ` +
        `"${nameA}" = ${(nodeA.meanUtilization * 100).toFixed(1)}%, "${nameB}" = ${(nodeB.meanUtilization * 100).toFixed(1)}%.`,
      action: {
        nodeId: match.nodeIdA,
        parameter: 'capacity',
        direction,
      },
      tradeoff: `Adjusting capacity for "${match.label}" in "${direction === 'increase' ? nameB : nameA}" may improve the affected run.`,
      lowestCompletedCount: 1000,
      allSubjectsInSteadyState: true,
      window: { startMs: 0, endMs: Math.max(runA.simulatedDurationMs, runB.simulatedDurationMs) },
    });

    findings.push(finding);
  }

  return findings;
}
