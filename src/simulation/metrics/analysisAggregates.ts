import type { SimulationNode } from '@/types/nodes';
import { NodeType } from '@/types/nodes';
import type { EdgeData } from '@/types/edges';
import type { SimRequest, NodeRuntimeState } from '../types';
import type { WorkerPoolProcessor } from '../processors/WorkerPoolProcessor';
import type { DeadLetterQueueProcessor } from '../processors/DeadLetterQueueProcessor';
import type { ObjectStoreProcessor } from '../processors/ObjectStoreProcessor';

// ─── Per-Node Per-Window Analysis Aggregates ─────────────────────

/**
 * Accumulated per-node, per-window aggregates the analysis layer needs.
 * No rule ever reads a per-request record (R41.3) — all quantities derive
 * from these O(1)-per-termination accumulators.
 */
export interface AnalysisWindowAggregates {
  /** Σ time-in-system at this node for requests/Jobs terminating in this window. */
  timeInSystemAtNodeMs: number;
  /** Σ time-in-system across the whole recorded path for those same requests/Jobs. */
  pathTimeInSystemMs: number;
  /** Requests/Jobs whose path (or branch paths) held this node, terminating this window. */
  terminatedThroughNodeCount: number;
  /** Arrivals in this window. */
  arrivalCount: number;
  /** Departures in this window (forwarded + completed + terminated here). */
  departureCount: number;
  /** Branches dispatched from this node in this window. */
  branchesDispatched: number;
  /** Per-edge forwarding counts in this window (edgeId → count). */
  forwardedByEdge: Record<string, number>;
}

function emptyAggregates(): AnalysisWindowAggregates {
  return {
    timeInSystemAtNodeMs: 0,
    pathTimeInSystemMs: 0,
    terminatedThroughNodeCount: 0,
    arrivalCount: 0,
    departureCount: 0,
    branchesDispatched: 0,
    forwardedByEdge: {},
  };
}

/**
 * Accumulates per-node, per-window aggregates so no analysis rule ever reads
 * a per-request record (R41.3). Called from the engine at terminal-status
 * assignment time while the request still holds its full lineage.
 */
export class AnalysisAggregatesAccumulator {
  private aggregates: Map<string, AnalysisWindowAggregates> = new Map();
  private nodeConfigs: Map<string, SimulationNode> = new Map();
  /** Reverse adjacency: target → edges into it. */
  private incomingEdges: Map<string, EdgeData[]> = new Map();

  constructor(nodes: SimulationNode[], edges: EdgeData[]) {
    for (const node of nodes) {
      this.aggregates.set(node.id, emptyAggregates());
      this.nodeConfigs.set(node.id, node);
    }
    // Build reverse adjacency for monitoredDepthBound computation
    for (const edge of edges) {
      const list = this.incomingEdges.get(edge.target) ?? [];
      list.push(edge);
      this.incomingEdges.set(edge.target, list);
    }
  }

  // ─── Task 429–431: Terminal-Time Accumulation ────────────────

  /**
   * Called once per terminal-status assignment while the request still holds
   * its full path and the parent still holds its `pendingBranchIds` lineage.
   *
   * Accumulates:
   * - timeInSystemAtNodeMs (per node on the request's path)
   * - pathTimeInSystemMs (whole-path total, attributed to each visited node)
   * - terminatedThroughNodeCount (path membership)
   */
  recordTermination(
    request: SimRequest,
    _nodeStates: Map<string, NodeRuntimeState>,
    allRequests: Map<string, SimRequest>,
  ): void {
    const pathTimeInSystem = request.accumulatedLatencyMs;

    // Collect the set of nodes this request touched (its own path)
    const touchedNodes = new Set<string>(request.path);

    // Fold in branch paths (R39.4): if this request dispatched branches,
    // include nodes visited by those branches.
    if (request.pendingBranchIds && request.pendingBranchIds.size > 0) {
      for (const branchId of request.pendingBranchIds) {
        const branch = allRequests.get(branchId);
        if (branch) {
          for (const nodeId of branch.path) {
            touchedNodes.add(nodeId);
          }
        }
      }
    }

    // For each node on the path, accumulate the Latency_Share numerator
    // The numerator is the time-in-system at each specific node. We approximate
    // with a per-hop equal share for the node's contribution to latency.
    // Each node's time-in-system contribution is the latency the request spent AT it.
    // Since we don't track per-node latency precisely, we use the node's contribution
    // as the hop count at this node — but actually the path array gives us the nodes
    // visited in order; the accumulatedLatencyMs is the total path latency.
    // For simplicity and correctness, we attribute equal share per hop.
    const hopsOnPath = request.path.length;
    const perHopLatency = hopsOnPath > 0 ? pathTimeInSystem / hopsOnPath : 0;

    for (const nodeId of request.path) {
      const agg = this.aggregates.get(nodeId);
      if (!agg) continue;
      agg.timeInSystemAtNodeMs += perHopLatency;
      agg.pathTimeInSystemMs += pathTimeInSystem;
    }

    // terminatedThroughNodeCount: count for every node touched by this request
    // or its branches
    for (const nodeId of touchedNodes) {
      const agg = this.aggregates.get(nodeId);
      if (agg) {
        agg.terminatedThroughNodeCount++;
      }
    }
  }

