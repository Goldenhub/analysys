import type { Finding } from '@/types/findings';
import type { AnalysisContext } from '@/analysis/AnalysisWindowStore';
import { FindingBuilder } from '@/analysis/FindingBuilder';
import type { AnalysisRule } from './index';

// ─── Constants ───────────────────────────────────────────────────

const YIELD_BATCH_SIZE = 8;
const COLLISION_WINDOW_MS = 1000;
const MIN_CONSECUTIVE_COLLISIONS = 2;

// ─── schedulerCollisionRule (Task 479) ───────────────────────────

/**
 * Detects pairs of Scheduler nodes with 2 or more consecutive coinciding trigger
 * indices within 1,000 simulated ms, reading trigger fire times from the event log.
 */
export const schedulerCollisionRule: AnalysisRule = {
  id: 'configuration.scheduler-collision',
  category: 'Configuration',
  requiredMetrics: [],

  *evaluate(ctx: AnalysisContext): Generator<void, Finding[], void> {
    // Find all Scheduler nodes
    const schedulerNodes = ctx.topology.nodes.filter((n) => n.nodeType === 'SCHEDULER');
    if (schedulerNodes.length < 2) return [];

    // Extract trigger events per scheduler from the event log
    const triggerTimes = new Map<string, number[]>();
    for (const node of schedulerNodes) {
      triggerTimes.set(node.id, []);
    }

    for (const entry of ctx.eventLog) {
      // Look for scheduler trigger events
      if (
        entry.type === 'SCHEDULER_TRIGGER' ||
        entry.message.includes('trigger') ||
        entry.message.includes('fired')
      ) {
        const times = triggerTimes.get(entry.nodeId);
        if (times) {
          times.push(entry.timestamp);
        }
      }
    }

    yield;

    const findings: Finding[] = [];
    let yielded = 0;

    // Check each pair of schedulers
    for (let i = 0; i < schedulerNodes.length; i++) {
      for (let j = i + 1; j < schedulerNodes.length; j++) {
        const nodeA = schedulerNodes[i]!;
        const nodeB = schedulerNodes[j]!;
        const timesA = triggerTimes.get(nodeA.id) ?? [];
        const timesB = triggerTimes.get(nodeB.id) ?? [];

        if (timesA.length === 0 || timesB.length === 0) continue;

        // Sort trigger times
        timesA.sort((a, b) => a - b);
        timesB.sort((a, b) => a - b);

        // Find consecutive collisions (trigger indices within COLLISION_WINDOW_MS)
        const collisions = findConsecutiveCollisions(timesA, timesB);

        if (collisions < MIN_CONSECUTIVE_COLLISIONS) continue;

        const lastWindow = ctx.windows.filter((w) => w.durationMs > 0).slice(-1)[0];
        if (!lastWindow) continue;

        const completedCount = Math.min(
          ctx.cumulative.nodeCompletedCounts.get(nodeA.id) ?? 0,
          ctx.cumulative.nodeCompletedCounts.get(nodeB.id) ?? 0,
        );
        const steady =
          (ctx.steadyStateMap.get(nodeA.id)?.isSteady ?? false) &&
          (ctx.steadyStateMap.get(nodeB.id)?.isSteady ?? false);

        findings.push(
          FindingBuilder.build({
            ruleId: 'configuration.scheduler-collision',
            category: 'Configuration',
            severity: 'Warning',
            subjectNodeIds: [nodeA.id, nodeB.id],
            evidence: [
              {
                metricName: 'consecutiveCollisions',
                value: collisions,
                unit: 'events',
                scope: nodeA.id,
                primary: true,
              },
              {
                metricName: 'collisionWindowMs',
                value: COLLISION_WINDOW_MS,
                unit: 'ms',
                scope: nodeA.id,
              },
            ],
            constraint: `${ctx.labelOf(nodeA.id)} and ${ctx.labelOf(nodeB.id)} have ${String(collisions)} consecutive coinciding triggers within ${String(COLLISION_WINDOW_MS)} ms`,
            action: {
              nodeId: nodeB.id,
              parameter: 'startOffsetMs',
              direction: 'increase',
            },
            tradeoff: `Staggering ${ctx.labelOf(nodeB.id)} start offset reduces peak concurrent load but changes job ordering`,
            lowestCompletedCount: completedCount,
            allSubjectsInSteadyState: steady,
            window: { startMs: lastWindow.startMs, endMs: lastWindow.endMs },
          }),
        );

        yielded++;
        if (yielded % YIELD_BATCH_SIZE === 0) yield;
      }
    }

    return findings;
  },
};

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Count the maximum run of consecutive coinciding triggers between two sorted
 * trigger-time arrays. Two triggers coincide when they fall within COLLISION_WINDOW_MS.
 */
function findConsecutiveCollisions(timesA: number[], timesB: number[]): number {
  // Find all collision pairs
  let bStart = 0;
  let maxConsecutive = 0;
  let currentConsecutive = 0;
  let lastACollisionIdx = -2; // Track consecutive A indices

  for (let a = 0; a < timesA.length; a++) {
    const tA = timesA[a]!;
    // Advance bStart past entries too early
    while (bStart < timesB.length && timesB[bStart]! < tA - COLLISION_WINDOW_MS) {
      bStart++;
    }

    // Check if any B trigger falls within window
    let found = false;
    for (let b = bStart; b < timesB.length && timesB[b]! <= tA + COLLISION_WINDOW_MS; b++) {
      found = true;
      break;
    }

    if (found) {
      if (a === lastACollisionIdx + 1) {
        currentConsecutive++;
      } else {
        currentConsecutive = 1;
      }
      lastACollisionIdx = a;
      if (currentConsecutive > maxConsecutive) {
        maxConsecutive = currentConsecutive;
      }
    }
  }

  return maxConsecutive;
}
