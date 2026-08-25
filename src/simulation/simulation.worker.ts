import type { MainToWorkerMessage, WorkerToMainMessage, SweepStepRequest } from '@/types/messages';
import { SimulationEngine } from './engine';
import { MeasurementIntervalAccumulator } from './metrics/MeasurementIntervalAccumulator';
import { NodeType } from '@/types/nodes';
import type { SimulationEngineConfig } from '@/types/messages';

let engine: SimulationEngine | null = null;

/** Topology captured at INIT — reused as the base for isolated sweep-step engines. */
let sweepBaseTopology: SimulationEngineConfig['topology'] | null = null;

/**
 * 0-based step index currently executing, or the step that was most recently
 * cancelled. A SWEEP_CANCEL for the running step makes its engine pause at the
 * next inter-batch yield and the step finish without a completion payload.
 */
let cancelledStepIndex: number | null = null;
let runningStepIndex: number | null = null;

/** Resolves the in-flight step's completion promise early (cancellation path). */
let finishRunningStepEarly: (() => void) | null = null;

function postMsg(message: WorkerToMainMessage): void {
  self.postMessage(message);
}

/**
 * Execute one Capacity-Sweep step on an isolated engine:
 *  - topology cloned from the INIT snapshot with per-generator RPS overrides;
 *  - no interactive callbacks (METRICS_BATCH/EVENT_LOG/NODE_STATUS/SIM_COMPLETE
 *    are suppressed so telemetry stays clean);
 *  - terminations feed a MeasurementIntervalAccumulator gated on [warmUpMs, duration];
 *  - completion posts exactly one SWEEP_STEP_COMPLETE (nothing when cancelled).
 */
async function runSweepStep(request: SweepStepRequest): Promise<void> {
  const { stepIndex } = request;
  runningStepIndex = stepIndex;

  if (!sweepBaseTopology) {
    postMsg({
      type: 'ERROR',
      payload: { message: 'Sweep rejected: send INIT with a topology first.' },
    });
    return;
  }

  // Clone the base topology and override each generator's offered load for this step.
  const nodes = sweepBaseTopology.nodes.map((node) => {
    if (node.nodeType !== NodeType.TrafficGenerator) return node;
    const override = request.perGeneratorRps[node.id];
    if (override === undefined || override === node.config.rps) return node;
    return { ...node, config: { ...node.config, rps: override } };
  });

  const stepConfig: SimulationEngineConfig = {
    topology: { ...sweepBaseTopology, nodes },
    seed: request.seed,
    speedMultiplier: request.speedMultiplier,
    maxSimulatedTimeMs: request.durationPerStepMs,
    metricsIntervalMs: Math.max(500, Math.min(5000, request.durationPerStepMs / 4)),
    maxHopsPerRequest: 20,
  };

  const stepEngine = new SimulationEngine(stepConfig);

  const accumulator = new MeasurementIntervalAccumulator(
    request.warmUpMs,
    request.durationPerStepMs,
  );
  let schedulerJobsEmitted = 0;
  stepEngine.setSweepRecorder((latencyMs, status, isError, isSchedulerJob, simTimeMs) => {
    if (!accumulator.checkClock(simTimeMs)) return;
    accumulator.recordTermination(latencyMs, status, isError, false);
    if (isSchedulerJob) schedulerJobsEmitted++;
  });

  const completed = new Promise<void>((resolve) => {
    stepEngine.setCallbacks({ onComplete: () => resolve() });
    finishRunningStepEarly = resolve;
  });

  void stepEngine.run();
  await completed;
  finishRunningStepEarly = null;

  const wasCancelled = cancelledStepIndex === stepIndex;
  cancelledStepIndex = cancelledStepIndex === stepIndex ? null : cancelledStepIndex;
  runningStepIndex = null;

  if (wasCancelled) return;

  postMsg({
    type: 'SWEEP_STEP_COMPLETE',
    payload: {
      stepIndex,
      requestedRps: request.requestedRps,
      appliedRps: Object.values(request.perGeneratorRps).reduce((s, v) => s + v, 0),
      achievedThroughput: accumulator.getAchievedThroughput(),
      latency: accumulator.getPercentiles(),
      totalErrorRate: accumulator.getTotalErrorRate(),
      terminalCounts: accumulator.getTerminalCounts(),
      schedulerJobsEmitted,
      measurementInterval: accumulator.getMeasurementInterval(),
      verdict: computeVerdict(accumulator, request.objective),
    },
  });
}

function computeVerdict(
  accumulator: MeasurementIntervalAccumulator,
  objective: { maxP99LatencyMs: number; maxErrorRate: number },
): 'satisfied' | 'violated' | 'not-evaluated' {
  if (accumulator.getTotalTerminations() === 0) return 'not-evaluated';
  const p99Ok = accumulator.getPercentiles().p99 <= objective.maxP99LatencyMs;
  const errorOk = accumulator.getTotalErrorRate() <= objective.maxErrorRate;
  return p99Ok && errorOk ? 'satisfied' : 'violated';
}

self.onmessage = (event: MessageEvent<MainToWorkerMessage>) => {
  const msg = event.data;

  try {
    switch (msg.type) {
      case 'INIT': {
        engine = new SimulationEngine(msg.payload);
        sweepBaseTopology = msg.payload.topology;
        engine.setCallbacks({
          onMetricsBatch: (payload) => postMsg({ type: 'METRICS_BATCH', payload }),
          onNodeStatus: (nodeId, status) =>
            postMsg({ type: 'NODE_STATUS', payload: { nodeId, status } }),
          onEventLog: (entries) => postMsg({ type: 'EVENT_LOG', payload: entries }),
          onComplete: (summary) => postMsg({ type: 'SIM_COMPLETE', payload: summary }),
        });
        break;
      }

      case 'START': {
        if (!engine) {
          postMsg({
            type: 'ERROR',
            payload: { message: 'Engine not initialized. Send INIT first.' },
          });
          return;
        }
        void engine.run();
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

      case 'UPDATE_SPEED': {
        engine?.setSpeedMultiplier(msg.payload.speedMultiplier);
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

      case 'SWEEP_STEP': {
        void runSweepStep(msg.payload);
        break;
      }

      case 'SWEEP_CANCEL': {
        cancelledStepIndex = msg.payload.stepIndex;
        if (runningStepIndex === msg.payload.stepIndex) {
          // Stop the step engine at its next inter-batch yield and unblock the
          // awaiting handler; the completed payload is suppressed on cancel.
          finishRunningStepEarly?.();
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
