import { create } from 'zustand';
import { SimState } from '@/simulation/types';
import type { MetricsBatchPayload } from '@/types/metrics';
import {
  DEFAULT_MAX_HOPS_PER_REQUEST,
  type MainToWorkerMessage,
  type WorkerToMainMessage,
  type SimEventLogEntry,
  type SimulationSummary,
} from '@/types/messages';
import { useAnalysisStore } from '@/store/analysisStore';
import { useTopologyStore } from '@/store/topologyStore';
import { useSweepStore } from '@/store/sweepStore';
import { showToast } from '@/components/ui/toastStore';
import {
  computeStepLoads,
  splitAcrossGenerators,
  validateSweepConfig,
  type SweepConfig,
  type GeneratorInfo,
} from '@/analysis/CapacitySweepController';
import type { SimulationNode } from '@/types/nodes';
import { NodeType } from '@/types/nodes';
import type { EdgeData } from '@/types/edges';

// ─── Chaos Effect ────────────────────────────────────────────────

export interface ActiveChaosEffect {
  id: string;
  chaosType: string;
  targetNodeId?: string;
  label: string;
  description: string;
  startTimeMs: number;
  durationMs: number;
}

// ─── Metrics Snapshot for Impact Comparison ─────────────────────

export interface ChaosMetricsSnapshot {
  effectId: string;
  latencyP50: number;
  latencyP99: number;
  errorRate: number;
  throughput: number;
}

// ─── Store State ─────────────────────────────────────────────────

interface SimulationState {
  simState: SimState;
  speedMultiplier: number;
  metrics: MetricsBatchPayload | null;
  eventLog: SimEventLogEntry[];
  nodeStatuses: Map<string, 'green' | 'yellow' | 'red'>;
  activeChaosEffects: ActiveChaosEffect[];
  chaosMetricsSnapshots: ChaosMetricsSnapshot[];
  /** Whole-run totals from the worker's SIM_COMPLETE (requests, success rate, seed…). */
  runSummary: SimulationSummary | null;
  /** Last error reported by the worker — surfaced in-app, not just the console. */
  workerError: string | null;
}

// ─── Store Actions ───────────────────────────────────────────────

interface SimulationActions {
  setSimState: (state: SimState) => void;
  setSpeed: (multiplier: number) => void;
  updateMetrics: (payload: MetricsBatchPayload) => void;
  appendEventLog: (entries: SimEventLogEntry[]) => void;
  setNodeStatus: (nodeId: string, status: 'green' | 'yellow' | 'red') => void;
  addChaosEffect: (effect: ActiveChaosEffect) => void;
  removeChaosEffect: (id: string) => void;
  addChaosMetricsSnapshot: (snapshot: ChaosMetricsSnapshot) => void;
  removeChaosMetricsSnapshot: (effectId: string) => void;
  setRunSummary: (summary: SimulationSummary | null) => void;
  setWorkerError: (message: string | null) => void;
  resetMetrics: () => void;
  initWorker: () => void;
  terminateWorker: () => void;
  sendToWorker: (msg: MainToWorkerMessage) => void;
  /** Validate, then drive a capacity sweep step-by-step through the worker. */
  startCapacitySweep: (config: SweepConfig) => void;
  cancelCapacitySweep: () => void;
}

// ─── Worker Instance (module-scoped, not part of store state) ────

let worker: Worker | null = null;

/**
 * Ring-buffer cap for the UI event log. The store previously grew without
 * bound (one full array copy per batch, retained for the whole run). The
 * EventLog panel renders only the tail and analysis rules need recent history,
 * so the oldest entries are dropped once the cap is hit.
 */
const MAX_EVENT_LOG_ENTRIES = 5000;

// ─── Store ───────────────────────────────────────────────────────

