import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSimulationStore } from './simulationStore';
import { SimState } from '@/simulation/types';
import type { MetricsBatchPayload } from '@/types/metrics';
import type { SimEventLogEntry } from '@/types/messages';

// ─── Mock Worker ─────────────────────────────────────────────────

const mockWorkerInstances: MockWorker[] = [];

class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    mockWorkerInstances.push(this);
  }
}

vi.stubGlobal('Worker', MockWorker);

// ─── Helpers ─────────────────────────────────────────────────────

function resetStore() {
  useSimulationStore.setState({
    simState: SimState.Idle,
    speedMultiplier: 1,
    metrics: null,
    eventLog: [],
    nodeStatuses: new Map(),
  });
  // Also terminate any existing worker to reset module-level state
  useSimulationStore.getState().terminateWorker();
  mockWorkerInstances.length = 0;
}

function createMetricsBatch(): MetricsBatchPayload {
  return {
    simulatedTimeMs: 1000,
    nodes: [],
    systemWide: {
      totalThroughput: 100,
      endToEndLatency: { p50: 10, p90: 50, p99: 100 },
      totalErrorRate: 0.01,
      activeRequests: 5,
    },
  };
}

function createLogEntries(): SimEventLogEntry[] {
  return [
    { id: 1, timestamp: 100, type: 'REQUEST_ARRIVAL', nodeId: 'lb-1', message: 'Request arrived' },
    { id: 2, timestamp: 200, type: 'REQUEST_PROCESS', nodeId: 'app-1', message: 'Processing' },
  ];
}

// ─── Tests ───────────────────────────────────────────────────────

