import type { NodeMetricsSnapshot, MetricsBatchPayload } from '@/types/metrics';
import type { SimulationNode } from '@/types/nodes';
import type { EdgeData } from '@/types/edges';
import type { SimEventLogEntry } from '@/types/messages';

// ─── Constants ───────────────────────────────────────────────────

/** Number of most recent metrics windows retained (R41.4). */
export const RING_BUFFER_SIZE = 16;

/** Minimum completed windows before any Finding is displayed (R41.6). */
export const MIN_COMPLETED_WINDOWS = 3;

// ─── Window Representation ───────────────────────────────────────

export interface NodeMetricsWindow {
  /** Simulated time at which this window started (ms). */
  startMs: number;
  /** Simulated time at which this window ended (ms). */
  endMs: number;
  /** Actual duration of this metrics window in ms. ≤0 marks the window unavailable. */
  durationMs: number;
  /** Per-node metrics snapshots for this window. */
  nodes: NodeMetricsSnapshot[];
  /** System-wide aggregates. */
  systemWide: MetricsBatchPayload['systemWide'];
}

// ─── Cumulative Run Aggregates ───────────────────────────────────

export interface CumulativeRunAggregates {
  /** Total simulated time elapsed. */
  totalSimulatedMs: number;
  /** System-wide total throughput accumulated. */
  totalThroughput: number;
  /** Total number of completed windows (zero-duration excluded). */
  completedWindowCount: number;
  /** Per-node cumulative completed request counts. */
  nodeCompletedCounts: Map<string, number>;
  /** System-wide completed request count. */
  systemCompletedCount: number;
}

// ─── Steady_State Detection ──────────────────────────────────────

/**
 * Per-node Steady_State detection.
 *
 * A node is in Steady_State when:
 * - Arrival rate varies under 10% between adjacent windows across
 *   at least 3 consecutive windows.
 * - Queue-depth net change is within ±5% of the mean depth across
 *   those same windows.
 */
export interface SteadyStateStatus {
  nodeId: string;
  isSteady: boolean;
  consecutiveStableWindows: number;
}

/**
 * Checks if a node is in Steady_State by examining the most recent
 * windows in the ring buffer.
 */
export function checkSteadyState(
  nodeId: string,
  windows: readonly NodeMetricsWindow[],
): SteadyStateStatus {
  // Need at least 3 completed (non-zero-duration) windows
  const validWindows = windows.filter((w) => w.durationMs > 0);
  if (validWindows.length < 3) {
    return { nodeId, isSteady: false, consecutiveStableWindows: 0 };
  }

  // Work backwards from the most recent window
  let consecutiveStable = 0;

  for (let i = validWindows.length - 1; i >= 1; i--) {
    const current = validWindows[i]!;
    const previous = validWindows[i - 1]!;

    const currentNode = current.nodes.find((n) => n.nodeId === nodeId);
    const previousNode = previous.nodes.find((n) => n.nodeId === nodeId);

    if (!currentNode || !previousNode) break;

    // Arrival rate variation check (under 10%)
    const currentRate =
      current.durationMs > 0 ? currentNode.arrivalCount / (current.durationMs / 1000) : 0;
    const previousRate =
      previous.durationMs > 0 ? previousNode.arrivalCount / (previous.durationMs / 1000) : 0;

    const meanRate = (currentRate + previousRate) / 2;
    if (meanRate > 0) {
      const rateVariation = Math.abs(currentRate - previousRate) / meanRate;
      if (rateVariation >= 0.1) break;
    } else if (currentRate !== 0 || previousRate !== 0) {
      // One is zero and the other is not — not stable
      break;
    }

    // Queue depth net change check (within ±5% of mean depth)
    const currentDepth = currentNode.queueDepth;
    const previousDepth = previousNode.queueDepth;
    const meanDepth = (currentDepth + previousDepth) / 2;
    if (meanDepth > 0) {
      const depthChange = Math.abs(currentDepth - previousDepth) / meanDepth;
      if (depthChange > 0.05) break;
    }
    // If meanDepth is 0 or both are 0, the change is trivially within bounds

    consecutiveStable++;
  }

  // We need at least 3 consecutive windows which means ≥2 adjacent pairs stable
  const isSteady = consecutiveStable >= 2;
  return {
    nodeId,
    isSteady,
    consecutiveStableWindows: consecutiveStable + 1,
  };
}

// ─── Service Objective ───────────────────────────────────────────

export interface ServiceObjective {
  maxP99LatencyMs: number;
  maxErrorRate: number;
}

// ─── Analysis Context ────────────────────────────────────────────

/**
 * The immutable context passed to each analysis rule's evaluate() generator.
 */
