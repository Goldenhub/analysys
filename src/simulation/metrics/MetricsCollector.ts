import type { SimulationNode } from '@/types/nodes';
import { NodeType } from '@/types/nodes';
import type { EdgeData } from '@/types/edges';
import type { MetricsBatchPayload, NodeMetricsSnapshot, UtilizationReading } from '@/types/metrics';
import type { NodeRuntimeState, SimRequest, TerminalStatus } from '../types';
import { RequestStatus, FAILURE_CLASS_OF, FailureClass } from '../types';
import { NodeMetricsAccumulator } from './NodeMetricsAccumulator';
import { computePercentiles } from './percentiles';
import { AnalysisAggregatesAccumulator } from './analysisAggregates';
import { RunCumulativeAccumulator } from './RunCumulativeAccumulator';
import { WorkerPoolProcessor } from '../processors/WorkerPoolProcessor';
import { DeadLetterQueueProcessor } from '../processors/DeadLetterQueueProcessor';
import { ObjectStoreProcessor } from '../processors/ObjectStoreProcessor';
import { SchedulerProcessor } from '../processors/SchedulerProcessor';

export class MetricsCollector {
  private accumulators: Map<string, NodeMetricsAccumulator> = new Map();
  private completedRequests: SimRequest[] = [];
  private windowMs: number;
  private lastBatchTime = 0;
  private nodeConfigs: Map<string, SimulationNode> = new Map();
  private analysisAggregates: AnalysisAggregatesAccumulator;
  private runCumulative: RunCumulativeAccumulator = new RunCumulativeAccumulator();

  constructor(nodes: SimulationNode[], windowMs = 5000, edges: EdgeData[] = []) {
    this.windowMs = windowMs;
    for (const node of nodes) {
      this.accumulators.set(node.id, new NodeMetricsAccumulator(node.id, windowMs));
      this.nodeConfigs.set(node.id, node);
    }
    this.analysisAggregates = new AnalysisAggregatesAccumulator(nodes, edges);
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

  // ─── Analysis Aggregates (Tasks 428–436) ───────────────────────

  /**
   * Record a termination for analysis aggregates. Called at terminal-status
   * assignment time while the request still holds its full lineage.
   */
  recordTerminationForAnalysis(
    request: SimRequest,
    status: TerminalStatus,
    timestamp: number,
    nodeStates: Map<string, NodeRuntimeState>,
    allRequests: Map<string, SimRequest>,
  ): void {
    this.analysisAggregates.recordTermination(request, nodeStates, allRequests);
    this.runCumulative.recordTermination(request, status, timestamp);
  }

  recordAnalysisArrival(nodeId: string): void {
    this.analysisAggregates.recordArrival(nodeId);
  }

  recordAnalysisDeparture(nodeId: string): void {
    this.analysisAggregates.recordDeparture(nodeId);
  }

  recordBranchDispatched(nodeId: string): void {
    this.analysisAggregates.recordBranchDispatched(nodeId);
  }

  recordForwardedByEdge(edgeId: string, sourceNodeId: string): void {
    this.analysisAggregates.recordForwardedByEdge(edgeId, sourceNodeId);
  }

  setRunStartTime(startTimeMs: number): void {
    this.runCumulative.setStartTime(startTimeMs);
  }

  getRunCumulativeAccumulator(): RunCumulativeAccumulator {
    return this.runCumulative;
  }

  getAnalysisAggregates(): AnalysisAggregatesAccumulator {
    return this.analysisAggregates;
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

      // Analysis aggregates (Tasks 428–436)
      const agg = this.analysisAggregates.getAggregates(nodeId);
      const monitoredDepth = this.analysisAggregates.getMonitoredDepth(nodeId, state);
      const monitoredDepthBound = this.analysisAggregates.getMonitoredDepthBound(nodeId);
      const typeSpecificAnalysis = this.analysisAggregates.getTypeSpecificAnalysisFields(
        nodeId,
        state,
        currentTime,
        elapsedSinceLastBatch,
      );

      // Task 436: actual window duration; ≤0 marks unavailable
      const durationMs = elapsedSinceLastBatch;

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
        typeSpecificMetrics: this.computeTypeSpecificMetrics(
          nodeId,
          state,
          currentTime,
          elapsedSinceLastBatch,
        ),

        // Analysis aggregate fields
        timeInSystemAtNodeMs: agg.timeInSystemAtNodeMs,
        pathTimeInSystemMs: agg.pathTimeInSystemMs,
        terminatedThroughNodeCount: agg.terminatedThroughNodeCount,
        monitoredDepth,
        monitoredDepthBound,
        arrivalCount: agg.arrivalCount,
        departureCount: agg.departureCount,
        durationMs,

        // Type-specific optional fields (Task 435)
        ...typeSpecificAnalysis,
        branchesDispatched: agg.branchesDispatched > 0 ? agg.branchesDispatched : undefined,
        forwardedByEdge:
          Object.keys(agg.forwardedByEdge).length > 0 ? agg.forwardedByEdge : undefined,
      };

      nodeSnapshots.push(snapshot);
    }