describe('simulationStore', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('has correct defaults', () => {
      const state = useSimulationStore.getState();
      expect(state.simState).toBe(SimState.Idle);
      expect(state.speedMultiplier).toBe(1);
      expect(state.metrics).toBeNull();
      expect(state.eventLog).toEqual([]);
      expect(state.nodeStatuses.size).toBe(0);
    });
  });

  describe('setSimState', () => {
    it('updates the simulation state', () => {
      useSimulationStore.getState().setSimState(SimState.Running);
      expect(useSimulationStore.getState().simState).toBe(SimState.Running);
    });

    it('transitions through all states', () => {
      const { setSimState } = useSimulationStore.getState();
      setSimState(SimState.Running);
      expect(useSimulationStore.getState().simState).toBe(SimState.Running);

      setSimState(SimState.Paused);
      expect(useSimulationStore.getState().simState).toBe(SimState.Paused);

      setSimState(SimState.Complete);
      expect(useSimulationStore.getState().simState).toBe(SimState.Complete);
    });
  });

  describe('setSpeed', () => {
    it('updates the speed multiplier', () => {
      useSimulationStore.getState().setSpeed(2.5);
      expect(useSimulationStore.getState().speedMultiplier).toBe(2.5);
    });
  });

  describe('updateMetrics', () => {
    it('sets the metrics payload', () => {
      const batch = createMetricsBatch();
      useSimulationStore.getState().updateMetrics(batch);
      expect(useSimulationStore.getState().metrics).toEqual(batch);
    });

    it('replaces previous metrics', () => {
      const batch1 = createMetricsBatch();
      const batch2 = { ...createMetricsBatch(), simulatedTimeMs: 2000 };
      useSimulationStore.getState().updateMetrics(batch1);
      useSimulationStore.getState().updateMetrics(batch2);
      expect(useSimulationStore.getState().metrics?.simulatedTimeMs).toBe(2000);
    });
  });

  describe('appendEventLog', () => {
    it('appends entries to the event log', () => {
      const entries = createLogEntries();
      useSimulationStore.getState().appendEventLog(entries);
      expect(useSimulationStore.getState().eventLog).toHaveLength(2);
    });

    it('accumulates entries across multiple appends', () => {
      const entries1 = createLogEntries();
      const entries2: SimEventLogEntry[] = [
        { id: 3, timestamp: 300, type: 'REQUEST_COMPLETE', nodeId: 'app-1', message: 'Done' },
      ];
      useSimulationStore.getState().appendEventLog(entries1);
      useSimulationStore.getState().appendEventLog(entries2);
      expect(useSimulationStore.getState().eventLog).toHaveLength(3);
    });
  });

  describe('setNodeStatus', () => {
    it('sets a node status', () => {
      useSimulationStore.getState().setNodeStatus('node-1', 'green');
      expect(useSimulationStore.getState().nodeStatuses.get('node-1')).toBe('green');
    });

    it('updates existing node status', () => {
      useSimulationStore.getState().setNodeStatus('node-1', 'green');
      useSimulationStore.getState().setNodeStatus('node-1', 'red');
      expect(useSimulationStore.getState().nodeStatuses.get('node-1')).toBe('red');
    });

    it('handles multiple nodes independently', () => {
      useSimulationStore.getState().setNodeStatus('node-1', 'green');
      useSimulationStore.getState().setNodeStatus('node-2', 'yellow');
      const statuses = useSimulationStore.getState().nodeStatuses;
      expect(statuses.get('node-1')).toBe('green');
      expect(statuses.get('node-2')).toBe('yellow');
    });
  });

  describe('resetMetrics', () => {
    it('clears metrics, eventLog, and nodeStatuses', () => {
      useSimulationStore.getState().updateMetrics(createMetricsBatch());
      useSimulationStore.getState().appendEventLog(createLogEntries());
      useSimulationStore.getState().setNodeStatus('node-1', 'red');

      useSimulationStore.getState().resetMetrics();

      const state = useSimulationStore.getState();
      expect(state.metrics).toBeNull();
      expect(state.eventLog).toEqual([]);
      expect(state.nodeStatuses.size).toBe(0);
    });
  });

  describe('worker lifecycle', () => {
    it('initWorker creates a Worker instance', () => {
      useSimulationStore.getState().initWorker();
      expect(mockWorkerInstances).toHaveLength(1);
    });

    it('initWorker terminates existing worker before creating new one', () => {
      useSimulationStore.getState().initWorker();
      const firstWorker = mockWorkerInstances[0]!;
      useSimulationStore.getState().initWorker();
      expect(firstWorker.terminate).toHaveBeenCalled();
      expect(mockWorkerInstances).toHaveLength(2);
    });

    it('terminateWorker stops the worker', () => {
      useSimulationStore.getState().initWorker();
      const workerInstance = mockWorkerInstances[0]!;
      useSimulationStore.getState().terminateWorker();
      expect(workerInstance.terminate).toHaveBeenCalled();
      // After terminate, sendToWorker should warn
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      useSimulationStore.getState().sendToWorker({ type: 'PAUSE' });
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('sendToWorker', () => {
    it('posts message to the worker', () => {
      useSimulationStore.getState().initWorker();
      const workerInstance = mockWorkerInstances[0]!;
      useSimulationStore.getState().sendToWorker({ type: 'PAUSE' });
      expect(workerInstance.postMessage).toHaveBeenCalledWith({ type: 'PAUSE' });
    });

    it('warns when no worker is active', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      useSimulationStore.getState().sendToWorker({ type: 'PAUSE' });
      expect(spy).toHaveBeenCalledWith(
        '[SimStore] sendToWorker called but no worker is active.',
      );
      spy.mockRestore();
    });
  });

  describe('worker onmessage handler', () => {
    it('dispatches METRICS_BATCH to updateMetrics', () => {
      useSimulationStore.getState().initWorker();
      const workerInstance = mockWorkerInstances[0]!;

      const batch = createMetricsBatch();
      workerInstance.onmessage?.(
        new MessageEvent('message', { data: { type: 'METRICS_BATCH', payload: batch } }),
      );

      expect(useSimulationStore.getState().metrics).toEqual(batch);
    });

    it('dispatches NODE_STATUS to setNodeStatus', () => {
      useSimulationStore.getState().initWorker();
      const workerInstance = mockWorkerInstances[0]!;

      workerInstance.onmessage?.(
        new MessageEvent('message', {
          data: { type: 'NODE_STATUS', payload: { nodeId: 'lb-1', status: 'yellow' } },
        }),
      );

      expect(useSimulationStore.getState().nodeStatuses.get('lb-1')).toBe('yellow');
    });

    it('dispatches EVENT_LOG to appendEventLog', () => {
      useSimulationStore.getState().initWorker();
      const workerInstance = mockWorkerInstances[0]!;

      const entries = createLogEntries();
      workerInstance.onmessage?.(
        new MessageEvent('message', { data: { type: 'EVENT_LOG', payload: entries } }),
      );

      expect(useSimulationStore.getState().eventLog).toHaveLength(2);
    });

    it('dispatches SIM_COMPLETE to set state to Complete', () => {
      useSimulationStore.getState().initWorker();
      const workerInstance = mockWorkerInstances[0]!;

      workerInstance.onmessage?.(
        new MessageEvent('message', {
          data: {
            type: 'SIM_COMPLETE',
            payload: {
              totalEvents: 1000,
              totalRequests: 500,
              successRate: 0.95,
              avgEndToEndLatencyMs: 42,
              simulatedDurationMs: 10000,
              wallClockDurationMs: 2000,
              eventsPerSecond: 500,
            },
          },
        }),
      );

      expect(useSimulationStore.getState().simState).toBe(SimState.Complete);
    });

    it('dispatches ERROR to console.error', () => {
      useSimulationStore.getState().initWorker();
      const workerInstance = mockWorkerInstances[0]!;

      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      workerInstance.onmessage?.(
        new MessageEvent('message', {
          data: { type: 'ERROR', payload: { message: 'Something broke', stack: 'at line 42' } },
        }),
      );

      expect(spy).toHaveBeenCalledWith('[SimWorker]', 'Something broke', 'at line 42');
      spy.mockRestore();
    });
  });
});
