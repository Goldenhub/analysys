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
  utilization: number;
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
