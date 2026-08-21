import { create } from 'zustand';
import { SimState } from '@/simulation/types';
import type { MetricsBatchPayload } from '@/types/metrics';
import type {
  MainToWorkerMessage,
  WorkerToMainMessage,
  SimEventLogEntry,
} from '@/types/messages';

// ─── Store State ─────────────────────────────────────────────────

interface SimulationState {
  simState: SimState;
  speedMultiplier: number;
  metrics: MetricsBatchPayload | null;
  eventLog: SimEventLogEntry[];
  nodeStatuses: Map<string, 'green' | 'yellow' | 'red'>;
}

// ─── Store Actions ───────────────────────────────────────────────

interface SimulationActions {
  setSimState: (state: SimState) => void;
  setSpeed: (multiplier: number) => void;
  updateMetrics: (payload: MetricsBatchPayload) => void;
  appendEventLog: (entries: SimEventLogEntry[]) => void;
  setNodeStatus: (nodeId: string, status: 'green' | 'yellow' | 'red') => void;
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

  // ─── State Actions ───────────────────────────────────────────

  setSimState: (simState) => set({ simState }),

  setSpeed: (multiplier) => set({ speedMultiplier: multiplier }),

  updateMetrics: (payload) => set({ metrics: payload }),

  appendEventLog: (entries) =>
    set((state) => ({ eventLog: [...state.eventLog, ...entries] })),

  setNodeStatus: (nodeId, status) =>
    set((state) => {
      const next = new Map(state.nodeStatuses);
      next.set(nodeId, status);
      return { nodeStatuses: next };
    }),

  resetMetrics: () =>
    set({
      metrics: null,
      eventLog: [],
      nodeStatuses: new Map(),
    }),

  // ─── Worker Lifecycle ────────────────────────────────────────

  initWorker: () => {
    if (worker) {
      worker.terminate();
    }

    worker = new Worker(
      new URL('../simulation/simulation.worker.ts', import.meta.url),
      { type: 'module' },
    );

    worker.onmessage = (event: MessageEvent<WorkerToMainMessage>) => {
      const msg = event.data;

      switch (msg.type) {
        case 'METRICS_BATCH':
          useSimulationStore.getState().updateMetrics(msg.payload);
          break;
        case 'NODE_STATUS':
          useSimulationStore.getState().setNodeStatus(msg.payload.nodeId, msg.payload.status);
          break;
        case 'EVENT_LOG':
          useSimulationStore.getState().appendEventLog(msg.payload);
          break;
        case 'SIM_COMPLETE':
          useSimulationStore.getState().setSimState(SimState.Complete);
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
