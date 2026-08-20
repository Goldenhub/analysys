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
  ): MetricsBatchPayload {
    const nodeSnapshots: NodeMetricsSnapshot[] = [];

    for (const [nodeId, accumulator] of this.accumulators) {
      const state = nodeStates.get(nodeId);
      if (!state) continue;

      const littlesLaw = accumulator.compute(currentTime);
      const utilization = state.processor.getUtilization();
      const errorRate = this.computeErrorRate(state);

      const snapshot: NodeMetricsSnapshot = {
        nodeId,
        timestamp: currentTime,
        throughput: state.totalProcessed / (this.windowMs / 1000),
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

    return {
      simulatedTimeMs: currentTime,
      nodes: nodeSnapshots,
      systemWide: this.computeSystemWideMetrics(currentTime),
    };
  }

  reset(): void {
    for (const acc of this.accumulators.values()) {
      acc.reset();
    }
    this.completedRequests = [];
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

  private computeSystemWideMetrics(currentTime: number) {
    const recentCompleted = this.completedRequests.filter(
      (r) => r.completedAt !== undefined && r.completedAt >= currentTime - this.windowMs,
    );
    const successful = recentCompleted.filter((r) => r.status === RequestStatus.Success);
    const latencies = successful.map((r) => r.accumulatedLatencyMs);

    return {
      totalThroughput: successful.length / (this.windowMs / 1000),
      endToEndLatency: computePercentiles(latencies),
      totalErrorRate:
        recentCompleted.length > 0
          ? recentCompleted.filter((r) => r.status !== RequestStatus.Success).length /
            recentCompleted.length
          : 0,
      activeRequests: [...this.accumulators.values()].reduce(
        (sum, acc) => sum + acc.getCurrentOccupancy(),
        0,
      ),
    };
  }
}
