import type { SimulationNode } from '@/types/nodes';
import type {
  MetricsBatchPayload,
  NodeMetricsSnapshot,
  UtilizationReading,
} from '@/types/metrics';
import type { NodeRuntimeState, SimRequest, TerminalStatus } from '../types';
import { RequestStatus, FAILURE_CLASS_OF, FailureClass } from '../types';
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

  /**
   * Task 336 — record a branch's termination for per-node aggregates only.
   * Does NOT add to completedRequests (system-wide counts).
   */
  recordBranchTermination(_request: SimRequest): void {
    // Branch terminations affect per-node terminalCounts which are maintained
    // by the engine's recordTerminalStatus. System-wide completion is NOT recorded.
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
        terminalCounts: { ...state.terminalCounts },
        cumulativeTerminalCounts: { ...state.cumulativeTerminalCounts },
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

  /**
   * R29.14 — a numeric reading contributes to health through the existing thresholds.
   * R29.15 — where Utilization is not applicable, health derives from the error rate alone,
   * so a node with no bounded resource is not silently reported green while erroring.
   */
  private deriveHealthStatus(
    utilization: UtilizationReading,
    errorRate: number,
  ): 'green' | 'yellow' | 'red' {
    if (utilization.kind === 'not-applicable') {
      if (errorRate >= 0.05) return 'red';
      if (errorRate > 0) return 'yellow';
      return 'green';
    }
    if (utilization.value > 0.9 || errorRate >= 0.05) return 'red';
    if (utilization.value > 0.7 || errorRate > 0) return 'yellow';
    return 'green';
  }

  private computeSystemWideMetrics(currentTime: number, activeRequestCount: number) {
    // Prune completed requests outside the window to prevent unbounded memory growth
    this.completedRequests = this.completedRequests.filter(
      (r) => r.completedAt !== undefined && r.completedAt >= currentTime - this.windowMs,
    );

    const successful = this.completedRequests.filter((r) => r.status === RequestStatus.Success);
    const latencies = successful.map((r) => r.accumulatedLatencyMs);

    // Task 342: compute failure class rates
    const windowDurationSec = this.windowMs / 1000;
    const terminalInWindow = this.completedRequests.length;

    // Count non-Success in window for total error rate
    const nonSuccessCount = this.completedRequests.filter(
      (r) => r.status !== RequestStatus.Success,
    ).length;
    const totalErrorRate = terminalInWindow > 0 ? nonSuccessCount / terminalInWindow : 0;

    // Failure class counts
    let admissionCount = 0;
    let capacityReliabilityCount = 0;
    let topologyConfigCount = 0;
    for (const req of this.completedRequests) {
      const failureClass = FAILURE_CLASS_OF[req.status as TerminalStatus];
      if (failureClass === FailureClass.Admission) admissionCount++;
      else if (failureClass === FailureClass.CapacityReliability) capacityReliabilityCount++;
      else if (failureClass === FailureClass.TopologyConfiguration) topologyConfigCount++;
    }

    return {
      totalThroughput: successful.length / (this.windowMs / 1000),
      endToEndLatency: computePercentiles(latencies),
      totalErrorRate,
      activeRequests: activeRequestCount,
      failureClassRates: {
        admission: admissionCount / windowDurationSec,
        capacityReliability: capacityReliabilityCount / windowDurationSec,
        topologyConfiguration: topologyConfigCount / windowDurationSec,
      },
    };
  }
}
