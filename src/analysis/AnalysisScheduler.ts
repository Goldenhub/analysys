import type { Finding, SuppressionEntry } from '@/types/findings';
import type { NodeMetricsSnapshot } from '@/types/metrics';
import type { AnalysisContext } from './AnalysisWindowStore';
import { FindingResultMap } from './FindingBuilder';
import { RULE_REGISTRY, type AnalysisRule } from './rules/index';

// ─── Constants ───────────────────────────────────────────────────

/** Maximum milliseconds a single slice may occupy the main thread (R41.9). */
export const SLICE_BUDGET_MS = 33;

/** Maximum total milliseconds for one full recomputation pass (R41.8, R41.10). */
export const TOTAL_BUDGET_MS = 500;

// ─── Recomputation Result ────────────────────────────────────────

export type RecomputationResult =
  | {
      status: 'complete';
      findings: Finding[];
      suppressions: SuppressionEntry[];
    }
  | {
      status: 'aborted';
      /** Rule IDs that did not complete. */
      incomplete: string[];
      /** Window boundary ms at which the abort occurred. */
      stoppedAtWindowMs: number;
      suppressions: SuppressionEntry[];
    };

// ─── yieldToFrame ────────────────────────────────────────────────

/**
 * Yield to the main-thread frame using a MessageChannel port hop rather than
 * setTimeout(0), which browsers clamp to ~4 ms after nested timeouts and would
 * consume roughly 12% of the 500 ms budget across a full pass's yields.
 */
export function yieldToFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(undefined);
  });
}

// ─── Suppression Check ───────────────────────────────────────────

/**
 * Check if a rule should be suppressed for specific nodes because its required
 * metrics are not-applicable or absent.
 *
 * Returns the suppression entry if any required metric is unavailable, else null.
 */
function checkSuppression(
  rule: AnalysisRule,
  ctx: AnalysisContext,
): SuppressionEntry | null {
  if (rule.requiredMetrics.length === 0) return null;

  const latestWindow = ctx.windows[ctx.windows.length - 1];
  if (!latestWindow) return null;

  const affectedLabels: string[] = [];

  for (const node of latestWindow.nodes) {
    for (const metric of rule.requiredMetrics) {
      if (isMetricUnavailable(node, metric)) {
        affectedLabels.push(ctx.labelOf(node.nodeId));
        break; // One missing metric is enough to suppress this node
      }
    }
  }

  if (affectedLabels.length === 0) return null;

  // Find the first unavailable metric name for the suppression record
  const metricName = rule.requiredMetrics.find((m) => {
    return latestWindow.nodes.some((n) => isMetricUnavailable(n, m));
  }) ?? rule.requiredMetrics[0]!;

  return {
    ruleId: rule.id,
    metricName,
    affectedNodeLabels: affectedLabels,
  };
}

/**
 * Check if a specific metric is not-applicable or absent for a node.
 */
function isMetricUnavailable(
  node: NodeMetricsSnapshot,
  metricName: string,
): boolean {
  if (metricName === 'utilization') {
    return node.utilization.kind === 'not-applicable';
  }
  // For other metrics, check if the value is explicitly absent/null
  const value = (node as unknown as Record<string, unknown>)[metricName];
  return value === null || value === undefined;
}

// ─── Recomputation ───────────────────────────────────────────────

/**
 * Iterate RULE_REGISTRY, with SLICE_BUDGET_MS = 33 and TOTAL_BUDGET_MS = 500.
 *
 * On reaching 500 ms: stops at the end of the slice in progress, retains and
 * keeps displaying the previously completed Finding set, never shows a partial
 * set, and reports the count and identifiers of the rules that did not complete
 * plus the window boundary at which it stopped (R41.10).
 */
