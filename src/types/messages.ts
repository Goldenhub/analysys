import type { SimulationNode } from './nodes';
import type { EdgeData } from './edges';
import type { MetricsBatchPayload } from './metrics';

// ─── Simulation Engine Config (sent on INIT) ────────────────────

/**
 * Cycle guard: a request traversing more than this many hops is terminated
 * LOOP_DETECTED. Requirement 13.1 fixes the default at 20.
 */
export const DEFAULT_MAX_HOPS_PER_REQUEST = 20;

/**
 * Metrics window in simulated milliseconds. Requirement 7.2 requires at least
 * 2 chart updates per simulated second at 1x, so this must not exceed 500.
 */
export const DEFAULT_METRICS_INTERVAL_MS = 500;

export interface SimulationEngineConfig {
  topology: { nodes: SimulationNode[]; edges: EdgeData[] };
  seed: number;
  speedMultiplier: number;
  maxSimulatedTimeMs: number;
  metricsIntervalMs: number;
  maxHopsPerRequest: number;
  disablePacing?: boolean; // Skip yield delays (for testing)
}

// ─── Main Thread → Worker Messages ──────────────────────────────

export interface ChaosEventPayload {
  chaosType: 'FLUSH_CACHE' | 'DROP_DB' | 'SPIKE_TRAFFIC' | 'DLQ_REDRIVE';
  targetNodeId?: string;
  durationMs: number;
  params: Record<string, unknown>;
}

export type MainToWorkerMessage =
  | { type: 'INIT'; payload: SimulationEngineConfig }
  | { type: 'START'; payload: { speedMultiplier: number } }
  | { type: 'PAUSE' }
  | { type: 'RESUME'; payload: { speedMultiplier: number } }
  | { type: 'RESET' }
  | { type: 'CHAOS_EVENT'; payload: ChaosEventPayload }
  | { type: 'UPDATE_CONFIG'; payload: { nodeId: string; config: Record<string, unknown> } }
  | { type: 'SWEEP_STEP'; payload: SweepStepRequest }
  | { type: 'SWEEP_CANCEL'; payload: { stepIndex: number } };

// ─── Sweep Step Request (R38) ────────────────────────────────────

export interface SweepStepRequest {
  /** 0-based step index. */
  stepIndex: number;
  /** Target RPS for this step (from the step load formula). */
  requestedRps: number;
  /** Per-generator RPS map, computed on the main thread (R38.11). */
  perGeneratorRps: Record<string, number>;
  /** Duration of this step in simulated ms. */
  durationPerStepMs: number;
  /** Warm-up period in ms. */
  warmUpMs: number;
  /** Speed multiplier. */
  speedMultiplier: number;
  /** Seed for deterministic PRNG. */
  seed: number;
}

// ─── Worker → Main Thread Messages ──────────────────────────────

export interface SimEventLogEntry {
  id: number;
  timestamp: number;
  type: string;
  nodeId: string;
  requestId?: string;
  message: string;
}

export interface SimulationSummary {
  totalEvents: number;
  totalRequests: number;
  successRate: number;
  avgEndToEndLatencyMs: number;
  simulatedDurationMs: number;
  wallClockDurationMs: number;
  eventsPerSecond: number;
}

export type WorkerToMainMessage =
  | { type: 'METRICS_BATCH'; payload: MetricsBatchPayload }
  | { type: 'NODE_STATUS'; payload: { nodeId: string; status: 'green' | 'yellow' | 'red' } }
  | { type: 'EVENT_LOG'; payload: SimEventLogEntry[] }
  | { type: 'SIM_COMPLETE'; payload: SimulationSummary }
  | { type: 'ERROR'; payload: { message: string; stack?: string } }
  | { type: 'SWEEP_STEP_COMPLETE'; payload: SweepStepCompletePayload };

// ─── Sweep Step Complete Payload (R38) ───────────────────────────

import type { PercentileStats } from './metrics';

export interface SweepStepCompletePayload {
  /** 0-based step index (displayed 1-based). */
  stepIndex: number;
  /** RPS requested by the sweep formula. */
  requestedRps: number;
  /** Actual sum of per-generator RPS applied. */
  appliedRps: number;
  /** Measured throughput over the measurement interval. */
  achievedThroughput: number;
  /** Latency percentiles over the measurement interval. */
  latency: PercentileStats;
  /** Total error rate over the measurement interval. */
  totalErrorRate: number;
  /** Terminal status counts over the measurement interval. */
  terminalCounts: Record<string, number>;
  /** Scheduler-emitted Job count (reported separately from offered load, R38.14). */
  schedulerJobsEmitted: number;
  /** The measurement interval boundaries. */
  measurementInterval: { startMs: number; endMs: number };
  /** Whether the step satisfied the service objective. */
  verdict: 'satisfied' | 'violated' | 'not-evaluated';
}
