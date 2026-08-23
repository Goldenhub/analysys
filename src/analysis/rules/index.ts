import type { Finding, FindingCategory } from '@/types/findings';
import type { AnalysisContext } from '@/analysis/AnalysisWindowStore';

// ─── Analysis Rule Interface ─────────────────────────────────────

/**
 * A single, independently testable, individually suppressible analysis rule.
 *
 * Uses `Generator<void, Finding[], void>` rather than async/await so a rule's
 * progress is resumable at an explicit point of the rule's choosing — a rule
 * that iterates 80 nodes yields every N nodes, and the scheduler decides
 * whether to continue in the same slice or hand back the main thread.
 */
export interface AnalysisRule {
  /** Unique rule identifier, e.g. 'bottleneck.rank', 'instability.depth-growth'. */
  readonly id: string;
  /** The Finding category this rule emits. */
  readonly category: FindingCategory;
  /**
   * Metric names this rule reads. If any is not-applicable or absent for a node,
   * the rule is suppressed for that node and the suppression is reported (R41.5).
   */
  readonly requiredMetrics: readonly string[];
  /**
   * Yields between chunks of work so the scheduler can hold a slice at ≤33 ms.
   * Returns the Findings produced by this rule.
   */
  evaluate(ctx: AnalysisContext): Generator<void, Finding[], void>;
}

// ─── Rule Imports ────────────────────────────────────────────────

import {
  bottleneckRankRule,
  bottleneckCoLimitingRule,
  bottleneckNoConstraintRule,
  bottleneckNoneEligibleRule,
} from './bottleneck';
import { saturationRule } from './saturation';
import { instabilityDepthGrowthRule, instabilityLittlesLawRule } from './instability';
import { dlqGrowthRule, admissionDominatesRule } from './reliability';
import { workerPoolConcurrencyRule } from './capacity';
import { schedulerCollisionRule } from './configuration';
import { headroomRule } from './headroom';

// ─── Rule Registry (Task 487) ────────────────────────────────────

/**
 * The rule registry in design-stated order. Rules are iterated in this order
 * by the scheduler (Phase 21).
 *
 * Order: bottleneck → saturation → instability → reliability → capacity →
 *        configuration → headroom
 */
export const RULE_REGISTRY: readonly AnalysisRule[] = [
  bottleneckRankRule,
  bottleneckCoLimitingRule,
  bottleneckNoConstraintRule,
  bottleneckNoneEligibleRule,
  saturationRule,
  instabilityDepthGrowthRule,
  instabilityLittlesLawRule,
  dlqGrowthRule,
  workerPoolConcurrencyRule,
  schedulerCollisionRule,
  admissionDominatesRule,
  headroomRule,
];

// ─── Re-exports ──────────────────────────────────────────────────

export {
  bottleneckRankRule,
  bottleneckCoLimitingRule,
  bottleneckNoConstraintRule,
  bottleneckNoneEligibleRule,
} from './bottleneck';
export { saturationRule } from './saturation';
export { instabilityDepthGrowthRule, instabilityLittlesLawRule } from './instability';
export { dlqGrowthRule, admissionDominatesRule } from './reliability';
export { workerPoolConcurrencyRule } from './capacity';
export { sweepKneeRule } from './capacity';
export { schedulerCollisionRule } from './configuration';
export { headroomRule } from './headroom';
