import { create } from 'zustand';
import type { Finding, SuppressionEntry } from '@/types/findings';
import { FINDING_CATEGORY_ORDER } from '@/types/findings';
import type { MetricsBatchPayload } from '@/types/metrics';
import type { SimulationNode } from '@/types/nodes';
import type { EdgeData } from '@/types/edges';
import type { SimEventLogEntry } from '@/types/messages';
import { SimState } from '@/simulation/types';
import {
  AnalysisWindowStore,
  MIN_COMPLETED_WINDOWS,
  type ServiceObjective,
} from '@/analysis/AnalysisWindowStore';
import { AnalysisScheduler } from '@/analysis/AnalysisScheduler';

// ─── Display Order (R35.8) ───────────────────────────────────────

/**
 * Sort Findings in the R35.8 display order:
 * 1. Category (declaration order in FindingCategory)
 * 2. Severity (Critical > Warning > Info)
 * 3. Confidence (High > Medium > Low)
 * Tie-break: ascending stable identifier.
 */
const SEVERITY_RANK: Record<string, number> = { Critical: 0, Warning: 1, Info: 2 };
const CONFIDENCE_RANK: Record<string, number> = { High: 0, Medium: 1, Low: 2 };

export function sortFindingsForDisplay(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    // Category order
    const catA = FINDING_CATEGORY_ORDER.indexOf(a.category);
    const catB = FINDING_CATEGORY_ORDER.indexOf(b.category);
    if (catA !== catB) return catA - catB;

    // Severity
    const sevA = SEVERITY_RANK[a.severity] ?? 9;
    const sevB = SEVERITY_RANK[b.severity] ?? 9;
    if (sevA !== sevB) return sevA - sevB;

    // Confidence
    const confA = CONFIDENCE_RANK[a.confidence] ?? 9;
    const confB = CONFIDENCE_RANK[b.confidence] ?? 9;
    if (confA !== confB) return confA - confB;

    // Tie-break: ascending stable identifier
    return a.id.localeCompare(b.id);
  });
}

// ─── Imported Finding Set Label ──────────────────────────────────

export interface ImportedSetLabel {
  seed: number;
  simulatedDurationMs: number;
  offeredLoadRps: number;
}

// ─── Store State ─────────────────────────────────────────────────

interface AnalysisState {
  /** Current recomputed Finding set (sorted for display). */
  findings: Finding[];
  /** Suppressions from the last recomputation. */
  suppressions: SuppressionEntry[];
  /** Whether a recomputation is currently in flight. */
  isRecomputing: boolean;
  /** Number of completed (non-zero-duration) windows received. */
  completedWindowCount: number;
  /** Rules that did not complete in the last aborted pass. */
  incompleteRules: string[] | null;
  /** Window boundary at which the last abort occurred. */
  abortedAtWindowMs: number | null;

  /** Imported Finding set (retained until a subsequent run produces a recomputed set). */
  importedFindings: Finding[] | null;
  /** Label for the imported set (seed, duration, offered load). */
  importedLabel: ImportedSetLabel | null;

  /** Sweep results placeholder. */
  sweepResults: unknown | null;
  /** Comparison results placeholder. */
  comparisonResults: unknown | null;
}

// ─── Store Actions ───────────────────────────────────────────────

interface AnalysisActions {
  /** Handle a METRICS_BATCH window boundary. */
  onMetricsBatch: (
    payload: MetricsBatchPayload,
    topology: { nodes: SimulationNode[]; edges: EdgeData[] },
    eventLog: readonly SimEventLogEntry[],
    simState: SimState,
    serviceObjective?: ServiceObjective,
  ) => void;
  /** Handle simulation entering Complete state. */
  onSimComplete: (
    topology: { nodes: SimulationNode[]; edges: EdgeData[] },
    eventLog: readonly SimEventLogEntry[],
    serviceObjective?: ServiceObjective,
  ) => void;
  /** Set an imported Finding set. */
  setImportedFindings: (findings: Finding[], label: ImportedSetLabel) => void;
  /** Clear imported findings. */
  clearImportedFindings: () => void;
  /** Reset all analysis state (on simulation reset). */
  resetAnalysis: () => void;
}

// ─── Module-scoped Instances ─────────────────────────────────────

const windowStore = new AnalysisWindowStore();
let scheduler: AnalysisScheduler | null = null;

// ─── Store ───────────────────────────────────────────────────────

export const useAnalysisStore = create<AnalysisState & AnalysisActions>()((set, get) => {
  // Create scheduler with update callback
  scheduler = new AnalysisScheduler((state) => {
    set({
      findings: sortFindingsForDisplay(state.lastFindings),
      suppressions: state.lastSuppressions,
      isRecomputing: state.isRunning,
      incompleteRules: state.lastIncomplete,
      abortedAtWindowMs: state.lastAbortedAtMs,
    });
  });

  return {
    findings: [],
    suppressions: [],
    isRecomputing: false,
    completedWindowCount: 0,
    incompleteRules: null,
    abortedAtWindowMs: null,
    importedFindings: null,
    importedLabel: null,
    sweepResults: null,
    comparisonResults: null,

    // ─── Actions ─────────────────────────────────────────────────

    onMetricsBatch: (payload, topology, eventLog, simState, serviceObjective) => {
      // Only drive recomputation while Running (Task 455)
      if (simState !== SimState.Running) return;

      const isCompletedBoundary = windowStore.pushBatch(payload);
      const completedCount = windowStore.completedWindowCount;
      set({ completedWindowCount: completedCount });

      // Drive exactly one recomputation per completed window boundary (Task 455)
      if (!isCompletedBoundary) return;

      // Clear imported findings once a recomputed set is produced (Task 458)
      const current = get();
      if (current.importedFindings !== null && completedCount >= MIN_COMPLETED_WINDOWS) {
        set({ importedFindings: null, importedLabel: null });
      }

      const ctx = windowStore.buildContext(topology, eventLog, serviceObjective);
      void scheduler?.triggerRecomputation(ctx, completedCount);
    },

    onSimComplete: (topology, eventLog, serviceObjective) => {
      // Exactly one more recomputation on entering Complete (Task 455)
      const completedCount = windowStore.completedWindowCount;
      const ctx = windowStore.buildContext(topology, eventLog, serviceObjective);
      void scheduler?.triggerRecomputation(ctx, completedCount);
    },

    setImportedFindings: (findings, label) => {
      // Display imported Findings in R35.8 order (Task 462)
      set({
        importedFindings: sortFindingsForDisplay(findings),
        importedLabel: label,
      });
    },

    clearImportedFindings: () => {
      set({ importedFindings: null, importedLabel: null });
    },

    resetAnalysis: () => {
      windowStore.reset();
      scheduler?.reset();
      set({
        findings: [],
        suppressions: [],
        isRecomputing: false,
        completedWindowCount: 0,
        incompleteRules: null,
        abortedAtWindowMs: null,
        importedFindings: null,
        importedLabel: null,
        sweepResults: null,
        comparisonResults: null,
      });
    },
  };
});
