import type { PercentileStats } from './metrics';
import type { SerializedTopologyV2 } from '@/store/schemaMigration';
import type { ServiceObjective } from '@/analysis/AnalysisWindowStore';

// ─── Baseline Run Schema (Requirement 40, Task 523) ──────────────

export const BASELINE_SCHEMA_VERSION = 2;

/**
 * Whole-run aggregates taken from RunCumulativeAccumulator at the Complete state.
 * NOT from a window or a mean across windows (R40.6).
 */
export interface WholeRunAggregates {
  latency: PercentileStats;
  /** Successes per second over full simulated duration. */
  throughput: number;
  /** (totalTerminations - successCount) / totalTerminations over the full run. */
  errorRate: number;
  /** Per terminal-status rates: count / totalTerminations. */
  terminalStatusRates: Record<string, number>;
}

/**
 * Per-node aggregates stored in a baseline record (R40.7).
 */
export interface PerNodeAggregates {
  nodeId: string;
  nodeType: string;
  label: string;
  /** Mean per-window utilization across completed windows. */
  meanUtilization: number;
  /** Success terminations / simulated seconds (whole-run). */
  throughput: number;
  /** Node error rate over full duration. */
  errorRate: number;
  /** Mean queue depth across windows. */
  meanQueueDepth: number;
  /** Configuration snapshot for parameter diffing. */
  config: Record<string, unknown>;
}

/**
 * A retained baseline run at schema version 2 (Task 523).
 */
export interface BaselineRun {
  schemaVersion: 2;
  /** 1–40 chars trimmed, case-insensitively unique. */
  name: string;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  seed: number;
  simulatedDurationMs: number;
  totalOfferedRps: number;
  objective?: ServiceObjective;
  /** Full v2 topology for reuse (positions, configs, policies, weights, groups). */
  topology: SerializedTopologyV2;
  /** Whole-run aggregates from RunCumulativeAccumulator. */
  wholeRun: WholeRunAggregates;
  /** Per-node aggregates keyed by node id. */
  perNode: Record<string, PerNodeAggregates>;
}

// ─── Validation ──────────────────────────────────────────────────

export const BASELINE_NAME_MIN_LENGTH = 1;
export const BASELINE_NAME_MAX_LENGTH = 40;
export const BASELINE_MAX_RECORDS = 5;
export const BASELINE_STORAGE_KEY = 'analysys_baseline_runs';

export interface BaselineValidationError {
  constraint: string;
  storedNames?: string[];
}

/**
 * Validate baseline name: 1–40 chars after trimming, case-insensitively unique.
 */
export function validateBaselineName(
  name: string,
  existingNames: string[],
): BaselineValidationError | null {
  const trimmed = name.trim();
  if (trimmed.length < BASELINE_NAME_MIN_LENGTH || trimmed.length > BASELINE_NAME_MAX_LENGTH) {
    return {
      constraint: `Name must be ${BASELINE_NAME_MIN_LENGTH} to ${BASELINE_NAME_MAX_LENGTH} characters after trimming (got ${trimmed.length}).`,
    };
  }

  const lowerTrimmed = trimmed.toLowerCase();
  const duplicate = existingNames.find((n) => n.toLowerCase() === lowerTrimmed);
  if (duplicate) {
    return {
      constraint: `Name "${trimmed}" is not case-insensitively unique (conflicts with "${duplicate}").`,
      storedNames: existingNames,
    };
  }

  return null;
}

/**
 * Validate the 5-record limit.
 */
export function validateBaselineLimit(existingNames: string[]): BaselineValidationError | null {
  if (existingNames.length >= BASELINE_MAX_RECORDS) {
    return {
      constraint: `At most ${BASELINE_MAX_RECORDS} baseline records allowed. Delete one to save a new baseline.`,
      storedNames: existingNames,
    };
  }
  return null;
}