export interface AnalysisContext {
  /** Most recent windows last; ≥3 required before any Finding. */
  readonly windows: readonly NodeMetricsWindow[];
  /** Cumulative run-level aggregates. */
  readonly cumulative: CumulativeRunAggregates;
  /** Current topology graph. */
  readonly topology: { nodes: SimulationNode[]; edges: EdgeData[] };
  /** Resolves a node id to its user-assigned label, falling back to a shortened identifier (R35.9). */
  labelOf(nodeId: string): string;
  /** Simulation event log. */
  readonly eventLog: readonly SimEventLogEntry[];
  /** Optional service objective for rules that need it. */
  readonly serviceObjective?: ServiceObjective;
  /** Per-node Steady_State status for the current window set. */
  readonly steadyStateMap: ReadonlyMap<string, SteadyStateStatus>;
}

// ─── Ring Buffer Implementation ──────────────────────────────────

/**
 * Fixed-size ring buffer retaining the 16 most recent metrics windows plus
 * cumulative run totals, fed from METRICS_BATCH messages.
 *
 * Zero-duration windows are stored but excluded from the completed-window count
 * so the "3 completed windows" gate is not satisfied by a degenerate final snapshot.
 */
export class AnalysisWindowStore {
  private readonly buffer: NodeMetricsWindow[] = [];
  private previousEndMs = 0;
  private readonly _cumulative: CumulativeRunAggregates = {
    totalSimulatedMs: 0,
    totalThroughput: 0,
    completedWindowCount: 0,
    nodeCompletedCounts: new Map(),
    systemCompletedCount: 0,
  };

  /**
   * Feed a METRICS_BATCH payload into the ring buffer.
   * Returns true if this created a new completed window boundary.
   */
  pushBatch(payload: MetricsBatchPayload): boolean {
    const endMs = payload.simulatedTimeMs;
    const startMs = this.previousEndMs;
    const durationMs = endMs - startMs;

    const window: NodeMetricsWindow = {
      startMs,
      endMs,
      durationMs,
      nodes: payload.nodes,
      systemWide: payload.systemWide,
    };

    // Maintain ring buffer at RING_BUFFER_SIZE
    if (this.buffer.length >= RING_BUFFER_SIZE) {
      this.buffer.shift();
    }
    this.buffer.push(window);
    this.previousEndMs = endMs;

    // Update cumulative aggregates
    this._cumulative.totalSimulatedMs = endMs;
    this._cumulative.totalThroughput += payload.systemWide.totalThroughput;

    // Only count non-zero-duration windows as completed (Task 447)
    if (durationMs > 0) {
      this._cumulative.completedWindowCount++;
    }

    // Accumulate per-node completed counts from terminal counts
    for (const node of payload.nodes) {
      const nodeTotal = Object.values(node.cumulativeTerminalCounts).reduce((sum, v) => sum + v, 0);
      this._cumulative.nodeCompletedCounts.set(node.nodeId, nodeTotal);
    }

    // System-wide completed count is sum of all terminal counts
    let systemTotal = 0;
    for (const count of this._cumulative.nodeCompletedCounts.values()) {
      systemTotal += count;
    }
    this._cumulative.systemCompletedCount = systemTotal;

    // A completed window boundary is a non-zero-duration window
    return durationMs > 0;
  }

  /** Get all windows in the buffer, oldest first. */
  get windows(): readonly NodeMetricsWindow[] {
    return this.buffer;
  }

  /** Get cumulative run aggregates. */
  get cumulative(): CumulativeRunAggregates {
    return this._cumulative;
  }

  /** Number of completed (non-zero-duration) windows received. */
  get completedWindowCount(): number {
    return this._cumulative.completedWindowCount;
  }

  /** Whether the minimum window gate is satisfied. */
  get hasMinimumWindows(): boolean {
    return this._cumulative.completedWindowCount >= MIN_COMPLETED_WINDOWS;
  }

  /**
   * Build the AnalysisContext for the current state.
   */
  buildContext(
    topology: { nodes: SimulationNode[]; edges: EdgeData[] },
    eventLog: readonly SimEventLogEntry[],
    serviceObjective?: ServiceObjective,
  ): AnalysisContext {
    const steadyStateMap = new Map<string, SteadyStateStatus>();
    const nodeIds = new Set<string>();
    for (const w of this.buffer) {
      for (const n of w.nodes) {
        nodeIds.add(n.nodeId);
      }
    }
    for (const nid of nodeIds) {
      steadyStateMap.set(nid, checkSteadyState(nid, this.buffer));
    }

    // Build label lookup: user-assigned label from topology, fallback to shortened id
    const labelMap = new Map<string, string>();
    for (const node of topology.nodes) {
      labelMap.set(node.id, node.label || node.id.slice(0, 8));
    }

    return {
      windows: [...this.buffer],
      cumulative: { ...this._cumulative },
      topology,
      labelOf: (nodeId: string) => labelMap.get(nodeId) ?? nodeId.slice(0, 8),
      eventLog,
      serviceObjective,
      steadyStateMap,
    };
  }

  /** Reset all state (e.g., on simulation reset). */
  reset(): void {
    this.buffer.length = 0;
    this.previousEndMs = 0;
    this._cumulative.totalSimulatedMs = 0;
    this._cumulative.totalThroughput = 0;
    this._cumulative.completedWindowCount = 0;
    this._cumulative.nodeCompletedCounts.clear();
    this._cumulative.systemCompletedCount = 0;
  }
}