export async function recompute(ctx: AnalysisContext): Promise<RecomputationResult> {
  const startedAt = performance.now();
  const findings = new FindingResultMap();
  const suppressions: SuppressionEntry[] = [];

  for (let ruleIndex = 0; ruleIndex < RULE_REGISTRY.length; ruleIndex++) {
    const rule = RULE_REGISTRY[ruleIndex]!;

    // Check suppression first (R41.5, Task 454)
    const suppression = checkSuppression(rule, ctx);
    if (suppression) {
      suppressions.push(suppression);
      // Emit no Finding for the affected nodes, but continue with other rules
    }

    // Run the rule's generator
    const it = rule.evaluate(ctx);
    let sliceStart = performance.now();

    for (;;) {
      const step = it.next();

      if (step.done) {
        // Rule completed — add its Findings to the result map (keyed by id)
        findings.addAll(step.value);
        break;
      }

      // Check total budget
      if (performance.now() - startedAt >= TOTAL_BUDGET_MS) {
        // Stop at the end of the slice in progress (R41.10)
        const incomplete = RULE_REGISTRY.slice(ruleIndex).map((r) => r.id);
        const lastWindow = ctx.windows[ctx.windows.length - 1];
        return {
          status: 'aborted',
          incomplete,
          stoppedAtWindowMs: lastWindow?.endMs ?? 0,
          suppressions,
        };
      }

      // Check slice budget — yield to frame if exceeded
      if (performance.now() - sliceStart >= SLICE_BUDGET_MS) {
        await yieldToFrame();
        sliceStart = performance.now();
      }
    }
  }

  return {
    status: 'complete',
    findings: findings.values(),
    suppressions,
  };
}

// ─── Scheduler ───────────────────────────────────────────────────

export interface SchedulerState {
  /** Whether a recomputation is currently in flight. */
  isRunning: boolean;
  /** The last completed Finding set (never a partial set). */
  lastFindings: Finding[];
  /** Suppressions from the last completed recomputation. */
  lastSuppressions: SuppressionEntry[];
  /** Rules that did not complete in the last aborted pass. */
  lastIncomplete: string[] | null;
  /** Window boundary at which the last abort occurred. */
  lastAbortedAtMs: number | null;
}

/**
 * The AnalysisScheduler drives exactly one recomputation per completed metrics
 * window boundary while Running, none between boundaries, and exactly one more
 * on entering Complete over the final analysis window (R41.7, Task 455).
 *
 * Displays no Finding below 3 completed windows and states the completed count
 * against the 3 required (Task 456).
 */
export class AnalysisScheduler {
  private _state: SchedulerState = {
    isRunning: false,
    lastFindings: [],
    lastSuppressions: [],
    lastIncomplete: null,
    lastAbortedAtMs: null,
  };

  private onUpdate: ((state: SchedulerState) => void) | null = null;

  constructor(onUpdate?: (state: SchedulerState) => void) {
    this.onUpdate = onUpdate ?? null;
  }

  get state(): SchedulerState {
    return this._state;
  }

  /**
   * Trigger a recomputation. Called at window boundaries and on Complete.
   * If a recomputation is already in flight, this call is ignored.
   */
  async triggerRecomputation(ctx: AnalysisContext, completedWindowCount: number): Promise<void> {
    if (this._state.isRunning) return;

    // Below MIN_COMPLETED_WINDOWS, display no Finding (Task 456)
    // The state remains distinguishable: lastFindings stays empty but
    // completedWindowCount is available via the store.
    if (completedWindowCount < 3) {
      this.notify();
      return;
    }

    this._state.isRunning = true;
    this.notify();

    try {
      const result = await recompute(ctx);

      if (result.status === 'complete') {
        this._state.lastFindings = result.findings;
        this._state.lastSuppressions = result.suppressions;
        this._state.lastIncomplete = null;
        this._state.lastAbortedAtMs = null;
      } else {
        // Aborted — keep displaying the previously completed set (R41.10)
        this._state.lastIncomplete = result.incomplete;
        this._state.lastAbortedAtMs = result.stoppedAtWindowMs;
        this._state.lastSuppressions = result.suppressions;
      }
    } finally {
      this._state.isRunning = false;
      this.notify();
    }
  }

  /** Reset all state (on simulation reset). */
  reset(): void {
    this._state = {
      isRunning: false,
      lastFindings: [],
      lastSuppressions: [],
      lastIncomplete: null,
      lastAbortedAtMs: null,
    };
    this.notify();
  }

  private notify(): void {
    this.onUpdate?.(this._state);
  }
}
