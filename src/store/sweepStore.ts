import { create } from 'zustand';
import type { SweepConfig, SweepStepResult, SweepReport } from '@/analysis/CapacitySweepController';
import { determineSweepResults } from '@/analysis/CapacitySweepController';
import type { SweepStepCompletePayload } from '@/types/messages';

export type SweepStatus = 'idle' | 'running' | 'completed' | 'cancelled';

export interface CapacitySweepState {
  status: SweepStatus;
  /** The configuration the current/last sweep ran with. */
  config: SweepConfig | null;
  /** 0-based index of the step currently executing. */
  currentStepIndex: number;
  results: SweepStepResult[];
  report: SweepReport | null;
}

export interface CapacitySweepActions {
  beginSweep: (config: CapacitySweepState['config']) => void;
  onStepComplete: (payload: SweepStepCompletePayload) => void;
  finalizeSweep: (status: Extract<SweepStatus, 'completed' | 'cancelled'>) => void;
  resetSweep: () => void;
}

const initialState: CapacitySweepState = {
  status: 'idle',
  config: null,
  currentStepIndex: 0,
  results: [],
  report: null,
};

/**
 * Pure state + result accumulation for a capacity sweep run.
 * Step dispatch and worker ownership live in simulationStore; this store only
 * tracks progress, appends completed steps, and finalizes the report.
 */
export const useSweepStore = create<CapacitySweepState & CapacitySweepActions>()((set, get) => ({
  ...initialState,

  beginSweep: (config) => set({ ...initialState, status: 'running', config }),

  onStepComplete: (payload) => {
    const { status, results } = get();
    if (status !== 'running') return;
    set({
      results: [...results, payloadToResult(payload)],
      currentStepIndex: payload.stepIndex + 1,
    });
  },

  finalizeSweep: (status) => {
    const { config, results } = get();
    if (!config) return;

    let report: SweepReport;
    if (status === 'cancelled') {
      report = {
        status: 'cancelled',
        cancelledAtStep: results.length,
        steps: results,
        kneePoint: null,
        sustainableLoad: { offeredRps: null },
        nonMonotonicSteps: [],
        warnings: [],
      };
    } else {
      const determination = determineSweepResults(results, config);
      report = {
        status: 'completed',
        steps: results,
        kneePoint: determination.kneePoint,
        sustainableLoad: determination.sustainableLoad,
        nonMonotonicSteps: determination.nonMonotonicSteps,
        warnings: [],
      };
    }

    set({ status, report });
  },

  resetSweep: () => set(initialState),
}));

function payloadToResult(payload: SweepStepCompletePayload): SweepStepResult {
  return {
    stepIndex: payload.stepIndex,
    requestedRps: payload.requestedRps,
    appliedRps: payload.appliedRps,
    achievedThroughput: payload.achievedThroughput,
    latency: payload.latency,
    totalErrorRate: payload.totalErrorRate,
    terminalCounts: payload.terminalCounts,
    schedulerJobsEmitted: payload.schedulerJobsEmitted,
    measurementInterval: payload.measurementInterval,
    verdict: payload.verdict,
  };
}
