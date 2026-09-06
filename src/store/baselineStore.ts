import { create } from 'zustand';
import type {
  BaselineRun,
  WholeRunAggregates,
  PerNodeAggregates,
  BaselineValidationError,
} from '@/types/baseline';
import {
  BASELINE_SCHEMA_VERSION,
  BASELINE_STORAGE_KEY,
  validateBaselineName,
  validateBaselineLimit,
} from '@/types/baseline';
import type { SerializedTopologyV3 } from './schemaMigration';
import type { ServiceObjective } from '@/analysis/AnalysisWindowStore';

// ─── Required Fields for v3 Validation (Task 527) ────────────────

const REQUIRED_BASELINE_FIELDS: (keyof BaselineRun)[] = [
  'schemaVersion',
  'name',
  'createdAt',
  'seed',
  'simulatedDurationMs',
  'totalOfferedRps',
  'topology',
  'wholeRun',
  'perNode',
];

// ─── localStorage Helpers ────────────────────────────────────────

function loadBaselinesFromStorage(): { baselines: BaselineRun[]; warnings: string[] } {
  const warnings: string[] = [];
  try {
    const raw = localStorage.getItem(BASELINE_STORAGE_KEY);
    if (!raw) return { baselines: [], warnings };

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      warnings.push('[Baseline] Stored data is not an array; starting empty.');
      return { baselines: [], warnings };
    }

    const valid: BaselineRun[] = [];
    for (const record of parsed) {
      if (typeof record !== 'object' || record === null) {
        warnings.push(`[Baseline] Skipping non-object record.`);
        continue;
      }

      // R40.4 — only accept the current schema version
      if (record.schemaVersion !== BASELINE_SCHEMA_VERSION) {
        warnings.push(
          `[Baseline] Excluding record "${record.name ?? '(unnamed)'}" — schema version ${record.schemaVersion} is not ${BASELINE_SCHEMA_VERSION}.`,
        );
        continue;
      }

      // Check required fields
      let missingField: string | null = null;
      for (const field of REQUIRED_BASELINE_FIELDS) {
        if (!(field in record) || record[field] === undefined || record[field] === null) {
          missingField = field;
          break;
        }
      }
      if (missingField) {
        warnings.push(
          `[Baseline] Excluding record "${record.name ?? '(unnamed)'}" — missing required field "${missingField}".`,
        );
        continue;
      }

      valid.push(record as BaselineRun);
    }

    return { baselines: valid, warnings };
  } catch (e) {
    warnings.push(`[Baseline] Failed to parse stored baselines: ${String(e)}`);
    return { baselines: [], warnings };
  }
}

function persistBaselines(baselines: BaselineRun[]): void {
  localStorage.setItem(BASELINE_STORAGE_KEY, JSON.stringify(baselines));
}

// ─── Store State ─────────────────────────────────────────────────

interface BaselineState {
  baselines: BaselineRun[];
  loadWarnings: string[];
}

// ─── Store Actions ───────────────────────────────────────────────

interface BaselineActions {
  /**
   * Write a baseline from the Complete state (Task 524).
   * Returns null on success, or a validation error on failure.
   */
  retainBaseline: (params: {
    name: string;
    seed: number;
    simulatedDurationMs: number;
    totalOfferedRps: number;
    objective?: ServiceObjective;
    topology: SerializedTopologyV3;
    wholeRun: WholeRunAggregates;
    perNode: Record<string, PerNodeAggregates>;
  }) => BaselineValidationError | null;

  /** Delete a single baseline by name, leaving others unchanged (Task 525). */
  deleteBaseline: (name: string) => void;

  /** List baselines by name and creation timestamp. */
  listBaselines: () => Array<{ name: string; createdAt: string }>;

  /** Get a full baseline record by name. */
  getBaseline: (name: string) => BaselineRun | undefined;

  /** Reload from localStorage (e.g. on app startup). */
  reloadFromStorage: () => void;
}

// ─── Store ───────────────────────────────────────────────────────

const initial = loadBaselinesFromStorage();

export const useBaselineStore = create<BaselineState & BaselineActions>()((set, get) => ({
  baselines: initial.baselines,
  loadWarnings: initial.warnings,

  retainBaseline: (params) => {
    const state = get();
    const existingNames = state.baselines.map((b) => b.name);

    // Validate limit (Task 526)
    const limitError = validateBaselineLimit(existingNames);
    if (limitError) return limitError;

    // Validate name (Task 526)
    const nameError = validateBaselineName(params.name, existingNames);
    if (nameError) return nameError;

    const record: BaselineRun = {
      schemaVersion: 3,
      name: params.name.trim(),
      createdAt: new Date().toISOString(),
      seed: params.seed,
      simulatedDurationMs: params.simulatedDurationMs,
      totalOfferedRps: params.totalOfferedRps,
      objective: params.objective,
      topology: params.topology,
      wholeRun: params.wholeRun,
      perNode: params.perNode,
    };

    set((s) => {
      const updated = [...s.baselines, record];
      persistBaselines(updated);
      return { baselines: updated };
    });

    return null;
  },

  deleteBaseline: (name) => {
    set((s) => {
      const updated = s.baselines.filter((b) => b.name !== name);
      persistBaselines(updated);
      return { baselines: updated };
    });
  },

  listBaselines: () => {
    return get().baselines.map((b) => ({ name: b.name, createdAt: b.createdAt }));
  },

  getBaseline: (name) => {
    return get().baselines.find((b) => b.name === name);
  },

  reloadFromStorage: () => {
    const { baselines, warnings } = loadBaselinesFromStorage();
    if (warnings.length > 0) {
      for (const w of warnings) console.warn(w);
    }
    set({ baselines, loadWarnings: warnings });
  },
}));
