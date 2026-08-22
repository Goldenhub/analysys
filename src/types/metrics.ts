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
  };
}
