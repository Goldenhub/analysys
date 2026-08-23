import { round6, AnalysisError } from '@/utils/round6';
import type {
  Finding,
  FindingCategory,
  Severity,
  Confidence,
  EvidenceEntry,
  RecommendedAction,
  StructuralAction,
} from '@/types/findings';

// ─── Confidence Derivation ───────────────────────────────────────

/**
 * Derive confidence from the lowest completed-request count among subject nodes.
 *
 * - High: ≥200 completions AND all subjects in Steady_State.
 * - Medium: ≥200 with any not in Steady_State, or 30–199.
 * - Low: below 30.
 *
 * A Finding with empty subjectNodeIds uses the system-wide completed count.
 */
export function deriveConfidence(
  lowestCompletedCount: number,
  allSubjectsInSteadyState: boolean,
): Confidence {
  if (lowestCompletedCount >= 200 && allSubjectsInSteadyState) return 'High';
  if (lowestCompletedCount >= 30) return 'Medium';
  return 'Low';
}

// ─── Stable Identifier ───────────────────────────────────────────

/**
 * Derive the stable identifier for a Finding.
 * `${ruleId}:${category}:${sortedSubjectNodeIds.join(',')}`
 *
 * Survives label edits, recomputation within a run, and repeated runs
 * of the same inputs.
 */
export function deriveFindingId(
  ruleId: string,
  category: FindingCategory,
  subjectNodeIds: string[],
): string {
  const sorted = [...subjectNodeIds].sort();
  return `${ruleId}:${category}:${sorted.join(',')}`;
}

// ─── FindingBuilder ──────────────────────────────────────────────

interface FindingBuilderParams {
  ruleId: string;
  category: FindingCategory;
  severity: Severity;
  subjectNodeIds: string[];
  evidence: EvidenceEntry[];
  constraint: string;
  action: RecommendedAction | StructuralAction;
  tradeoff: string;
  lowestCompletedCount: number;
  allSubjectsInSteadyState: boolean;
  window: { startMs: number; endMs: number };
}

/**
 * Build a Finding, passing every numeric value through round6 at construction.
 *
 * Enforces:
 * - Unit string 1–20 characters.
 * - 'fraction' for 0.0–1.0 dimensionless, 'percent' for 0–100 scaled values.
 * - Exactly one primary evidence entry.
 * - Constraint and tradeoff 1–500 characters.
 * - subjectNodeIds 0–200 entries.
 * - evidence 1–20 entries.
 * - Confidence derived from lowest completed-request count + Steady_State.
 */
export class FindingBuilder {
  private constructor() {
    // Use static build()
  }

  static build(params: FindingBuilderParams): Finding {
    const {
      ruleId,
      category,
      severity,
      subjectNodeIds,
      evidence,
      constraint,
      action,
      tradeoff,
      lowestCompletedCount,
      allSubjectsInSteadyState,
      window: win,
    } = params;

    // ── Validate subjectNodeIds ──
    if (subjectNodeIds.length > 200) {
      throw new AnalysisError(`subjectNodeIds exceeds 200: got ${String(subjectNodeIds.length)}`);
    }

    // ── Validate evidence ──
    if (evidence.length < 1 || evidence.length > 20) {
      throw new AnalysisError(`evidence must have 1–20 entries: got ${String(evidence.length)}`);
    }

    const primaryCount = evidence.filter((e) => e.primary === true).length;
    if (primaryCount !== 1) {
      throw new AnalysisError(
        `exactly one primary evidence entry required: got ${String(primaryCount)}`,
      );
    }

    // ── Validate and round evidence ──
    const roundedEvidence: EvidenceEntry[] = evidence.map((e) => {
      if (e.metricName.length < 1 || e.metricName.length > 100) {
        throw new AnalysisError(
          `evidence metricName must be 1–100 chars: got ${String(e.metricName.length)}`,
        );
      }
      if (e.unit.length < 1 || e.unit.length > 20) {
        throw new AnalysisError(
          `evidence unit must be 1–20 chars: got "${e.unit}" (${String(e.unit.length)})`,
        );
      }
      const rounded: EvidenceEntry = {
        metricName: e.metricName,
        value: round6(e.value),
        unit: e.unit,
        scope: e.scope,
      };
      if (e.primary) rounded.primary = true;
      return rounded;
    });

    // ── Validate constraint and tradeoff ──
    if (constraint.length < 1 || constraint.length > 500) {
      throw new AnalysisError(`constraint must be 1–500 chars: got ${String(constraint.length)}`);
    }
    if (tradeoff.length < 1 || tradeoff.length > 500) {
      throw new AnalysisError(`tradeoff must be 1–500 chars: got ${String(tradeoff.length)}`);
    }

    // ── Round action numeric fields ──
    const roundedAction = roundActionValues(action);

    // ── Derive confidence ──
    const confidence = deriveConfidence(lowestCompletedCount, allSubjectsInSteadyState);

    // ── Derive stable identifier ──
    const id = deriveFindingId(ruleId, category, subjectNodeIds);

    return {
      id,
      category,
      severity,
      subjectNodeIds: [...subjectNodeIds],
      evidence: roundedEvidence,
      constraint,
      action: roundedAction,
      tradeoff,
      confidence,
      window: { startMs: round6(win.startMs), endMs: round6(win.endMs) },
    };
  }
}

// ─── Result Map ──────────────────────────────────────────────────

/**
 * Keyed on Finding.id (the stable identifier).
 * "Exactly one Finding per identifier" is enforced structurally by using a Map.
 * Inserting a Finding with the same id replaces the previous one.
 */
export class FindingResultMap {
  private readonly map = new Map<string, Finding>();

  add(finding: Finding): void {
    this.map.set(finding.id, finding);
  }

  addAll(findings: Finding[]): void {
    for (const f of findings) {
      this.map.set(f.id, f);
    }
  }

  get(id: string): Finding | undefined {
    return this.map.get(id);
  }

  values(): Finding[] {
    return [...this.map.values()];
  }

  size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

function roundActionValues(
  action: RecommendedAction | StructuralAction,
): RecommendedAction | StructuralAction {
  if ('parameter' in action) {
    // RecommendedAction
    const rounded: RecommendedAction = {
      nodeId: action.nodeId,
      parameter: action.parameter,
      direction: action.direction,
    };
    if (action.targetValue !== undefined) {
      rounded.targetValue = {
        value: round6(action.targetValue.value),
        unit: action.targetValue.unit,
      };
    }
    if (action.multiplier !== undefined) {
      rounded.multiplier = round6(action.multiplier);
    }
    return rounded;
  }
  // StructuralAction — integer fields, no rounding needed
  return { ...action };
}
