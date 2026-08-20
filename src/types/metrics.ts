export interface PercentileStats {
  p50: number;
  p90: number;
  p99: number;
}

export interface LittlesLawMetrics {
  nodeId: string;
  L: number;
  lambda: number;
  W: number;
  deviation: number;
  isStable: boolean;
}

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
