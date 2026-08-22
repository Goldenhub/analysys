import type { NodeType } from './nodes';

// ─── Finding Category ────────────────────────────────────────────

/**
 * The declaration order IS the R35.8 tie-break display order
 * and the R43.2 group order.
 */
export type FindingCategory =
  | 'Bottleneck'
  | 'Saturation'
  | 'Instability'
  | 'Capacity'
  | 'Single_Point_Of_Failure'
  | 'Reliability'
  | 'Configuration'
  | 'Comparison';

/** Ordered array for iteration and comparison. */
export const FINDING_CATEGORY_ORDER: readonly FindingCategory[] = [
  'Bottleneck',
  'Saturation',
  'Instability',
  'Capacity',
  'Single_Point_Of_Failure',
  'Reliability',
  'Configuration',
  'Comparison',
] as const;

// ─── Severity & Confidence ───────────────────────────────────────

export type Severity = 'Critical' | 'Warning' | 'Info';
export type Confidence = 'High' | 'Medium' | 'Low';

export const SEVERITY_VALUES: readonly Severity[] = ['Critical', 'Warning', 'Info'] as const;
export const CONFIDENCE_VALUES: readonly Confidence[] = ['High', 'Medium', 'Low'] as const;

// ─── Evidence ────────────────────────────────────────────────────

export interface EvidenceEntry {
  /** Metric name, 1–100 characters. */
  metricName: string;
  /** Finite value, rounded to 6 dp half-up before storage. */
  value: number;
  /**
   * 1–20 characters.
   * 'fraction' for a dimensionless 0.0–1.0 ratio,
   * 'percent' for a value scaled to 100 (R41.11).
   */
  unit: string;
  /** A subject node identifier, or SYSTEM_WIDE_SCOPE. */
  scope: string;
  /** Exactly one entry per Finding carries this (R35.2). */
  primary?: true;
}

// ─── Recommended Actions ─────────────────────────────────────────

export interface RecommendedAction {
  nodeId: string;
  parameter: string;
  direction: 'increase' | 'decrease';
  targetValue?: { value: number; unit: string };
  multiplier?: number;
}

/**
 * R39.7 replaces parameter/direction/target with a structural change
 * for SPOF Findings.
 */
export interface StructuralAction {
  nodeId: string;
  nodeType: NodeType;
  change: 'add-redundant-instance-behind-a-Load_Balancer-node' | 'add-alternative-path';
  nodesAdded: number;
  edgesAdded: number;
}

// ─── Finding ─────────────────────────────────────────────────────

export const SYSTEM_WIDE_SCOPE = 'SYSTEM_WIDE';

export interface Finding {
  /** Stable identifier: `${ruleId}:${category}:${sortedSubjectNodeIds.join(',')}`. */
  id: string;
  category: FindingCategory;
  severity: Severity;
  /** 0–200 entries; empty means system-wide scope. */
  subjectNodeIds: string[];
  /** 1–20 entries, exactly one primary. */
  evidence: EvidenceEntry[];
  /** 1–500 characters. */
  constraint: string;
  action: RecommendedAction | StructuralAction;
  /** 1–500 characters. */
  tradeoff: string;
  confidence: Confidence;
  window: { startMs: number; endMs: number };
}

// ─── Suppression ─────────────────────────────────────────────────

export interface SuppressionEntry {
  ruleId: string;
  metricName: string;
  affectedNodeLabels: string[];
}

// ─── Report Schema ───────────────────────────────────────────────

export const REPORT_SCHEMA_VERSION = 1;

export interface AnalysisReport {
  schemaVersion: number;
  seed: number;
  simulatedDurationMs: number;
  offeredLoadRps: number;
  findings: Finding[];
  topology: { nodes: unknown[]; edges: unknown[] };
  nodeConfigurations: Record<string, unknown>;
}