  // ─── Task 434: Arrival/Departure Counting ────────────────────

  recordArrival(nodeId: string): void {
    const agg = this.aggregates.get(nodeId);
    if (agg) agg.arrivalCount++;
  }

  recordDeparture(nodeId: string): void {
    const agg = this.aggregates.get(nodeId);
    if (agg) agg.departureCount++;
  }

  // ─── Task 435: Branch dispatch counting ──────────────────────

  recordBranchDispatched(nodeId: string): void {
    const agg = this.aggregates.get(nodeId);
    if (agg) agg.branchesDispatched++;
  }

  recordForwardedByEdge(edgeId: string, sourceNodeId: string): void {
    const agg = this.aggregates.get(sourceNodeId);
    if (agg) {
      agg.forwardedByEdge[edgeId] = (agg.forwardedByEdge[edgeId] ?? 0) + 1;
    }
  }

  // ─── Task 432–433: Monitored Depth & Bound ──────────────────

  /**
   * Compute monitoredDepth for a node:
   * - Worker_Pool → Job_Backlog (prefetch buffer depth)
   * - Message_Queue → buffered messages
   * - Other types that report a queue depth → queue depth
   * - Otherwise → null
   */
  getMonitoredDepth(nodeId: string, state: NodeRuntimeState): number | null {
    const config = this.nodeConfigs.get(nodeId);
    if (!config) return null;

    switch (config.nodeType) {
      case NodeType.WorkerPool: {
        const p = state.processor as unknown as WorkerPoolProcessor;
        if (typeof p.getJobBacklog === 'function') {
          return p.getJobBacklog();
        }
        return null;
      }
      case NodeType.MessageQueue:
        return state.bufferedMessages;
      case NodeType.AppServer:
      case NodeType.ApiGateway:
      case NodeType.RateLimiter:
      case NodeType.LoadBalancer:
      case NodeType.CircuitBreaker:
      case NodeType.Cache:
      case NodeType.Database:
      case NodeType.AuthService:
      case NodeType.AuthzService:
        // Report queue depth for nodes that maintain a queue
        return state.queuedRequests.length;
      case NodeType.DeadLetterQueue: {
        const p = state.processor as unknown as DeadLetterQueueProcessor;
        if (typeof p.getRetainedCount === 'function') {
          return p.getRetainedCount();
        }
        return null;
      }
      case NodeType.ObjectStore: {
        const p = state.processor as unknown as ObjectStoreProcessor;
        if (typeof p.getQueuedRequests === 'function') {
          return p.getQueuedRequests();
        }
        return null;
      }
      case NodeType.Scheduler:
      case NodeType.TrafficGenerator:
        return null;
      default:
        return null;
    }
  }

