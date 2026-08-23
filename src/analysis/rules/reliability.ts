import type { Finding, EvidenceEntry } from '@/types/findings';
import { SYSTEM_WIDE_SCOPE } from '@/types/findings';
import type { AnalysisContext } from '@/analysis/AnalysisWindowStore';
import { FindingBuilder } from '@/analysis/FindingBuilder';
import type { AnalysisRule } from './index';

// ─── Constants ───────────────────────────────────────────────────

const YIELD_BATCH_SIZE = 8;
const MIN_NON_SUCCESS_TERMINATIONS = 30;
const ADMISSION_DOMINANCE_THRESHOLD = 0.2; // 20% excess

// ─── dlqGrowthRule (Task 477) ────────────────────────────────────

/**
 * A Dead_Letter_Queue whose retained count rose at each of the 3 most recent
 * completed-window boundaries.
 *
 * Evidence includes per-upstream-node attribution and a tradeoff naming the added
 * slot occupancy at that upstream node.
 */
export const dlqGrowthRule: AnalysisRule = {
  id: 'reliability.dlq-growth',
  category: 'Reliability',
  requiredMetrics: ['monitoredDepth'],

  *evaluate(ctx: AnalysisContext): Generator<void, Finding[], void> {
    const completed = ctx.windows.filter((w) => w.durationMs > 0);
    if (completed.length < 3) return [];

    const recent3 = completed.slice(-3);
    // Find DLQ nodes by checking for retainedByUpstreamNode metric
    const nodeIds = new Set<string>();
    for (const w of recent3) {
      for (const n of w.nodes) {
        if (n.retainedByUpstreamNode !== undefined) nodeIds.add(n.nodeId);
      }
    }

    // Also check topology for DLQ node types
    for (const topoNode of ctx.topology.nodes) {
      if (topoNode.nodeType === 'DEAD_LETTER_QUEUE') nodeIds.add(topoNode.id);
    }

    const findings: Finding[] = [];
    let yielded = 0;

    for (const nodeId of nodeIds) {
      const depths: number[] = [];
      for (const w of recent3) {
        const node = w.nodes.find((n) => n.nodeId === nodeId);
        if (node?.monitoredDepth === null || node?.monitoredDepth === undefined) break;
        depths.push(node.monitoredDepth);
      }

      if (depths.length < 3) {
        yielded++;
        if (yielded % YIELD_BATCH_SIZE === 0) yield;
        continue;
      }

      // Retained count must rise at each of the 3 boundaries
      let allRising = true;
      for (let i = 1; i < depths.length; i++) {
        if (depths[i]! <= depths[i - 1]!) {
          allRising = false;
          break;
        }
      }

      if (!allRising) {
        yielded++;
        if (yielded % YIELD_BATCH_SIZE === 0) yield;
        continue;
      }

      // Build per-upstream attribution
      const lastWindow = recent3[recent3.length - 1]!;
      const lastNode = lastWindow.nodes.find((n) => n.nodeId === nodeId);
      const upstream = lastNode?.retainedByUpstreamNode ?? {};

      const evidence: EvidenceEntry[] = [
        {
          metricName: 'retainedCount',
          value: depths[depths.length - 1]!,
          unit: 'messages',
          scope: nodeId,
          primary: true,
        },
        {
          metricName: 'growthOverWindows',
          value: depths[depths.length - 1]! - depths[0]!,
          unit: 'messages',
          scope: nodeId,
        },
      ];

      // Add per-upstream attribution (up to 5 to stay within 20-entry limit)
      const upstreamEntries = Object.entries(upstream).slice(0, 5);
      for (const [upId, count] of upstreamEntries) {
        evidence.push({
          metricName: `retainedFrom:${ctx.labelOf(upId)}`,
          value: count as number,
          unit: 'messages',
          scope: upId,
        });
      }

      const topoNode = ctx.topology.nodes.find((n) => n.id === nodeId);
      const capacity =
        topoNode?.nodeType === 'DEAD_LETTER_QUEUE'
          ? (topoNode.config as { capacity: number }).capacity
          : null;

      const completedCount = ctx.cumulative.nodeCompletedCounts.get(nodeId) ?? 0;
      const steady = ctx.steadyStateMap.get(nodeId)?.isSteady ?? false;

      // Build tradeoff naming upstream slot occupancy
      const topUpstream = upstreamEntries[0];
      const tradeoff = topUpstream
        ? `Increasing retry capacity at ${ctx.labelOf(topUpstream[0])} adds slot occupancy at that node`
        : `Investigate the source of retry-exhausted messages reaching ${ctx.labelOf(nodeId)}`;

      findings.push(
        FindingBuilder.build({
          ruleId: 'reliability.dlq-growth',
          category: 'Reliability',
          severity: 'Warning',
          subjectNodeIds: [nodeId],
          evidence,
          constraint:
            capacity !== null
              ? `${ctx.labelOf(nodeId)} bounded by capacity at ${String(capacity)} messages`
              : `${ctx.labelOf(nodeId)} retained count growing across 3 consecutive windows`,
          action: {
            nodeId,
            parameter: 'capacity',
            direction: 'increase',
            ...(capacity !== null
              ? { targetValue: { value: capacity * 2, unit: 'messages' } }
              : {}),
          },
          tradeoff,
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

// ─── admissionDominatesRule (Task 480) ───────────────────────────

/**
 * Requires the admission rate to exceed the capacity-or-reliability rate by at
 * least 20% in each of 3 windows, with at least 30 non-Success terminations
 * across them, so no rule fires from an empty denominator.
 */
export const admissionDominatesRule: AnalysisRule = {
  id: 'reliability.admission-dominates',
  category: 'Reliability',
  requiredMetrics: [],

  *evaluate(ctx: AnalysisContext): Generator<void, Finding[], void> {
    const completed = ctx.windows.filter((w) => w.durationMs > 0);
    if (completed.length < 3) return [];

    const recent3 = completed.slice(-3);

    yield;

    // Check system-wide failure class rates
    let totalNonSuccess = 0;
    let allAdmissionDominates = true;

    for (const w of recent3) {
      const rates = w.systemWide.failureClassRates;
      if (!rates) {
        allAdmissionDominates = false;
        break;
      }

      const admissionRate = rates.admission;
      const capacityReliabilityRate = rates.capacityReliability;

      // Admission must exceed capacity-or-reliability by ≥20%
      if (capacityReliabilityRate > 0) {
        const excess = (admissionRate - capacityReliabilityRate) / capacityReliabilityRate;
        if (excess < ADMISSION_DOMINANCE_THRESHOLD) {
          allAdmissionDominates = false;
          break;
        }
      } else if (admissionRate <= 0) {
        // Both zero — cannot determine dominance
        allAdmissionDominates = false;
        break;
      }
      // If capacityReliability is 0 but admission > 0, admission trivially dominates

      // Count non-Success terminations from node terminal counts
      for (const node of w.nodes) {
        for (const [status, count] of Object.entries(node.terminalCounts)) {
          if (status !== 'Success') totalNonSuccess += count;
        }
      }
    }

    if (!allAdmissionDominates) return [];
    if (totalNonSuccess < MIN_NON_SUCCESS_TERMINATIONS) return [];

    const lastWindow = completed[completed.length - 1]!;
    const lastRates = lastWindow.systemWide.failureClassRates!;

    const finding = FindingBuilder.build({
      ruleId: 'reliability.admission-dominates',
      category: 'Reliability',
      severity: 'Warning',
      subjectNodeIds: [],
      evidence: [
        {
          metricName: 'admissionRate',
          value: lastRates.admission,
          unit: 'term/s',
          scope: SYSTEM_WIDE_SCOPE,
          primary: true,
        },
        {
          metricName: 'capacityReliabilityRate',
          value: lastRates.capacityReliability,
          unit: 'term/s',
          scope: SYSTEM_WIDE_SCOPE,
        },
        {
          metricName: 'nonSuccessTerminations',
          value: totalNonSuccess,
          unit: 'requests',
          scope: SYSTEM_WIDE_SCOPE,
        },
      ],
      constraint:
        'Admission failures dominate capacity/reliability failures by at least 20% across 3 windows',
      action: {
        nodeId: '',
        parameter: 'admissionControl',
        direction: 'decrease',
      },
      tradeoff:
        'Relaxing admission control increases load on downstream nodes which may already be near capacity',
      lowestCompletedCount: ctx.cumulative.systemCompletedCount,
      allSubjectsInSteadyState: false,
      window: { startMs: lastWindow.startMs, endMs: lastWindow.endMs },
    });

    return [finding];
  },
};
