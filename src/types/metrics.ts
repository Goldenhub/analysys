/** Latency percentile statistics (p50, p90, p99). */
export interface PercentileStats {
  p50: number;
  p90: number;
  p99: number;
}

/** Little's Law metrics for a single node: L = lambda * W. */
export interface LittlesLawMetrics {
  nodeId: string;
  /** Average number of items in the system (L). */
  L: number;
  /** Arrival rate (lambda). */
  lambda: number;
  /** Average time in system (W). */
  W: number;
  /** Deviation from ideal Little's Law relationship. */
  deviation: number;
  /** Whether the node is in a stable state. */
  isStable: boolean;
}

// ─── Utilization ─────────────────────────────────────────────────

/**
 * A node's Utilization for one metrics window (R29.10–29.13).
 *
 * A bare `number` cannot tell an idle node reading `0.0` apart from a node whose
 * bounded resource is zero or absent, so the two cases are separate variants.
 */
export type UtilizationReading =
  /** `idle` is true when the bound is above zero but the node saw no arrivals this window. */
  | { kind: 'value'; value: number; idle: boolean }
  /** `reason` is plain language and names the zero or missing bounded resource. */
  | { kind: 'not-applicable'; reason: string };

/** Point-in-time metrics snapshot for a single node. */
export interface NodeMetricsSnapshot {
  nodeId: string;
  timestamp: number;
  throughput: number;
  errorRate: number;
  latencyPercentiles: PercentileStats;
  queueDepth: number;
  activeConnections: number;
  bufferOccupancy: number;
  utilization: UtilizationReading;
  littlesLaw: LittlesLawMetrics;
  healthStatus: 'green' | 'yellow' | 'red';
  /** R31.4 — per-window terminal counts, reset at each window boundary. */
  terminalCounts: Record<string, number>;
  /** R31.3 — cumulative terminal counts across the run, never reset. */
  cumulativeTerminalCounts: Record<string, number>;
  /** Type-specific metrics for new node types (R23.9, R24.11, R25.11, R26.9, R27.10, R28.9). */
  typeSpecificMetrics?: Record<string, unknown>;

  // ─── Analysis Aggregates (Tasks 428–436) ─────────────────────

  /** Σ time-in-system accumulated AT THIS NODE by requests/Jobs terminating in this window. */
  timeInSystemAtNodeMs: number;
  /** Σ time-in-system those SAME requests/Jobs accumulated across their whole recorded path. */
  pathTimeInSystemMs: number;
  /** Terminating requests/Jobs whose recorded path — or branch paths — held this node. */
  terminatedThroughNodeCount: number;

  /** Job_Backlog for Worker_Pool, buffered messages for MQ, queue depth for others, or null. */
  monitoredDepth: number | null;
  /** Configured bound for monitoredDepth, or null if not applicable. */
  monitoredDepthBound: number | null;

  /** Arrivals in this window. */
  arrivalCount: number;
  /** Departures in this window (forwarded + completed + terminated at this node). */
  departureCount: number;

  /** Actual duration of this metrics window in ms. ≤0 marks the window unavailable. */
  durationMs: number;

  // ─── Type-Specific Optional Fields (Task 435) ────────────────

  concurrencyOccupied?: number;
  concurrencyBound?: number;
  jobBacklog?: number;
  backlogAgeMs?: number;
  retainedByUpstreamNode?: Record<string, number>;
  transferRateMBps?: number;
  forwardedByEdge?: Record<string, number>;
  branchesDispatched?: number;
}

/** Batch of metrics emitted periodically by the simulation worker. */
export interface MetricsBatchPayload {
  simulatedTimeMs: number;
  nodes: NodeMetricsSnapshot[];
  systemWide: {
    totalThroughput: number;
    endToEndLatency: PercentileStats;
    totalErrorRate: number;
    activeRequests: number;
    /** R31.5 — failure class rates in terminations per second. */
    failureClassRates?: {
      admission: number;
      capacityReliability: number;
      topologyConfiguration: number;
    };
  };
}
