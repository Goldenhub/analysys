/**
 * Shared engine test fixture — uses `disablePacing: true` so no test
 * builds its own config object.
 */
import { SimulationEngine } from '@/simulation/engine';
import type { SimulationNode } from '@/types/nodes';
import type { EdgeData } from '@/types/edges';
import type { SimulationEngineConfig } from '@/types/messages';
import type { MetricsBatchPayload } from '@/types/metrics';

export interface EngineTestResult {
  engine: SimulationEngine;
  batches: MetricsBatchPayload[];
  summary: {
    totalEvents: number;
    totalRequests: number;
    successRate: number;
    avgEndToEndLatencyMs: number;
    simulatedDurationMs: number;
    wallClockDurationMs: number;
    eventsPerSecond: number;
  } | null;
}

/**
 * Creates and runs a simulation engine with disablePacing: true.
 * Returns collected metrics batches and the final summary.
 */
export async function runEngine(
  topology: { nodes: SimulationNode[]; edges: EdgeData[] },
  overrides: Partial<SimulationEngineConfig> = {},
): Promise<EngineTestResult> {
  const config: SimulationEngineConfig = {
    topology,
    seed: overrides.seed ?? 42,
    speedMultiplier: overrides.speedMultiplier ?? 50,
    // 2.5s of simulated time yields ≥5 metrics windows — enough for every
    // windowed invariant — while keeping fast-check iterations fast now that
    // POISSON generators emit their configured rates correctly.
    maxSimulatedTimeMs: overrides.maxSimulatedTimeMs ?? 2_500,
    metricsIntervalMs: overrides.metricsIntervalMs ?? 1_000,
    maxHopsPerRequest: overrides.maxHopsPerRequest ?? 20,
    disablePacing: true,
    ...overrides,
  };

  const engine = new SimulationEngine(config);
  const batches: MetricsBatchPayload[] = [];
  let summary: EngineTestResult['summary'] = null;

  engine.setCallbacks({
    onMetricsBatch: (payload) => batches.push(payload),
    onComplete: (s) => {
      summary = s;
    },
  });

  await engine.run();

  return { engine, batches, summary };
}

/**
 * Extract cumulative terminal counts summed across all nodes from the last metrics batch.
 */
export function getCumulativeTerminalCounts(
  batches: MetricsBatchPayload[],
): Record<string, number> {
  if (batches.length === 0) return {};
  const last = batches[batches.length - 1]!;
  const result: Record<string, number> = {};
  for (const node of last.nodes) {
    for (const [status, count] of Object.entries(node.cumulativeTerminalCounts)) {
      result[status] = (result[status] ?? 0) + (count as number);
    }
  }
  return result;
}

/**
 * Get the total number of completed requests (all terminal statuses) from last batch.
 */
export function getTotalCompleted(batches: MetricsBatchPayload[]): number {
  const counts = getCumulativeTerminalCounts(batches);
  return Object.values(counts).reduce((sum, c) => sum + c, 0);
}
