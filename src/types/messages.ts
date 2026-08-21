import type { SimulationNode } from './nodes';
import type { EdgeData } from './edges';
import type { MetricsBatchPayload } from './metrics';

// ─── Simulation Engine Config (sent on INIT) ────────────────────

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
  chaosType: 'FLUSH_CACHE' | 'DROP_DB' | 'SPIKE_TRAFFIC';
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
  | { type: 'UPDATE_CONFIG'; payload: { nodeId: string; config: Record<string, unknown> } };

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
  | { type: 'ERROR'; payload: { message: string; stack?: string } };
