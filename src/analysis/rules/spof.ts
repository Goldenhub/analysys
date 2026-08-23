/**
 * Single Point of Failure Rule — Requirement 39
 *
 * Emits one Finding per designated SPOF node naming every source whose
 * reachable terminal set becomes empty upon removal.
 *
 * Evidence:
 *   - Blast_Radius (primary): terminatedThroughNodeCount / systemTerminatedCount * 100
 *     Omitted if no completed run is retained.
 *   - fan_in: distinct nodes holding an edge INTO the subject.
 *   - losing_source_count: sources whose terminals become empty.
 *   - topology_source_count: total sources in topology.
 *
 * Severity: Critical at fan-in >= 3, Warning at fan-in <= 2.
 * Confidence: Low when blast_radius is not applicable (no completed run).
 * Action: StructuralAction.
 */
import type { Finding, StructuralAction, EvidenceEntry } from '@/types/findings';
import { SYSTEM_WIDE_SCOPE } from '@/types/findings';
import type { AnalysisContext } from '@/analysis/AnalysisWindowStore';
import { computeSpofs } from '@/analysis/reachability';
import { FindingBuilder } from '@/analysis/FindingBuilder';
import type { AnalysisRule } from './index';
import { NodeType } from '@/types/nodes';
import type { SimulationNode } from '@/types/nodes';

// ─── Constants ───────────────────────────────────────────────────

const RULE_ID = 'spof.reachability';
const CATEGORY = 'Single_Point_Of_Failure' as const;

// ─── Helper: Determine Structural Action ─────────────────────────

function buildStructuralAction(
  nodeId: string,
  node: SimulationNode | undefined,
): StructuralAction {
  const nodeType = node?.nodeType ?? NodeType.AppServer;
  // Default recommendation: add a redundant instance behind a Load_Balancer
  return {
    nodeId,
    nodeType,
    change: 'add-redundant-instance-behind-a-Load_Balancer-node',
    nodesAdded: 2, // Load_Balancer + redundant instance
    edgesAdded: 3, // upstream→LB, LB→original, LB→new
  };
}

function buildTradeoff(nodesAdded: number): string {
  return `Adds ${nodesAdded} nodes toward the 200-node canvas limit; additional LB hop may increase p50 latency by 1-3ms under normal load.`;
}

// ─── spofRule ────────────────────────────────────────────────────

export const spofRule: AnalysisRule = {
  id: RULE_ID,
  category: CATEGORY,
  requiredMetrics: [], // Structural analysis, no per-window metrics required.

  *evaluate(ctx: AnalysisContext): Generator<void, Finding[], void> {
    const { topology, cumulative, windows } = ctx;
    const { nodes, edges } = topology;

    // Run the reachability generator, yielding through
    const gen = computeSpofs(nodes, edges);
    let step = gen.next();
    while (!step.done) {
      yield; // Forward the yield to the scheduler
      step = gen.next();
    }
    const result = step.value;

    if (result.spofs.length === 0) return [];

    // Determine if a completed run exists (system terminated count > 0)
    const systemTerminatedCount = cumulative.systemCompletedCount;
    const hasCompletedRun = systemTerminatedCount > 0;

    // Get the latest completed window for the Finding time range
    const completedWindows = windows.filter((w) => w.durationMs > 0);
    const latestWindow = completedWindows.length > 0
      ? completedWindows[completedWindows.length - 1]!
      : { startMs: 0, endMs: 0 };

    const findings: Finding[] = [];

    for (const spof of result.spofs) {
      const node = nodes.find((n) => n.id === spof.nodeId);
      const severity = spof.fanIn >= 3 ? 'Critical' : 'Warning';
      const action = buildStructuralAction(spof.nodeId, node);

      // Build evidence
      const evidence: EvidenceEntry[] = [];

      if (hasCompletedRun) {
        // Use cumulative counts for blast radius
        const cumulativeNodeCount = cumulative.nodeCompletedCounts.get(spof.nodeId) ?? 0;
        const blastRadius = systemTerminatedCount > 0
          ? (cumulativeNodeCount / systemTerminatedCount) * 100
          : 0;

        evidence.push({
          metricName: 'Blast_Radius',
          value: blastRadius,
          unit: 'percent',
          scope: spof.nodeId,
          primary: true,
        });
      }

      // Fan-in evidence
      evidence.push({
        metricName: 'fan_in',
        value: spof.fanIn,
        unit: 'count',
        scope: spof.nodeId,
        ...(hasCompletedRun ? {} : { primary: true } as { primary: true }),
      });

      // Losing source count
      evidence.push({
        metricName: 'losing_source_count',
        value: spof.losingSources.length,
        unit: 'count',
        scope: SYSTEM_WIDE_SCOPE,
      });

      // Topology source count
      evidence.push({
        metricName: 'topology_source_count',
        value: result.sourceIds.length,
        unit: 'count',
        scope: SYSTEM_WIDE_SCOPE,
      });

      // Determine constraint text
      let constraintText: string;

      if (!hasCompletedRun) {
        constraintText = `Removing ${ctx.labelOf(spof.nodeId)} leaves ${spof.losingSources.map((s) => ctx.labelOf(s)).join(', ')} with 0 reachable terminals. Blast_Radius is not applicable because no run has completed.`;
      } else {
        constraintText = `Removing ${ctx.labelOf(spof.nodeId)} leaves ${spof.losingSources.map((s) => ctx.labelOf(s)).join(', ')} with 0 reachable terminals.`;
      }

      // Truncate constraint to 500 chars
      const truncatedConstraint = constraintText.length > 500
        ? constraintText.slice(0, 497) + '...'
        : constraintText;

      const tradeoff = buildTradeoff(action.nodesAdded);

      // Build the finding manually (bypassing FindingBuilder confidence derivation)
      // since we have custom confidence logic for no-completed-run case.
      // We use FindingBuilder for validation but override confidence if needed.
      try {
        const finding = FindingBuilder.build({
          ruleId: RULE_ID,
          category: CATEGORY,
          severity,
          subjectNodeIds: [spof.nodeId],
          evidence,
          constraint: truncatedConstraint,
          action,
          tradeoff,
          lowestCompletedCount: hasCompletedRun
            ? (cumulative.nodeCompletedCounts.get(spof.nodeId) ?? 0)
            : 0,
          allSubjectsInSteadyState: hasCompletedRun
            ? (ctx.steadyStateMap.get(spof.nodeId)?.isSteady ?? false)
            : false,
          window: { startMs: latestWindow.startMs, endMs: latestWindow.endMs },
        });

        // Override confidence for no-completed-run case
        if (!hasCompletedRun) {
          (finding as { confidence: string }).confidence = 'Low';
        }

        findings.push(finding);
      } catch {
        // Skip malformed findings (e.g., empty constraint from node without label)
      }
    }

    return findings;
  },
};