  /**
   * Compute monitoredDepthBound for a node:
   * - Worker_Pool → prefetchBufferDepth + Σ(bufferCapacity of all MQ edges into it)
   * - Message_Queue → bufferCapacity (configured max)
   * - Other types → configured max queue depth if available, else null
   */
  getMonitoredDepthBound(nodeId: string): number | null {
    const config = this.nodeConfigs.get(nodeId);
    if (!config) return null;

    switch (config.nodeType) {
      case NodeType.WorkerPool: {
        const wpConfig = config.config as { prefetchBufferDepth: number };
        let bound = wpConfig.prefetchBufferDepth;
        // Add capacity of every Message_Queue holding an edge into this Worker_Pool
        const incoming = this.incomingEdges.get(nodeId) ?? [];
        for (const edge of incoming) {
          const sourceConfig = this.nodeConfigs.get(edge.source);
          if (sourceConfig && sourceConfig.nodeType === NodeType.MessageQueue) {
            const mqConfig = sourceConfig.config as { bufferCapacity: number };
            bound += mqConfig.bufferCapacity;
          }
        }
        return bound;
      }
      case NodeType.MessageQueue: {
        const mqConfig = config.config as { bufferCapacity: number };
        return mqConfig.bufferCapacity;
      }
      case NodeType.AppServer: {
        const asConfig = config.config as { requestQueueDepth: number };
        return asConfig.requestQueueDepth;
      }
      case NodeType.ApiGateway:
        // ApiGateway doesn't have a configured queue depth bound
        return null;
      case NodeType.AuthService: {
        const authConfig = config.config as { queueDepth: number };
        return authConfig.queueDepth;
      }
      case NodeType.AuthzService: {
        const authzConfig = config.config as { queueDepth: number };
        return authzConfig.queueDepth;
      }
      case NodeType.DeadLetterQueue: {
        const dlqConfig = config.config as { capacity: number };
        return dlqConfig.capacity;
      }
      case NodeType.ObjectStore: {
        const osConfig = config.config as { transferQueueDepth: number };
        return osConfig.transferQueueDepth;
      }
      default:
        return null;
    }
  }

  // ─── Task 435: Type-Specific Optional Fields ─────────────────

  /**
   * Returns type-specific optional analysis fields for a node snapshot.
   */
  getTypeSpecificAnalysisFields(
    nodeId: string,
    state: NodeRuntimeState,
    currentTime: number,
    windowDurationMs: number,
  ): {
    concurrencyOccupied?: number;
    concurrencyBound?: number;
    jobBacklog?: number;
    backlogAgeMs?: number;
    retainedByUpstreamNode?: Record<string, number>;
    transferRateMBps?: number;
  } {
    const config = this.nodeConfigs.get(nodeId);
    if (!config) return {};

    switch (config.nodeType) {
      case NodeType.WorkerPool: {
        const p = state.processor as unknown as WorkerPoolProcessor;
        const wpConfig = config.config as { concurrency: number };
        return {
          concurrencyOccupied: state.activeConnections,
          concurrencyBound: wpConfig.concurrency,
          jobBacklog: typeof p.getJobBacklog === 'function' ? p.getJobBacklog() : undefined,
          backlogAgeMs: typeof p.getBacklogAge === 'function' ? p.getBacklogAge(currentTime) : undefined,
        };
      }
      case NodeType.DeadLetterQueue: {
        const p = state.processor as unknown as DeadLetterQueueProcessor;
        if (typeof p.getRetainedByUpstream === 'function') {
          return {
            retainedByUpstreamNode: p.getRetainedByUpstream(),
          };
        }
        return {};
      }
      case NodeType.ObjectStore: {
        const p = state.processor as unknown as ObjectStoreProcessor;
        if (typeof p.getTransferRateKBps === 'function') {
          const kbps = p.getTransferRateKBps(windowDurationMs);
          return {
            transferRateMBps: kbps / 1024,
          };
        }
        return {};
      }
      case NodeType.AppServer: {
        const asConfig = config.config as { workerThreadPoolSize: number };
        return {
          concurrencyOccupied: state.activeConnections,
          concurrencyBound: asConfig.workerThreadPoolSize,
        };
      }
      case NodeType.AuthService: {
        const authConfig = config.config as { concurrencyLimit: number };
        return {
          concurrencyOccupied: state.activeConnections,
          concurrencyBound: authConfig.concurrencyLimit,
        };
      }
      case NodeType.AuthzService: {
        const authzConfig = config.config as { concurrencyLimit: number };
        return {
          concurrencyOccupied: state.activeConnections,
          concurrencyBound: authzConfig.concurrencyLimit,
        };
      }
      default:
        return {};
    }
  }

  // ─── Snapshot Access & Reset ─────────────────────────────────

  getAggregates(nodeId: string): AnalysisWindowAggregates {
    return this.aggregates.get(nodeId) ?? emptyAggregates();
  }

  /**
   * Reset all per-window aggregates at window boundary.
   */
  resetWindow(): void {
    for (const [nodeId] of this.aggregates) {
      this.aggregates.set(nodeId, emptyAggregates());
    }
  }

  /**
   * Full reset (for simulation restart).
   */
  reset(): void {
    this.resetWindow();
  }
}
