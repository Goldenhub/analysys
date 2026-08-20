import type { MainToWorkerMessage, WorkerToMainMessage } from '@/types/messages';
import { SimulationEngine } from './engine';

let engine: SimulationEngine | null = null;

function postMsg(message: WorkerToMainMessage): void {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<MainToWorkerMessage>) => {
  const msg = event.data;

  try {
    switch (msg.type) {
      case 'INIT': {
        engine = new SimulationEngine(msg.payload);
        engine.setCallbacks({
          onMetricsBatch: (payload) => postMsg({ type: 'METRICS_BATCH', payload }),
          onNodeStatus: (nodeId, status) => postMsg({ type: 'NODE_STATUS', payload: { nodeId, status } }),
          onEventLog: (entries) => postMsg({ type: 'EVENT_LOG', payload: entries }),
          onComplete: (summary) => postMsg({ type: 'SIM_COMPLETE', payload: summary }),
        });
        break;
      }

      case 'START': {
        if (!engine) {
          postMsg({ type: 'ERROR', payload: { message: 'Engine not initialized. Send INIT first.' } });
          return;
        }
        engine.run();
        break;
      }

      case 'PAUSE': {
        engine?.pause();
        break;
      }

      case 'RESUME': {
        if (!engine) return;
        engine.resume(msg.payload.speedMultiplier);
        break;
      }

      case 'RESET': {
        engine?.reset();
        break;
      }

      case 'CHAOS_EVENT': {
        engine?.injectChaos(msg.payload);
        break;
      }

      case 'UPDATE_CONFIG': {
        if (engine) {
          engine.updateNodeConfig(msg.payload.nodeId, msg.payload.config);
        }
        break;
      }
    }
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    postMsg({
      type: 'ERROR',
      payload: { message: error.message, stack: error.stack },
    });
  }
};
