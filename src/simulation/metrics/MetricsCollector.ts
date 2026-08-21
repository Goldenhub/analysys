import type { SimulationNode } from '@/types/nodes';
import type { MetricsBatchPayload, NodeMetricsSnapshot } from '@/types/metrics';
import type { NodeRuntimeState, SimRequest } from '../types';
import { RequestStatus } from '../types';
import { NodeMetricsAccumulator } from './NodeMetricsAccumulator';
import { computePercentiles } from './percentiles';

export class MetricsCollector {
  private accumulators: Map<string, NodeMetricsAccumulator> = new Map();
  private completedRequests: SimRequest[] = [];
  private windowMs: number;
  private lastBatchTime = 0;

  constructor(nodes: SimulationNode[], windowMs = 5000) {
    this.windowMs = windowMs;
    for (const node of nodes) {
      this.accumulators.set(node.id, new NodeMetricsAccumulator(node.id, windowMs));
    }
  }

  recordArrival(nodeId: string, requestId: string, timestamp: number): void {
    this.accumulators.get(nodeId)?.recordArrival(requestId, timestamp);
  }

  recordDeparture(nodeId: string, requestId: string, timestamp: number): void {
    this.accumulators.get(nodeId)?.recordDeparture(requestId, timestamp);
  }

  recordCompletion(request: SimRequest): void {
    this.completedRequests.push(request);
  }

  generateBatch(
    currentTime: number,
    nodeStates: Map<string, NodeRuntimeState>,
    activeRequestCount: number = 0,
  ): MetricsBatchPayload {
    const nodeSnapshots: NodeMetricsSnapshot[] = [];
    const elapsedSinceLastBatch = currentTime - this.lastBatchTime;
    const throughputDivisor = elapsedSinceLastBatch > 0 ? elapsedSinceLastBatch / 1000 : 1;

    for (const [nodeId, accumulator] of this.accumulators) {
      const state = nodeStates.get(nodeId);
      if (!state) continue;

      const littlesLaw = accumulator.compute(currentTime);
      const utilization = state.processor.getUtilization();
      const errorRate = this.computeErrorRate(state);

      const snapshot: NodeMetricsSnapshot = {
        nodeId,
        timestamp: currentTime,
        throughput: state.totalProcessed / throughputDivisor,
        errorRate,
        latencyPercentiles: computePercentiles(state.latencySamples),
        queueDepth: state.queuedRequests.length,
        activeConnections: state.activeConnections,
        bufferOccupancy: state.bufferedMessages,
        utilization,
        littlesLaw,
        healthStatus: this.deriveHealthStatus(utilization, errorRate),
      };

      nodeSnapshots.push(snapshot);
    }

    this.lastBatchTime = currentTime;

    return {
      simulatedTimeMs: currentTime,
      nodes: nodeSnapshots,
      systemWide: this.computeSystemWideMetrics(currentTime, activeRequestCount),
    };
  }

  reset(): void {
    for (const acc of this.accumulators.values()) {
      acc.reset();
    }
    this.completedRequests = [];
    this.lastBatchTime = 0;
  }

  private computeErrorRate(state: NodeRuntimeState): number {
    const total = state.totalProcessed + state.totalDropped + state.totalTimedOut;
    if (total === 0) return 0;
    return (state.totalDropped + state.totalTimedOut) / total;
  }

  private deriveHealthStatus(
    utilization: number,
    errorRate: number,
  ): 'green' | 'yellow' | 'red' {
    if (utilization > 0.9 || errorRate >= 0.05) return 'red';
    if (utilization > 0.7 || errorRate > 0) return 'yellow';
    return 'green';
  }

  private computeSystemWideMetrics(currentTime: number, activeRequestCount: number) {
    // Prune completed requests outside the window to prevent unbounded memory growth
    this.completedRequests = this.completedRequests.filter(
      (r) => r.completedAt !== undefined && r.completedAt >= currentTime - this.windowMs,
    );

    const successful = this.completedRequests.filter((r) => r.status === RequestStatus.Success);
    const latencies = successful.map((r) => r.accumulatedLatencyMs);

    return {
      totalThroughput: successful.length / (this.windowMs / 1000),
      endToEndLatency: computePercentiles(latencies),
      totalErrorRate:
        this.completedRequests.length > 0
          ? this.completedRequests.filter((r) => r.status !== RequestStatus.Success).length /
            this.completedRequests.length
          : 0,
      activeRequests: activeRequestCount,
    };
  }
}