export const useSimulationStore = create<SimulationState & SimulationActions>()((set, get) => ({
  simState: SimState.Idle,
  speedMultiplier: 1,
  metrics: null,
  eventLog: [],
  nodeStatuses: new Map(),
  activeChaosEffects: [],
  chaosMetricsSnapshots: [],
  runSummary: null,
  workerError: null,

  // ─── State Actions ───────────────────────────────────────────

  setSimState: (simState) => set({ simState }),

  setSpeed: (multiplier) => set({ speedMultiplier: multiplier }),

  updateMetrics: (payload) =>
    set((state) => {
      // Ignore late metrics batches that arrive after pause/complete
      if (state.simState === SimState.Paused || state.simState === SimState.Complete) {
        return state;
      }
      return { metrics: payload };
    }),

  appendEventLog: (entries) =>
    set((state) => {
      const combined = [...state.eventLog, ...entries];
      return combined.length > MAX_EVENT_LOG_ENTRIES
        ? { eventLog: combined.slice(combined.length - MAX_EVENT_LOG_ENTRIES) }
        : { eventLog: combined };
    }),

  setNodeStatus: (nodeId, status) =>
    set((state) => {
      // Ignore late status updates after pause/complete
      if (state.simState === SimState.Paused || state.simState === SimState.Complete) {
        return state;
      }
      const next = new Map(state.nodeStatuses);
      next.set(nodeId, status);
      return { nodeStatuses: next };
    }),

  addChaosEffect: (effect) =>
    set((state) => ({
      activeChaosEffects: [...state.activeChaosEffects, effect],
    })),

  removeChaosEffect: (id) =>
    set((state) => ({
      activeChaosEffects: state.activeChaosEffects.filter((e) => e.id !== id),
    })),

  addChaosMetricsSnapshot: (snapshot) =>
    set((state) => ({
      chaosMetricsSnapshots: [...state.chaosMetricsSnapshots, snapshot],
    })),

  removeChaosMetricsSnapshot: (effectId) =>
    set((state) => ({
      chaosMetricsSnapshots: state.chaosMetricsSnapshots.filter((s) => s.effectId !== effectId),
    })),

  setRunSummary: (runSummary) => set({ runSummary }),

  setWorkerError: (workerError) => set({ workerError }),

  resetMetrics: () =>
    set({
      metrics: null,
      eventLog: [],
      nodeStatuses: new Map(),
      activeChaosEffects: [],
      chaosMetricsSnapshots: [],
      runSummary: null,
      workerError: null,
    }),

  // ─── Worker Lifecycle ────────────────────────────────────────

  initWorker: () => {
    if (worker) {
      worker.terminate();
    }
    // Fresh worker — clear any error from the previous one.
    set({ workerError: null });

    worker = new Worker(new URL('../simulation/simulation.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (event: MessageEvent<WorkerToMainMessage>) => {
      handleWorkerMessage(event.data);
    };
  },

  terminateWorker: () => {
    // A sweep in flight dies with the worker — finalize it so the panel
    // doesn't stay stuck on 'running'.
    if (useSweepStore.getState().status === 'running') {
      finalizeSweepCancelled();
      resetSweepDriver();
    }
    if (worker) {
      worker.terminate();
      worker = null;
    }
  },

  // ─── Send Helper ─────────────────────────────────────────────

  sendToWorker: (msg) => {
    if (!worker) {
      console.warn('[SimStore] sendToWorker called but no worker is active.');
      return;
    }
    worker.postMessage(msg);
  },

  // ─── Capacity Sweep ──────────────────────────────────────────

  startCapacitySweep: (config) => {
    const errors = validateSweepConfig(config);
    if (errors.length > 0) {
      showToast(`Sweep configuration invalid: ${errors[0]!.message}`);
      return;
    }

    if (
      useSimulationStore.getState().simState === SimState.Running ||
      useSimulationStore.getState().simState === SimState.Paused
    ) {
      showToast('Stop or reset the running simulation before starting a sweep.');
      return;
    }

    const topo = useTopologyStore.getState().getTopologySnapshot();
    const generators: GeneratorInfo[] = topo.nodes
      .filter((n) => n.nodeType === NodeType.TrafficGenerator)
      .map((n) => ({
        id: n.id,
        label: n.label,
        configuredRps: Number((n.config as unknown as Record<string, unknown>)['rps'] ?? 0),
      }));
    if (generators.length === 0) {
      showToast('A sweep needs at least one Traffic Generator in the topology.');
      return;
    }

    const loads = computeStepLoads(config.startRps, config.endRps, config.stepCount);
    if (!loads) {
      showToast('The requested step count does not fit the offered-load range.');
      return;
    }

    // Fresh worker + INIT so the worker holds this exact topology for step isolation.
    get().initWorker();
    get().sendToWorker({
      type: 'INIT',
      payload: {
        topology: topo,
        seed: Math.floor(Math.random() * 0xffffffff),
        speedMultiplier: config.speedMultiplier,
        maxSimulatedTimeMs: config.durationPerStepMs,
        metricsIntervalMs: 5000,
        maxHopsPerRequest: DEFAULT_MAX_HOPS_PER_REQUEST,
      },
    });

    useSweepStore.getState().beginSweep(config);

    sweepDriver.config = config;
    sweepDriver.loads = loads;
    sweepDriver.generators = generators;
    sweepDriver.seedBase = Math.floor(Math.random() * 0xffffffff);
    dispatchNextSweepStep();
  },

  cancelCapacitySweep: () => {
    if (useSweepStore.getState().status !== 'running') return;
    sendSweepCancel(useSweepStore.getState().currentStepIndex);
    finalizeSweepCancelled();
  },
}));

// ─── Worker Message Handling ─────────────────────────────────────

/**
 * Route one worker → main message into the stores. Exported (and used directly
 * by initWorker) so the routing is unit-testable without a real Worker.
 */
export function handleWorkerMessage(msg: WorkerToMainMessage): void {
  switch (msg.type) {
    case 'METRICS_BATCH':
      useSimulationStore.getState().updateMetrics(msg.payload);
      {
        const simState = useSimulationStore.getState().simState;
        const eventLog = useSimulationStore.getState().eventLog;
        const topoState = useTopologyStore.getState();
        const topology = {
          nodes: topoState.nodes.map((n) => n.data as SimulationNode),
          edges: topoState.edges.map((e) => e.data as EdgeData),
        };
        useAnalysisStore.getState().onMetricsBatch(msg.payload, topology, eventLog, simState);
      }
      break;
    case 'NODE_STATUS':
      useSimulationStore.getState().setNodeStatus(msg.payload.nodeId, msg.payload.status);
      break;
    case 'EVENT_LOG':
      useSimulationStore.getState().appendEventLog(msg.payload);
      break;
    case 'SIM_COMPLETE':
      useSimulationStore.getState().setSimState(SimState.Complete);
      useSimulationStore.getState().setRunSummary(msg.payload);
      {
        const eventLog = useSimulationStore.getState().eventLog;
        const topoState = useTopologyStore.getState();
        const topology = {
          nodes: topoState.nodes.map((n) => n.data as SimulationNode),
          edges: topoState.edges.map((e) => e.data as EdgeData),
        };
        useAnalysisStore.getState().onSimComplete(topology, eventLog);
      }
      break;
    case 'SWEEP_STEP_COMPLETE': {
      const sweep = useSweepStore.getState();
      if (sweep.status !== 'running') break;
      sweep.onStepComplete(msg.payload);
      dispatchNextSweepStep();
      break;
    }
    case 'ERROR':
      // Worker failures were previously console-only — invisible to users while
      // the dashboard silently showed zeros. Surface them in-app.
      console.error('[SimWorker]', msg.payload.message, msg.payload.stack);
      useSimulationStore.getState().setWorkerError(msg.payload.message);
      showToast(`Simulation error: ${msg.payload.message}`);
      break;
  }
}

// ─── Capacity Sweep Driver (module state — worker ownership lives here) ──

const sweepDriver: {
  config: SweepConfig | null;
  loads: number[] | null;
  generators: GeneratorInfo[];
  seedBase: number;
} = {
  config: null,
  loads: null,
  generators: [],
  seedBase: 0,
};

function resetSweepDriver(): void {
  sweepDriver.config = null;
  sweepDriver.loads = null;
  sweepDriver.generators = [];
}

function dispatchNextSweepStep(): void {
  const sweep = useSweepStore.getState();
  const { config, loads } = sweepDriver;
  if (!config || !loads) return;

  const idx = sweep.currentStepIndex;
  if (sweep.status !== 'running') return;
  if (idx >= loads.length) {
    sweep.finalizeSweep('completed');
    resetSweepDriver();
    return;
  }

  const split = splitAcrossGenerators(loads[idx]!, sweepDriver.generators, idx);

  useSimulationStore.getState().sendToWorker({
    type: 'SWEEP_STEP',
    payload: {
      stepIndex: idx,
      requestedRps: loads[idx]!,
      perGeneratorRps: split.perGeneratorRps,
      durationPerStepMs: config.durationPerStepMs,
      warmUpMs: config.warmUpMs,
      speedMultiplier: config.speedMultiplier,
      seed: sweepDriver.seedBase + idx,
      objective: {
        maxP99LatencyMs: config.objective.maxP99LatencyMs,
        maxErrorRate: config.objective.maxErrorRate,
      },
    },
  });
}

function sendSweepCancel(stepIndex: number): void {
  useSimulationStore.getState().sendToWorker({ type: 'SWEEP_CANCEL', payload: { stepIndex } });
}

function finalizeSweepCancelled(): void {
  useSweepStore.getState().finalizeSweep('cancelled');
}