    // Reset analysis aggregates for next window
    this.analysisAggregates.resetWindow();
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
    this.analysisAggregates.reset();
    this.runCumulative.reset();
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

  /**
   * R23.9, R24.11, R25.11, R26.9, R27.10, R28.9 — type-specific per-node metrics.
   */
  private computeTypeSpecificMetrics(
    nodeId: string,
    state: NodeRuntimeState,
    currentTime: number,
    windowDurationMs: number,
  ): Record<string, unknown> | undefined {
    const nodeConfig = this.nodeConfigs.get(nodeId);
    if (!nodeConfig) return undefined;

    switch (nodeConfig.nodeType) {
      case NodeType.AuthService: {
        const p = state.processor as unknown as Record<string, unknown>;
        if (typeof p.getWindowVerifications === 'function') {
          return {
            verifications: (p.getWindowVerifications as () => number)(),
            cacheHits:
              typeof p.getWindowCacheHits === 'function'
                ? (p.getWindowCacheHits as () => number)()
                : 0,
            failedVerifications:
              typeof p.getWindowFailedVerifications === 'function'
                ? (p.getWindowFailedVerifications as () => number)()
                : 0,
          };
        }
        return undefined;
      }
      case NodeType.AuthzService: {
        const p = state.processor as unknown as Record<string, unknown>;
        if (typeof p.getWindowEvaluations === 'function') {
          return {
            evaluations: (p.getWindowEvaluations as () => number)(),
            cacheHits:
              typeof p.getWindowCacheHits === 'function'
                ? (p.getWindowCacheHits as () => number)()
                : 0,
            denials:
              typeof p.getWindowDenials === 'function' ? (p.getWindowDenials as () => number)() : 0,
          };
        }
        return undefined;
      }
      case NodeType.WorkerPool: {
        const p = state.processor as WorkerPoolProcessor;
        return {
          jobBacklog: p.getJobBacklog(),
          backlogAgeMs: p.getBacklogAge(currentTime),
          drainTimeMs: p.getDrainTime(windowDurationMs),
          completionRate: p.getCompletionRate(),
          retryRate: p.getRetryRate(),
          retryExhaustionRate: p.getRetryExhaustionRate(),
          unit: 'jobs',
        };
      }
      case NodeType.DeadLetterQueue: {
        const p = state.processor as DeadLetterQueueProcessor;
        return {
          retainedCount: p.getRetainedCount(),
          fillFraction: p.getFillFraction(),
          arrivalRate: p.getArrivalRate(),
          oldestMessageAgeMs: p.getOldestMessageAge(currentTime),
          retainedByUpstream: p.getRetainedByUpstream(),
          cumulativeRedrives: p.getCumulativeRedrives(),
          cumulativeOverflowDiscards: p.getCumulativeOverflowDiscards(),
          cumulativeExpiryDiscards: p.getCumulativeExpiryDiscards(),
          unit: 'messages',
        };
      }
      case NodeType.ObjectStore: {
        const p = state.processor as ObjectStoreProcessor;
        return {
          transferRateKBps: p.getTransferRateKBps(windowDurationMs),
          bandwidthUtilization: p.getBandwidthUtilization(windowDurationMs),
          isBandwidthLimiting: p.isBandwidthLimiting(windowDurationMs),
          activeTransfers: p.getActiveTransfers(),
          queuedRequests: p.getQueuedRequests(),
          meanTransferTimeMs: p.getMeanTransferTime(),
          dropRate: p.getDropRate(),
          readCount: p.getReadCount(),
          writeCount: p.getWriteCount(),
          unit: 'KB/s',
        };
      }
      case NodeType.Scheduler: {
        const p = state.processor as SchedulerProcessor;
        return {
          outstandingJobs: p.getOutstandingCount(),
          deferredTriggers: p.getDeferredCount(),
          unfinishedJobCount: p.getUnfinishedJobCount(),
          discardedDeferredCount: p.getDiscardedDeferredCount(),
          windowTriggered: p.getWindowTriggered(),
          windowSkipped: p.getWindowSkipped(),
          windowJobsEmitted: p.getWindowJobsEmitted(),
          cumulativeTriggered: p.getCumulativeTriggered(),
          cumulativeJobsEmitted: p.getCumulativeJobsEmitted(),
          cumulativeSkipped: p.getCumulativeSkipped(),
          unit: 'triggers',
        };
      }
      default:
        return undefined;
    }
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
