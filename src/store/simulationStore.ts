import { create } from 'zustand';
import { SimState } from '@/simulation/types';
import type { MetricsBatchPayload } from '@/types/metrics';
import type { MainToWorkerMessage, WorkerToMainMessage, SimEventLogEntry } from '@/types/messages';
import { useAnalysisStore } from '@/store/analysisStore';
import { useTopologyStore } from '@/store/topologyStore';
import type { SimulationNode } from '@/types/nodes';
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
  resetMetrics: () => void;
  initWorker: () => void;
  terminateWorker: () => void;
  sendToWorker: (msg: MainToWorkerMessage) => void;
}

// ─── Worker Instance (module-scoped, not part of store state) ────

let worker: Worker | null = null;

// ─── Store ───────────────────────────────────────────────────────

export const useSimulationStore = create<SimulationState & SimulationActions>()((set) => ({
  simState: SimState.Idle,
  speedMultiplier: 1,
  metrics: null,
  eventLog: [],
  nodeStatuses: new Map(),
  activeChaosEffects: [],
  chaosMetricsSnapshots: [],

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

  appendEventLog: (entries) => set((state) => ({ eventLog: [...state.eventLog, ...entries] })),

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

  resetMetrics: () =>
    set({
      metrics: null,
      eventLog: [],
      nodeStatuses: new Map(),
      activeChaosEffects: [],
      chaosMetricsSnapshots: [],
    }),

  // ─── Worker Lifecycle ────────────────────────────────────────

  initWorker: () => {
    if (worker) {
      worker.terminate();
    }

    worker = new Worker(new URL('../simulation/simulation.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (event: MessageEvent<WorkerToMainMessage>) => {
      const msg = event.data;

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
            useAnalysisStore.getState().onMetricsBatch(
              msg.payload,
              topology,
              eventLog,
              simState,
            );
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
        case 'ERROR':
          console.error('[SimWorker]', msg.payload.message, msg.payload.stack);
          break;
      }
    };
  },

  terminateWorker: () => {
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
}));
