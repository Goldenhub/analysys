import { NodeType, RoutingPolicy } from '@/types/nodes';
import type { SimulationNode } from '@/types/nodes';
import type { EdgeData } from '@/types/edges';
import type { SimulationEngineConfig, ChaosEventPayload } from '@/types/messages';
import type { MetricsBatchPayload } from '@/types/metrics';
import { MinHeap } from './eventQueue';
import { SeededRNG } from './prng';
import type { SimEvent, SimRequest, NodeRuntimeState, ProcessorContext, NodeProcessor } from './types';
import { SimEventType, SimState, RequestStatus, SubRequestPolicy, emptyTerminalCounts } from './types';
import type { TerminalStatus } from './types';
import { TrafficGeneratorProcessor } from './processors/TrafficGeneratorProcessor';
import { ApiGatewayProcessor } from './processors/ApiGatewayProcessor';
import { RateLimiterProcessor } from './processors/RateLimiterProcessor';
import { LoadBalancerProcessor } from './processors/LoadBalancerProcessor';
import { CircuitBreakerProcessor } from './processors/CircuitBreakerProcessor';
import { AppServerProcessor } from './processors/AppServerProcessor';
import { CacheProcessor } from './processors/CacheProcessor';
import { DatabaseProcessor } from './processors/DatabaseProcessor';
import { MessageQueueProcessor } from './processors/MessageQueueProcessor';
import { MetricsCollector } from './metrics/MetricsCollector';
import { AuthServiceProcessor } from './processors/AuthServiceProcessor';
import { AuthzServiceProcessor } from './processors/AuthzServiceProcessor';
import { WorkerPoolProcessor } from './processors/WorkerPoolProcessor';
import { DeadLetterQueueProcessor } from './processors/DeadLetterQueueProcessor';
import { ObjectStoreProcessor } from './processors/ObjectStoreProcessor';
import { SchedulerProcessor } from './processors/SchedulerProcessor';
import { dispatchBranches, settleBranch, mapBranchFailureToParent } from './subRequests';

export class SimulationEngine {
  private eventQueue: MinHeap<SimEvent>;
  private virtualClockMs = 0;
  private state: SimState = SimState.Idle;
  private rng: SeededRNG;
  private requests: Map<string, SimRequest> = new Map();
  private nodeStates: Map<string, NodeRuntimeState> = new Map();
  private nodeConfigs: Map<string, SimulationNode> = new Map();
  private adjacency: Map<string, EdgeData[]> = new Map();
  private eventCounter = 0;
  private requestCounter = 0;
  private config: SimulationEngineConfig;
  private metricsCollector: MetricsCollector;
  private startWallTime = 0;

  // R32.3 — engine-owned round-robin cursors, one per node. Initialised to 0,
  // advanced by 1 per forwarding decision, wrapping after the highest index.
  // Deliberately untouched by pause() and resume().
  private roundRobinCursors: Map<string, number> = new Map();

  // Callback for sending messages back to main thread
  private onMetricsBatch: ((payload: MetricsBatchPayload) => void) | null = null;
  private onNodeStatus: ((nodeId: string, status: 'green' | 'yellow' | 'red') => void) | null = null;
  private onEventLog: ((entries: Array<{ id: number; timestamp: number; type: string; nodeId: string; requestId?: string; message: string }>) => void) | null = null;
  private onComplete: ((summary: { totalEvents: number; totalRequests: number; successRate: number; avgEndToEndLatencyMs: number; simulatedDurationMs: number; wallClockDurationMs: number; eventsPerSecond: number }) => void) | null = null;

  // In-flight request tracking (time-weighted average)
  private inFlightCount = 0;
  private inFlightTimeWeightedSum = 0;
  private lastInFlightChangeTime = 0;
  private lastSnapshotTime = 0;
  private countedAsComplete: Set<string> = new Set();

  // Event log batching — accumulate entries and flush on metrics snapshot
  private pendingLogEntries: Array<{ id: number; timestamp: number; type: string; nodeId: string; requestId?: string; message: string }> = [];
  private completionLogCounter = 0;
  private readonly COMPLETION_LOG_SAMPLE_RATE = 50; // log every Nth completion

  // Batch control
  private readonly BATCH_SIZE = 200;

  constructor(config: SimulationEngineConfig) {
    this.config = config;
    this.rng = new SeededRNG(config.seed);
    this.eventQueue = new MinHeap<SimEvent>((a, b) => a.timestamp - b.timestamp);
    this.metricsCollector = new MetricsCollector(config.topology.nodes, 5000, config.topology.edges);

    this.buildAdjacency(config.topology.edges);
    this.initializeNodeStates(config.topology.nodes);
    this.scheduleInitialEvents(config.topology.nodes);
  }

  // ─── Public API ──────────────────────────────────────────────

  setCallbacks(callbacks: {
    onMetricsBatch?: (payload: MetricsBatchPayload) => void;
    onNodeStatus?: (nodeId: string, status: 'green' | 'yellow' | 'red') => void;
    onEventLog?: (entries: Array<{ id: number; timestamp: number; type: string; nodeId: string; requestId?: string; message: string }>) => void;
    onComplete?: (summary: { totalEvents: number; totalRequests: number; successRate: number; avgEndToEndLatencyMs: number; simulatedDurationMs: number; wallClockDurationMs: number; eventsPerSecond: number }) => void;
  }): void {
    this.onMetricsBatch = callbacks.onMetricsBatch ?? null;
    this.onNodeStatus = callbacks.onNodeStatus ?? null;
    this.onEventLog = callbacks.onEventLog ?? null;
    this.onComplete = callbacks.onComplete ?? null;
  }

  async run(): Promise<void> {
    this.state = SimState.Running;
    this.startWallTime = Date.now();
    this.metricsCollector.setRunStartTime(0); // Virtual clock starts at 0

    while (this.state === SimState.Running) {
      let processed = 0;

      while (processed < this.BATCH_SIZE && this.eventQueue.size > 0) {
        const event = this.eventQueue.extractMin()!;

        if (event.timestamp > this.config.maxSimulatedTimeMs) {
          this.state = SimState.Complete;
          this.handleMetricsSnapshot();
          this.emitComplete();
          return;
        }

        this.virtualClockMs = event.timestamp;
        this.processEvent(event);
        processed++;
      }

      // Yield to event loop so postMessage handlers can fire
      await this.yieldToMacroTask();

      if (this.eventQueue.size === 0) {
        this.state = SimState.Complete;
        this.handleMetricsSnapshot();
        this.emitComplete();
        return;
      }
    }
  }

  pause(): void {
    this.state = SimState.Paused;
  }

  resume(speedMultiplier: number): void {
    this.config.speedMultiplier = speedMultiplier;
    this.state = SimState.Running;
    this.run();
  }

  reset(): void {
    this.state = SimState.Idle;
    this.virtualClockMs = 0;
    this.eventQueue.clear();
    this.requests.clear();
    this.eventCounter = 0;
    this.requestCounter = 0;
    this.inFlightCount = 0;
    this.inFlightTimeWeightedSum = 0;
    this.lastInFlightChangeTime = 0;
    this.lastSnapshotTime = 0;
    this.countedAsComplete.clear();
    this.pendingLogEntries = [];
    this.completionLogCounter = 0;
    this.roundRobinCursors.clear();
    this.metricsCollector.reset();
    this.initializeNodeStates(this.config.topology.nodes);
    this.scheduleInitialEvents(this.config.topology.nodes);
  }

  injectChaos(payload: ChaosEventPayload): void {
    const { chaosType, targetNodeId, durationMs } = payload;

    const logEntries: Array<{ id: number; timestamp: number; type: string; nodeId: string; requestId?: string; message: string }> = [];

    // ─── Targeted chaos: DISABLE_NODE and REDRIVE_DLQ ──────────
    if ((chaosType === 'DISABLE_NODE' || chaosType === 'REDRIVE_DLQ') && targetNodeId) {
      const state = this.nodeStates.get(targetNodeId);
      const node = this.nodeConfigs.get(targetNodeId);
      if (!state || !node) return;

      if (chaosType === 'DISABLE_NODE') {
        // R39.10: Reject re-applying to an already-unreachable node
        if (state.unreachableUntilMs !== null) {
          const remaining = state.unreachableUntilMs - this.virtualClockMs;
          logEntries.push({
            id: this.eventCounter,
            timestamp: this.virtualClockMs,
            type: 'CHAOS_REJECTED',
            nodeId: targetNodeId,
            message: `DISABLE_NODE rejected for ${node.label}: already unreachable, ${Math.ceil(remaining)}ms remaining`,
          });
          if (logEntries.length > 0) this.onEventLog?.(logEntries);
          return;
        }

        // Mark node as unreachable
        state.unreachableUntilMs = this.virtualClockMs + durationMs;

        // R39.9: Terminate all held requests via onNodeDisabled
        const isDlq = node.nodeType === NodeType.DeadLetterQueue;
        if (!isDlq && state.processor.onNodeDisabled) {
          const heldRequestIds = state.processor.onNodeDisabled(this.getProcessorContext());
          // Terminate each held request as Timeout
          for (const reqId of heldRequestIds) {
            const req = this.requests.get(reqId);
            if (req && req.status === RequestStatus.InFlight) {
              this.terminateRequest(req, RequestStatus.Timeout, targetNodeId, this.virtualClockMs);
            }
          }
        }

        // Also terminate queued requests held in state.queuedRequests
        if (!isDlq) {
          for (const reqId of state.queuedRequests) {
            const req = this.requests.get(reqId);
            if (req && req.status === RequestStatus.InFlight) {
              this.terminateRequest(req, RequestStatus.Timeout, targetNodeId, this.virtualClockMs);
            }
          }
          state.queuedRequests = [];
          state.activeConnections = 0;
          state.bufferedMessages = 0;
        }

        logEntries.push({
          id: this.eventCounter,
          timestamp: this.virtualClockMs,
          type: 'CHAOS_START',
          nodeId: targetNodeId,
          message: `DISABLE_NODE applied to ${node.label} for ${durationMs}ms`,
        });

        // Emit NODE_STATE_CHANGE
        this.emitNodeStateChange(targetNodeId, true);

        // Schedule restoration
        this.scheduleEvent({
          type: SimEventType.NodeRestored,
          timestamp: this.virtualClockMs + durationMs,
          nodeId: targetNodeId,
          requestId: '',
          payload: { chaosType: 'DISABLE_NODE' },
        });
      } else {
        // REDRIVE_DLQ — same as existing DLQ_REDRIVE logic
        state.processor.onChaosApplied(chaosType, payload.params);
        logEntries.push({
          id: this.eventCounter,
          timestamp: this.virtualClockMs,
          type: 'CHAOS_START',
          nodeId: targetNodeId,
          message: `REDRIVE_DLQ applied to ${node.label}`,
        });
        this.scheduleEvent({
          type: SimEventType.DlqRedrive,
          timestamp: this.virtualClockMs,
          nodeId: targetNodeId,
          requestId: '',
          payload: { manual: true },
        });
      }

      if (logEntries.length > 0) this.onEventLog?.(logEntries);
      return;
    }

    // Apply chaos to relevant nodes (existing type-matching loop)
    for (const [nodeId, state] of this.nodeStates) {
      const node = this.nodeConfigs.get(nodeId);
      if (!node) continue;

      let applies = false;
      if (chaosType === 'FLUSH_CACHE' && node.nodeType === NodeType.Cache) applies = true;
      if (chaosType === 'DROP_DB' && node.nodeType === NodeType.Database) {
        applies = !targetNodeId || targetNodeId === nodeId;
      }
      if (chaosType === 'SPIKE_TRAFFIC' && node.nodeType === NodeType.TrafficGenerator) applies = true;
      if (chaosType === 'DLQ_REDRIVE' && node.nodeType === NodeType.DeadLetterQueue) {
        applies = !targetNodeId || targetNodeId === nodeId;
      }

      if (applies) {
        state.processor.onChaosApplied(chaosType, payload.params);
        logEntries.push({
          id: this.eventCounter,
          timestamp: this.virtualClockMs,
          type: 'CHAOS_START',
          nodeId,
          message: `Chaos "${chaosType}" applied to ${node.label} for ${durationMs}ms`,
        });
        // Schedule revert
        this.scheduleEvent({
          type: SimEventType.ChaosEnd,
          timestamp: this.virtualClockMs + durationMs,
          nodeId,
          requestId: '',
          payload: { chaosType },
        });

        // For SPIKE_TRAFFIC, immediately inject burst arrivals to make the spike feel instant
        if (chaosType === 'SPIKE_TRAFFIC') {
          const burstCount = 20;
          for (let i = 0; i < burstCount; i++) {
            this.scheduleEvent({
              type: SimEventType.RequestArrival,
              timestamp: this.virtualClockMs + i * 0.1,
              nodeId,
              requestId: '',
              payload: {},
            });
          }
        }

        // For DLQ_REDRIVE, trigger an immediate manual redrive
        if (chaosType === 'DLQ_REDRIVE') {
          this.scheduleEvent({
            type: SimEventType.DlqRedrive,
            timestamp: this.virtualClockMs,
            nodeId,
            requestId: '',
            payload: { manual: true },
          });
        }
      }
    }

    if (logEntries.length > 0) {
      this.onEventLog?.(logEntries);
    }
  }

  updateNodeConfig(nodeId: string, config: Record<string, unknown>): void {
    const node = this.nodeConfigs.get(nodeId);
    if (node) {
      Object.assign(node.config, config);
    }
  }

  getState(): SimState {
    return this.state;
  }

  getVirtualTime(): number {
    return this.virtualClockMs;
  }

  // ─── Event Processing ────────────────────────────────────────

  private processEvent(event: SimEvent): void {
    switch (event.type) {
      case SimEventType.RequestArrival:
        this.handleRequestArrival(event);
        break;
      case SimEventType.RequestRoute:
        this.handleRequestRoute(event);
        break;
      case SimEventType.RequestEnqueue:
        // Informational event — no action needed
        break;
      case SimEventType.RequestProcess:
        this.handleRequestProcess(event);
        break;
      case SimEventType.RequestComplete:
        this.handleRequestComplete(event);
        break;
      case SimEventType.RequestTimeout:
        this.handleRequestTimeout(event);
        break;
      case SimEventType.RequestDrop:
        this.handleRequestDrop(event);
        break;
      case SimEventType.MetricsSnapshot:
        this.handleMetricsSnapshot();
        break;
      case SimEventType.ChaosEnd:
        this.handleChaosEnd(event);
        break;
      case SimEventType.ConsumerPoll:
        this.handleConsumerPoll(event);
        break;
      case SimEventType.ResponseRoute:
        this.handleResponseRoute(event);
        break;
      case SimEventType.ResponseComplete:
        this.handleResponseComplete(event);
        break;
      case SimEventType.SubRequestSettled:
        this.handleSubRequestSettled(event);
        break;
      case SimEventType.VerificationComplete:
        this.handleVerificationComplete(event);
        break;
      case SimEventType.PolicyEvaluated:
        this.handlePolicyEvaluated(event);
        break;
      case SimEventType.JobAdmit:
        this.handleJobAdmit(event);
        break;
      case SimEventType.JobAttemptComplete:
        this.handleJobAttemptComplete(event);
        break;
      case SimEventType.JobRetryReady:
        this.handleJobRetryReady(event);
        break;
      case SimEventType.JobTimeout:
        this.handleJobTimeout(event);
        break;
      case SimEventType.DlqRedrive:
        this.handleDlqRedrive(event);
        break;
      case SimEventType.TransferComplete:
        this.handleTransferComplete(event);
        break;
      case SimEventType.SchedulerTrigger:
        this.handleSchedulerTrigger(event);
        break;
      case SimEventType.NodeRestored:
        this.handleNodeRestored(event);
        break;
      default:
        break;
    }
  }

  private handleRequestArrival(event: SimEvent): void {
    const node = this.nodeConfigs.get(event.nodeId);
    if (!node || node.nodeType !== NodeType.TrafficGenerator) return;

    // Create new request
    const requestId = `req-${this.requestCounter++}`;
    const request: SimRequest = {
      id: requestId,
      originNodeId: event.nodeId,
      createdAt: event.timestamp,
      status: RequestStatus.InFlight,
      hopCount: 0,
      maxHops: this.config.maxHopsPerRequest,
      path: [event.nodeId],
      accumulatedLatencyMs: 0,
      // R32.7 — a request emitted by a source node holds a fan-out depth of 0.
      fanOutDepth: 0,
      emittedByNodeId: event.nodeId,
    };
    this.requests.set(requestId, request);
    this.updateInFlightWeightedSum();
    this.inFlightCount++;

    // Route to first downstream node
    const outEdges = this.getOutgoingEdges(event.nodeId);
    if (outEdges.length === 0) {
      this.terminateRequest(request, RequestStatus.NoRoute, event.nodeId, event.timestamp);
      this.pendingLogEntries.push({
        id: this.eventCounter,
        timestamp: event.timestamp,
        type: 'REQUEST_DROP',
        nodeId: event.nodeId,
        requestId,
        message: `No downstream route available from ${node.label}`,
      });
    } else {
      const target = outEdges[0]!.target;
      this.scheduleEvent({
        type: SimEventType.RequestRoute,
        timestamp: event.timestamp,
        nodeId: target,
        requestId,
        payload: { fromNodeId: event.nodeId },
      });
    }

    // Schedule next arrival
    const processor = this.nodeStates.get(event.nodeId)?.processor as TrafficGeneratorProcessor | undefined;
    if (processor) {
      processor.scheduleNextArrival(event.nodeId, event.timestamp, this.getProcessorContext());
    }
  }

  private handleRequestRoute(event: SimEvent): void {
    const request = this.requests.get(event.requestId);
    if (!request || request.status !== RequestStatus.InFlight) return;

    // R39.9: If this node is unreachable, terminate the arriving request Timeout
    const routeState = this.nodeStates.get(event.nodeId);
    if (routeState && routeState.unreachableUntilMs !== null && routeState.unreachableUntilMs > event.timestamp) {
      this.terminateRequest(request, RequestStatus.Timeout, event.nodeId, event.timestamp);
      if (request.parentRequestId) {
        this.scheduleSubRequestSettled(request, event.timestamp);
      }
      return;
    }

    request.hopCount++;
    request.path.push(event.nodeId);

    // Cycle guard (task 328 — branches share the maxHops budget)
    if (request.hopCount > request.maxHops) {
      this.terminateRequest(request, RequestStatus.LoopDetected, event.nodeId, event.timestamp);
      // Guard 2 (task 335): branches schedule SubRequestSettled instead of decrementing
      if (request.parentRequestId) {
        this.scheduleSubRequestSettled(request, event.timestamp);
      }
      return;
    }

    // Fan_Out dispatch (tasks 327, 333): if this node has a FanOut policy,
    // dispatch branches here instead of delegating to the processor
    const nodeConfig = this.nodeConfigs.get(event.nodeId);
    const policy = nodeConfig?.routingPolicy ?? RoutingPolicy.First;
    if (policy === RoutingPolicy.FanOut) {
      const edges = this.getOutgoingEdges(event.nodeId);
      if (edges.length > 1) {
        if (request.fanOutDepth >= 4) {
          // Task 333: depth cap — forward on lowest stored index, no branching
          this.pendingLogEntries.push({
            id: this.eventCounter,
            timestamp: event.timestamp,
            type: 'FAN_OUT_CAP',
            nodeId: event.nodeId,
            requestId: request.id,
            message: `fan-out-depth-limit at ${nodeConfig?.label ?? event.nodeId} for request ${request.id}`,
          });
          // Fall through to normal processor handling with single target
        } else {
          // Dispatch branches — one per edge
          dispatchBranches({
            parent: request,
            dispatchNodeId: event.nodeId,
            edges,
            policy: SubRequestPolicy.FanOut,
            timestamp: event.timestamp,
            context: this.getProcessorContext(),
            requestMap: this.requests,
            getNextRequestId: () => `req-${this.requestCounter++}`,
          });
          // Parent is now suspended — don't delegate to processor
          return;
        }
      }
    }

    // Delegate to node processor
    const state = this.nodeStates.get(event.nodeId);
    if (state) {
      state.processor.onRequestArrived(event, request, this.getProcessorContext());
      // If the processor set a terminal status, handle accounting
      if (request.status !== RequestStatus.InFlight) {
        if (request.status !== RequestStatus.Success) {
          // Guard 2 (task 335): markRequestDone only for non-branches
          if (!request.parentRequestId) {
            this.markRequestDone(request.id);
          } else {
            // Branch: schedule SubRequestSettled
            this.scheduleSubRequestSettled(request, event.timestamp);
          }
        }
        // Log dropped requests (queue full / pool exhausted)
        if (request.status === RequestStatus.Dropped) {
          const nodeLabel = this.nodeConfigs.get(event.nodeId)?.label ?? event.nodeId;
          this.pendingLogEntries.push({
            id: this.eventCounter,
            timestamp: event.timestamp,
            type: 'REQUEST_DROP',
            nodeId: event.nodeId,
            requestId: request.id,
            message: `Request dropped at ${nodeLabel} (queue full)`,
          });
        }

        // Record terminal status for non-success (processor already set it)
        if (request.status !== RequestStatus.Success) {
          this.recordTerminalStatus(event.nodeId, request.status as TerminalStatus, request);
          if (request.parentRequestId) {
            this.metricsCollector.recordBranchTermination(request);
          } else {
            this.metricsCollector.recordCompletion(request);
          }
          this.notifySourceOfTerminal(request);
        }
      }
    }
  }

  private handleRequestProcess(event: SimEvent): void {
    const request = this.requests.get(event.requestId);
    if (!request) return;

    const node = this.nodeConfigs.get(event.nodeId);
    if (!node) return;

    const state = this.nodeStates.get(event.nodeId);
    if (!state) return;

    // Delegate to processor's onProcessComplete
    if (node.nodeType === NodeType.AppServer) {
      (state.processor as AppServerProcessor).onProcessComplete(event, request, this.getProcessorContext());
    } else if (node.nodeType === NodeType.Database) {
      (state.processor as DatabaseProcessor).onProcessComplete(event, request, this.getProcessorContext());
    }

    // If request is now complete, start response traversal
    if (request.status === RequestStatus.Success) {
      this.recordTerminalStatus(event.nodeId, RequestStatus.Success, request);
      this.startResponseTraversal(event, request);
    } else if (request.status === RequestStatus.Timeout) {
      this.recordTerminalStatus(event.nodeId, RequestStatus.Timeout, request);
      if (!request.parentRequestId) {
        this.markRequestDone(request.id);
      } else {
        this.scheduleSubRequestSettled(request, event.timestamp);
      }
      this.metricsCollector.recordCompletion(request);
    }
  }

  private handleRequestComplete(event: SimEvent): void {
    const request = this.requests.get(event.requestId);
    if (!request) return;
    if (request.status === RequestStatus.InFlight) {
      request.status = RequestStatus.Success;
    }
    if (request.status !== RequestStatus.Success) return;

    this.recordTerminalStatus(event.nodeId, RequestStatus.Success, request);
    // Start response traversal
    this.startResponseTraversal(event, request);
  }

  private startResponseTraversal(event: SimEvent, request: SimRequest): void {
    if (request.responseStartedAt) return; // Already started
    request.responseStartedAt = event.timestamp;

    const pathLen = request.path.length;
    if (pathLen > 1) {
      // Traverse back through the path
      this.scheduleEvent({
        type: SimEventType.ResponseRoute,
        timestamp: event.timestamp,
        nodeId: request.path[pathLen - 2]!,
        requestId: request.id,
        payload: { responseHopIndex: pathLen - 2 },
      });
    } else {
      // Single-node path — complete immediately
      this.scheduleEvent({
        type: SimEventType.ResponseComplete,
        timestamp: event.timestamp,
        nodeId: request.path[0]!,
        requestId: request.id,
        payload: {},
      });
    }
  }

  private handleResponseRoute(event: SimEvent): void {
    const request = this.requests.get(event.requestId);
    if (!request || !request.responseStartedAt) return;

    // Add response hop latency (network + serialization)
    const hopLatency = this.rng.normalPositive(2, 0.5);
    request.accumulatedLatencyMs += hopLatency;

    const responseHopIndex = event.payload.responseHopIndex as number;

    if (responseHopIndex <= 0) {
      // Task 329: branch response terminates at dispatch node (path[0])
      if (request.parentRequestId) {
        // Branch reached its dispatch node — emit SubRequestSettled
        this.scheduleEvent({
          type: SimEventType.SubRequestSettled,
          timestamp: event.timestamp + hopLatency,
          nodeId: request.dispatchedAtNodeId ?? request.path[0]!,
          requestId: request.id,
          payload: {},
        });
      } else {
        // Parent/top-level — reached origin, complete
        this.scheduleEvent({
          type: SimEventType.ResponseComplete,
          timestamp: event.timestamp + hopLatency,
          nodeId: request.path[0]!,
          requestId: request.id,
          payload: {},
        });
      }
    } else {
      // Continue backwards
      this.scheduleEvent({
        type: SimEventType.ResponseRoute,
        timestamp: event.timestamp + hopLatency,
        nodeId: request.path[responseHopIndex - 1]!,
        requestId: request.id,
        payload: { responseHopIndex: responseHopIndex - 1 },
      });
    }
  }

  private handleResponseComplete(event: SimEvent): void {
    const request = this.requests.get(event.requestId);
    if (!request) return;
    // Branches never reach ResponseComplete — they emit SubRequestSettled
    if (request.parentRequestId) return;

    request.completedAt = event.timestamp;
    this.recordTerminalStatus(event.nodeId, RequestStatus.Success, request);
    this.markRequestDone(request.id);
    this.metricsCollector.recordCompletion(request);

    // Notify the emitting source node (Scheduler overlap tracking)
    this.notifySourceOfTerminal(request);

    // Log every Nth completion
    this.completionLogCounter++;
    if (this.completionLogCounter >= this.COMPLETION_LOG_SAMPLE_RATE) {
      this.completionLogCounter = 0;
      const latency = Math.round(request.accumulatedLatencyMs * 100) / 100;
      this.pendingLogEntries.push({
        id: this.eventCounter,
        timestamp: event.timestamp,
        type: 'RESPONSE_COMPLETE',
        nodeId: event.nodeId,
        requestId: request.id,
        message: `← Response complete (round-trip: ${latency}ms, ${request.path.length} hops)`,
      });
    }
  }

  /**
   * Task 331/332 — SubRequestSettled handler.
   * Accumulates maxBranchSettleMs, removes from pendingBranchIds.
   * On last settle: adds max settle time to parent latency, resumes parent.
   * On failure: applies branchPolicy failure mapping to terminate parent.
   *
   * For Auth_Service and Authz_Service parents, delegates to processor-specific
   * settlement logic instead of the generic fan-out resume.
   */
  private handleSubRequestSettled(event: SimEvent): void {
    const branch = this.requests.get(event.requestId);
    if (!branch) return;

    const parent = branch.parentRequestId
      ? this.requests.get(branch.parentRequestId)
      : undefined;
    if (!parent) return;

    // If branch was discarded (sibling failed first), ignore
    if (branch.isDiscarded) return;

    const result = settleBranch(branch, parent, this.requests, event.timestamp);

    if (result.parentTerminated) {
      // Check if parent is at an Auth or Authz node — delegate to processor
      const dispatchNodeId = parent.dispatchedAtNodeId ?? parent.path[parent.path.length - 1] ?? event.nodeId;
      const nodeConfig = this.nodeConfigs.get(dispatchNodeId);

      if (nodeConfig?.nodeType === NodeType.AuthService) {
        const state = this.nodeStates.get(dispatchNodeId);
        if (state) {
          (state.processor as AuthServiceProcessor).onSubRequestSettled(
            parent, false, { ...event, nodeId: dispatchNodeId }, this.getProcessorContext(),
          );
        }
        return;
      }
      if (nodeConfig?.nodeType === NodeType.AuthzService) {
        const state = this.nodeStates.get(dispatchNodeId);
        if (state) {
          (state.processor as AuthzServiceProcessor).onSubRequestSettled(
            parent, false, branch.status, { ...event, nodeId: dispatchNodeId }, this.getProcessorContext(),
          );
        }
        return;
      }

      // Generic fan-out: apply failure mapping per branchPolicy (task 332)
      const mappedStatus = mapBranchFailureToParent(
        branch,
        parent.branchPolicy ?? SubRequestPolicy.FanOut,
      );
      this.terminateRequest(parent, mappedStatus as TerminalStatus, dispatchNodeId, event.timestamp);
    } else if (result.parentResumes) {
      // All branches settled successfully — check if parent is at Auth/Authz node
      const dispatchNodeId = parent.dispatchedAtNodeId ?? parent.path[parent.path.length - 1] ?? event.nodeId;
      const nodeConfig = this.nodeConfigs.get(dispatchNodeId);

      if (nodeConfig?.nodeType === NodeType.AuthService) {
        const state = this.nodeStates.get(dispatchNodeId);
        if (state) {
          (state.processor as AuthServiceProcessor).onSubRequestSettled(
            parent, true, { ...event, nodeId: dispatchNodeId }, this.getProcessorContext(),
          );
        }
        return;
      }
      if (nodeConfig?.nodeType === NodeType.AuthzService) {
        const state = this.nodeStates.get(dispatchNodeId);
        if (state) {
          (state.processor as AuthzServiceProcessor).onSubRequestSettled(
            parent, true, undefined, { ...event, nodeId: dispatchNodeId }, this.getProcessorContext(),
          );
        }
        return;
      }

      // Generic fan-out: resume parent with response traversal
      if (parent.status === RequestStatus.InFlight) {
        parent.status = RequestStatus.Success;
        parent.completedAt = event.timestamp;
        this.recordTerminalStatus(event.nodeId, RequestStatus.Success, parent);
        this.startResponseTraversal(
          { ...event, nodeId: parent.path[parent.path.length - 1]! },
          parent,
        );
      }
    }
  }

  /**
   * Schedule a SubRequestSettled event for a branch that has reached a terminal status.
   */
  private scheduleSubRequestSettled(request: SimRequest, timestamp: number): void {
    this.scheduleEvent({
      type: SimEventType.SubRequestSettled,
      timestamp,
      nodeId: request.dispatchedAtNodeId ?? request.path[0]!,
      requestId: request.id,
      payload: {},
    });
  }

  // ─── Auth/Authz/WorkerPool Event Handlers ────────────────────

  private handleVerificationComplete(event: SimEvent): void {
    const request = this.requests.get(event.requestId);
    if (!request) return;
    if (request.status !== RequestStatus.InFlight) return;

    const state = this.nodeStates.get(event.nodeId);
    if (state) {
      (state.processor as AuthServiceProcessor).onVerificationComplete(
        event, request, this.getProcessorContext(),
      );
      // If the processor set a terminal status, handle accounting
      // (The processor mutates request.status; TS narrowing from the guard above is stale.)
      const postStatus = request.status as RequestStatus;
      if (postStatus !== RequestStatus.InFlight && postStatus !== RequestStatus.Success) {
        this.recordTerminalStatus(event.nodeId, postStatus as TerminalStatus, request);
        if (request.parentRequestId) {
          this.scheduleSubRequestSettled(request, event.timestamp);
          this.metricsCollector.recordBranchTermination(request);
        } else {
          this.markRequestDone(request.id);
          this.metricsCollector.recordCompletion(request);
        }
        this.notifySourceOfTerminal(request);
      } else if (postStatus === RequestStatus.Success) {
        // Auth verified and forwarded or terminal Success — start response traversal
        this.recordTerminalStatus(event.nodeId, RequestStatus.Success, request);
        this.startResponseTraversal(event, request);
      }
    }
  }

  private handlePolicyEvaluated(event: SimEvent): void {
    const request = this.requests.get(event.requestId);
    if (!request) return;
    if (request.status !== RequestStatus.InFlight) return;

    const state = this.nodeStates.get(event.nodeId);
    if (state) {
      (state.processor as AuthzServiceProcessor).onPolicyEvaluated(
        event, request, this.getProcessorContext(),
      );
      // If the processor set a terminal status, handle accounting
      const postStatus2 = request.status as RequestStatus;
      if (postStatus2 !== RequestStatus.InFlight && postStatus2 !== RequestStatus.Success) {
        this.recordTerminalStatus(event.nodeId, postStatus2 as TerminalStatus, request);
        if (request.parentRequestId) {
          this.scheduleSubRequestSettled(request, event.timestamp);
          this.metricsCollector.recordBranchTermination(request);
        } else {
          this.markRequestDone(request.id);
          this.metricsCollector.recordCompletion(request);
        }
        this.notifySourceOfTerminal(request);
      } else if (postStatus2 === RequestStatus.Success) {
        // Policy evaluated and forwarded or terminal Success — start response traversal
        this.recordTerminalStatus(event.nodeId, RequestStatus.Success, request);
        this.startResponseTraversal(event, request);
      }
    }
  }

  private handleJobAdmit(event: SimEvent): void {
    const state = this.nodeStates.get(event.nodeId);
    if (state) {
      (state.processor as WorkerPoolProcessor).onJobAdmit(event, this.getProcessorContext());
    }
  }

  private handleJobAttemptComplete(event: SimEvent): void {
    const request = this.requests.get(event.requestId);
    if (!request) return;

    const state = this.nodeStates.get(event.nodeId);
    if (state) {
      (state.processor as WorkerPoolProcessor).onJobAttemptComplete(event, this.getProcessorContext());
      // If the processor set a terminal status, handle accounting
      if (request.status !== RequestStatus.InFlight) {
        if (request.status === RequestStatus.RetryExhausted) {
          this.recordTerminalStatus(event.nodeId, RequestStatus.RetryExhausted, request);
          if (request.parentRequestId) {
            this.scheduleSubRequestSettled(request, event.timestamp);
            this.metricsCollector.recordBranchTermination(request);
          } else {
            this.markRequestDone(request.id);
            this.metricsCollector.recordCompletion(request);
          }
        } else if (request.status === RequestStatus.Success) {
          // Success is handled by the routing — response traversal is triggered by RequestRoute
        }
      }
    }
  }

  private handleJobRetryReady(event: SimEvent): void {
    const state = this.nodeStates.get(event.nodeId);
    if (state) {
      (state.processor as WorkerPoolProcessor).onJobRetryReady(event, this.getProcessorContext());
    }
  }

  private handleJobTimeout(event: SimEvent): void {
    const request = this.requests.get(event.requestId);
    if (!request) return;

    const state = this.nodeStates.get(event.nodeId);
    if (state) {
      (state.processor as WorkerPoolProcessor).onJobTimeout(event, this.getProcessorContext());
      // If the processor set a terminal status, handle accounting
      if (request.status !== RequestStatus.InFlight) {
        this.recordTerminalStatus(event.nodeId, request.status as TerminalStatus, request);
        if (request.parentRequestId) {
          this.scheduleSubRequestSettled(request, event.timestamp);
          this.metricsCollector.recordBranchTermination(request);
        } else {
          this.markRequestDone(request.id);
          this.metricsCollector.recordCompletion(request);
        }
      }
    }
  }

  // ─── DLQ/ObjectStore/Scheduler Event Handlers ────────────────

  private handleDlqRedrive(event: SimEvent): void {
    const state = this.nodeStates.get(event.nodeId);
    if (state) {
      (state.processor as DeadLetterQueueProcessor).onDlqRedrive(event, this.getProcessorContext());
    }
  }

  private handleTransferComplete(event: SimEvent): void {
    const state = this.nodeStates.get(event.nodeId);
    if (state) {
      const request = this.requests.get(event.requestId);
      const wasPreviouslyInFlight = request?.status === RequestStatus.InFlight;

      (state.processor as ObjectStoreProcessor).onTransferComplete(event, this.getProcessorContext());

      // If the processor set success, handle accounting
      if (request && wasPreviouslyInFlight && request.status === RequestStatus.Success) {
        this.recordTerminalStatus(event.nodeId, RequestStatus.Success, request);
        if (request.parentRequestId) {
          this.scheduleSubRequestSettled(request, event.timestamp);
          this.metricsCollector.recordBranchTermination(request);
        } else {
          this.markRequestDone(request.id);
          this.metricsCollector.recordCompletion(request);
        }
        this.notifySourceOfTerminal(request);
      }
    }
  }

  private handleSchedulerTrigger(event: SimEvent): void {
    const state = this.nodeStates.get(event.nodeId);
    if (state) {
      const processor = state.processor as SchedulerProcessor;
      processor.onSchedulerTrigger(event, this.getProcessorContext());

      // Process emitted Jobs — register in-flight and handle NO_ROUTE
      for (const jobId of processor.lastEmittedIds) {
        const req = this.requests.get(jobId);
        if (!req) continue;

        if (req.status === RequestStatus.NoRoute) {
          // NO_ROUTE Job — register and immediately complete
          this.updateInFlightWeightedSum();
          this.inFlightCount++;
          this.recordTerminalStatus(event.nodeId, RequestStatus.NoRoute, req);
          this.markRequestDone(req.id);
          this.metricsCollector.recordCompletion(req);
          this.notifySourceOfTerminal(req);
        } else {
          // In-flight Job — register in the in-flight counter
          this.updateInFlightWeightedSum();
          this.inFlightCount++;
        }
      }
      processor.lastEmittedIds = [];
    }
  }

  /**
   * Notify the emitting Scheduler node when one of its Jobs reaches a terminal status.
   * Called from terminateRequest and other terminal paths.
   */
  private notifySourceOfTerminal(request: SimRequest): void {
    if (!request.emittedByNodeId) return;
    const sourceState = this.nodeStates.get(request.emittedByNodeId);
    if (!sourceState) return;
    const sourceConfig = this.nodeConfigs.get(request.emittedByNodeId);
    if (sourceConfig?.nodeType === NodeType.Scheduler) {
      const processor = sourceState.processor as SchedulerProcessor;
      processor.onJobTerminal(
        request.id,
        request.emittedByNodeId,
        request.completedAt ?? this.virtualClockMs,
        this.getProcessorContext(),
      );

      // If the scheduler emitted deferred Jobs, handle their accounting
      for (const jobId of processor.lastEmittedIds) {
        const req = this.requests.get(jobId);
        if (!req) continue;
        if (req.status === RequestStatus.NoRoute) {
          this.updateInFlightWeightedSum();
          this.inFlightCount++;
          this.recordTerminalStatus(request.emittedByNodeId, RequestStatus.NoRoute, req);
          this.markRequestDone(req.id);
          this.metricsCollector.recordCompletion(req);
          // Don't recursively call notifySourceOfTerminal for NO_ROUTE Jobs
          // since the outstanding set is already empty at this point
        } else {
          this.updateInFlightWeightedSum();
          this.inFlightCount++;
        }
      }
      processor.lastEmittedIds = [];
    }
  }

  private handleRequestTimeout(event: SimEvent): void {
    const request = this.requests.get(event.requestId);
    if (!request) return;
    if (request.status === RequestStatus.InFlight) {
      this.terminateRequest(request, RequestStatus.Timeout, event.nodeId, event.timestamp);
      const state = this.nodeStates.get(event.nodeId);
      if (state) {
        state.totalTimedOut++;
        // Remove from queue if still queued
        const idx = state.queuedRequests.indexOf(request.id);
        if (idx >= 0) state.queuedRequests.splice(idx, 1);
      }
      // If branch, schedule settle
      if (request.parentRequestId) {
        this.scheduleSubRequestSettled(request, event.timestamp);
      }
      this.metricsCollector.recordDeparture(event.nodeId, request.id, event.timestamp);

      // Always log timeouts — they indicate problems
      const nodeLabel = this.nodeConfigs.get(event.nodeId)?.label ?? event.nodeId;
      this.pendingLogEntries.push({
        id: this.eventCounter,
        timestamp: event.timestamp,
        type: 'REQUEST_TIMEOUT',
        nodeId: event.nodeId,
        requestId: request.id,
        message: `Request timed out at ${nodeLabel}`,
      });
    }
  }

  /**
   * Terminates a request that a node explicitly dropped (e.g. an MQ buffer
   * eviction). Without this the dropped request would stay InFlight forever and
   * leak a slot in the in-flight counter.
   */
  private handleRequestDrop(event: SimEvent): void {
    const request = this.requests.get(event.requestId);
    if (!request) return;
    if (request.status !== RequestStatus.InFlight) return;

    this.terminateRequest(request, RequestStatus.Dropped, event.nodeId, event.timestamp);
    this.metricsCollector.recordDeparture(event.nodeId, request.id, event.timestamp);

    // If branch, schedule settle
    if (request.parentRequestId) {
      this.scheduleSubRequestSettled(request, event.timestamp);
    }

    const nodeLabel = this.nodeConfigs.get(event.nodeId)?.label ?? event.nodeId;
    const reason = typeof event.payload.reason === 'string' ? event.payload.reason : 'DROPPED';
    this.pendingLogEntries.push({
      id: this.eventCounter,
      timestamp: event.timestamp,
      type: 'REQUEST_DROP',
      nodeId: event.nodeId,
      requestId: request.id,
      message: `Request dropped at ${nodeLabel} (${reason})`,
    });
  }

  private handleMetricsSnapshot(): void {
    this.updateInFlightWeightedSum();
    const windowDuration = this.virtualClockMs - this.lastSnapshotTime;
    // Keep one decimal place: low-traffic topologies have a true average well
    // below 1, which a plain Math.round would collapse to 0.
    const avgInFlight = windowDuration > 0
      ? Math.round((this.inFlightTimeWeightedSum / windowDuration) * 10) / 10
      : this.inFlightCount;

    const batch = this.metricsCollector.generateBatch(
      this.virtualClockMs,
      this.nodeStates,
      avgInFlight,
    );
    this.onMetricsBatch?.(batch);

    // Flush pending event log entries to main thread
    if (this.pendingLogEntries.length > 0) {
      this.onEventLog?.(this.pendingLogEntries);
      this.pendingLogEntries = [];
    }

    // Reset for next window
    this.inFlightTimeWeightedSum = 0;
    this.lastSnapshotTime = this.virtualClockMs;

    // Emit node statuses
    for (const nodeSnapshot of batch.nodes) {
      this.onNodeStatus?.(nodeSnapshot.nodeId, nodeSnapshot.healthStatus);
    }

    // R26.5 — call onMetricsWindowBoundary on all processors BEFORE resetting counters
    for (const state of this.nodeStates.values()) {
      state.processor.onMetricsWindowBoundary?.(this.getProcessorContext());
    }

    // Reset per-window counters
    for (const state of this.nodeStates.values()) {
      state.totalProcessed = 0;
      state.totalDropped = 0;
      state.totalTimedOut = 0;
      state.latencySamples = [];
      // R31.4 — the per-window partition resets with the counters above.
      // `cumulativeTerminalCounts` is deliberately left alone (R31.3).
      state.terminalCounts = emptyTerminalCounts();
      state.processor.resetWindowCounters?.();
    }

    // Schedule next snapshot
    this.scheduleEvent({
      type: SimEventType.MetricsSnapshot,
      timestamp: this.virtualClockMs + this.config.metricsIntervalMs,
      nodeId: '',
      requestId: '',
      payload: {},
    });
  }

  private handleChaosEnd(event: SimEvent): void {
    const state = this.nodeStates.get(event.nodeId);
    if (state) {
      state.processor.onChaosReverted();
      const nodeLabel = this.nodeConfigs.get(event.nodeId)?.label ?? event.nodeId;
      const chaosType = (event.payload as { chaosType?: string })?.chaosType ?? 'unknown';
      this.pendingLogEntries.push({
        id: this.eventCounter,
        timestamp: event.timestamp,
        type: 'CHAOS_END',
        nodeId: event.nodeId,
        message: `Chaos "${chaosType}" reverted on ${nodeLabel}`,
      });
    }
  }

  private handleNodeRestored(event: SimEvent): void {
    const state = this.nodeStates.get(event.nodeId);
    if (!state) return;

    // Clear the unreachable flag
    state.unreachableUntilMs = null;

    // Restore bounded resources at 0 occupancy
    state.activeConnections = 0;
    state.queuedRequests = [];
    state.bufferedMessages = 0;

    // Invoke processor's onNodeRestored
    if (state.processor.onNodeRestored) {
      state.processor.onNodeRestored(this.getProcessorContext());
    }

    const nodeLabel = this.nodeConfigs.get(event.nodeId)?.label ?? event.nodeId;
    this.pendingLogEntries.push({
      id: this.eventCounter,
      timestamp: event.timestamp,
      type: 'NODE_RESTORED',
      nodeId: event.nodeId,
      message: `Node ${nodeLabel} restored at ${event.timestamp}ms`,
    });

    // Emit NODE_STATE_CHANGE
    this.emitNodeStateChange(event.nodeId, false);
  }

  private emitNodeStateChange(nodeId: string, unreachable: boolean): void {
    this.onEventLog?.([{
      id: this.eventCounter,
      timestamp: this.virtualClockMs,
      type: 'NODE_STATE_CHANGE',
      nodeId,
      message: unreachable
        ? `Node became unreachable`
        : `Node restored to service`,
    }]);
  }

  private handleConsumerPoll(event: SimEvent): void {
    const state = this.nodeStates.get(event.nodeId);
    if (state) {
      (state.processor as MessageQueueProcessor).onConsumerPoll(event, this.getProcessorContext());
    }
  }

  // ─── Initialization ──────────────────────────────────────────

  private buildAdjacency(edges: EdgeData[]): void {
    this.adjacency.clear();
    for (const edge of edges) {
      const list = this.adjacency.get(edge.source) ?? [];
      list.push(edge);
      this.adjacency.set(edge.source, list);
    }
  }

  private initializeNodeStates(nodes: SimulationNode[]): void {
    this.nodeStates.clear();
    this.nodeConfigs.clear();
    this.roundRobinCursors.clear();

    for (const node of nodes) {
      this.nodeConfigs.set(node.id, node);
      this.roundRobinCursors.set(node.id, 0);
      const processor = this.createProcessor(node);
      this.nodeStates.set(node.id, {
        nodeId: node.id,
        processor,
        activeConnections: 0,
        queuedRequests: [],
        bufferedMessages: 0,
        totalProcessed: 0,
        totalDropped: 0,
        totalTimedOut: 0,
        latencySamples: [],
        terminalCounts: emptyTerminalCounts(),
        cumulativeTerminalCounts: emptyTerminalCounts(),
        unreachableUntilMs: null,
      });
    }
  }

  private createProcessor(node: SimulationNode): NodeProcessor {
    switch (node.nodeType) {
      case NodeType.TrafficGenerator:
        return new TrafficGeneratorProcessor(node.config);
      case NodeType.ApiGateway:
        return new ApiGatewayProcessor(node.config);
      case NodeType.RateLimiter:
        return new RateLimiterProcessor(node.config);
      case NodeType.LoadBalancer:
        return new LoadBalancerProcessor(node.config);
      case NodeType.CircuitBreaker:
        return new CircuitBreakerProcessor(node.config);
      case NodeType.AppServer:
        return new AppServerProcessor(node.config);
      case NodeType.Cache:
        return new CacheProcessor(node.config);
      case NodeType.Database:
        return new DatabaseProcessor(node.config);
      case NodeType.MessageQueue:
        return new MessageQueueProcessor(node.config);
      case NodeType.AuthService:
        return new AuthServiceProcessor(node.config);
      case NodeType.AuthzService:
        return new AuthzServiceProcessor(node.config);
      case NodeType.WorkerPool:
        return new WorkerPoolProcessor(node.config);
      case NodeType.DeadLetterQueue:
        return new DeadLetterQueueProcessor(node.config);
      case NodeType.ObjectStore:
        return new ObjectStoreProcessor(node.config);
      case NodeType.Scheduler:
        return new SchedulerProcessor(node.config);
    }
  }

  private scheduleInitialEvents(nodes: SimulationNode[]): void {
    // Schedule first arrival from each TrafficGenerator
    for (const node of nodes) {
      if (node.nodeType === NodeType.TrafficGenerator) {
        const processor = this.nodeStates.get(node.id)?.processor as TrafficGeneratorProcessor;
        processor.scheduleNextArrival(node.id, 0, this.getProcessorContext());
      }
      // Schedule first trigger from each Scheduler
      if (node.nodeType === NodeType.Scheduler) {
        const processor = this.nodeStates.get(node.id)?.processor as SchedulerProcessor;
        processor.scheduleFirstTrigger(node.id, this.getProcessorContext());
      }
    }

    // Schedule first metrics snapshot
    this.scheduleEvent({
      type: SimEventType.MetricsSnapshot,
      timestamp: this.config.metricsIntervalMs,
      nodeId: '',
      requestId: '',
      payload: {},
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────

  private markRequestDone(requestId: string): void {
    if (!this.countedAsComplete.has(requestId)) {
      this.countedAsComplete.add(requestId);
      this.updateInFlightWeightedSum();
      this.inFlightCount = Math.max(0, this.inFlightCount - 1);
    }
  }

  /**
   * Task 339 — inverse of markRequestDone for DLQ Redrive.
   * Returns a dead-lettered Job to InFlight.
   */
  private unmarkRequestDone(requestId: string): void {
    if (!this.countedAsComplete.delete(requestId)) return;
    this.updateInFlightWeightedSum();
    this.inFlightCount++;
  }

  /**
   * Task 338 — single terminal-assignment helper replacing all direct status writes.
   * Asserts the request was InFlight before assigning.
   * Records the terminal status against the node's per-window and cumulative counts.
   * For branches, records only per-node (via recordBranchTermination).
   * For parents/top-level, records system-wide + per-node (via recordCompletion).
   */
  private terminateRequest(
    request: SimRequest,
    status: TerminalStatus,
    nodeId: string,
    timestamp: number,
  ): void {
    if (request.status !== RequestStatus.InFlight) return;
    request.status = status;
    request.completedAt = timestamp;

    // Record terminal status counts on the node
    this.recordTerminalStatus(nodeId, status, request);

    if (request.parentRequestId) {
      // Branch — per-node aggregates only, no system-wide counting
      this.metricsCollector.recordBranchTermination(request);
    } else {
      // Parent or top-level request
      this.markRequestDone(request.id);
      this.metricsCollector.recordCompletion(request);
    }

    // Notify the emitting source node (Scheduler overlap tracking)
    this.notifySourceOfTerminal(request);
  }

  /**
   * Task 340 — record a terminal status against a node's per-window and cumulative counts.
   */
  private recordTerminalStatus(nodeId: string, status: TerminalStatus, request?: SimRequest): void {
    const state = this.nodeStates.get(nodeId);
    if (!state) return;
    state.terminalCounts[status]++;
    state.cumulativeTerminalCounts[status]++;

    // Task 428–436: record analysis aggregates at terminal-status assignment time
    // while the request still holds its full lineage.
    if (request) {
      this.metricsCollector.recordTerminationForAnalysis(
        request, status, this.virtualClockMs, this.nodeStates, this.requests,
      );
      // Departures: a termination at this node counts as a departure
      this.metricsCollector.recordAnalysisDeparture(nodeId);
    }
  }

  private updateInFlightWeightedSum(): void {
    const now = this.virtualClockMs;
    const dt = now - this.lastInFlightChangeTime;
    if (dt > 0) {
      this.inFlightTimeWeightedSum += this.inFlightCount * dt;
    }
    this.lastInFlightChangeTime = now;
  }

  private scheduleEvent(partial: Omit<SimEvent, 'id'>): void {
    this.eventQueue.insert({
      ...partial,
      id: this.eventCounter++,
    });
  }

  private getOutgoingEdges(nodeId: string): EdgeData[] {
    return this.adjacency.get(nodeId) ?? [];
  }

  /**
   * R32.2–R32.8 — resolve which outgoing edges to dispatch a request along, per the
   * node's routing policy:
   *   First: the outgoing edge of lowest stored index (index 0).
   *   Round_Robin: the edge at the engine-owned cursor, advanced by 1 after each decision.
   *   Weighted: one PRNG draw compared against cumulative normalised weights in ascending
   *     stored index order — configured weights stay unchanged.
   *   Fan_Out: every outgoing edge, unless `request.fanOutDepth >= 4`, in which case fall
   *     back to the lowest stored index alone (no branching).
   */
  private resolveTargets(nodeId: string, request: SimRequest): EdgeData[] {
    const edges = this.getOutgoingEdges(nodeId);
    if (edges.length === 0) return [];

    const node = this.nodeConfigs.get(nodeId);
    const policy = node?.routingPolicy ?? RoutingPolicy.First;

    switch (policy) {
      case RoutingPolicy.First:
        return [edges[0]!];

      case RoutingPolicy.RoundRobin: {
        const cursor = this.roundRobinCursors.get(nodeId) ?? 0;
        const selected = edges[cursor % edges.length]!;
        this.roundRobinCursors.set(nodeId, (cursor + 1) % edges.length);
        return [selected];
      }

      case RoutingPolicy.Weighted: {
        const selected = this.weightedSelect(nodeId, edges);
        return [selected];
      }

      case RoutingPolicy.FanOut: {
        if (request.fanOutDepth >= 4) {
          // Depth cap reached — forward along lowest stored index alone, no branching.
          this.pendingLogEntries.push({
            id: this.eventCounter,
            timestamp: this.virtualClockMs,
            type: 'FAN_OUT_CAP',
            nodeId,
            message: `Fan-out depth cap (4) reached at ${node?.label ?? nodeId}; forwarding on single edge`,
          });
          return [edges[0]!];
        }
        return [...edges];
      }
    }
  }

  /**
   * R32.4–R32.5 — one PRNG draw compared against cumulative normalised weights in ascending
   * stored index order. Configured weights are left unchanged (normalisation is idempotent:
   * we normalise on the fly without mutating edge.weight).
   *
   * R32.6 — if the sum of weights is zero or non-finite, fall back to uniform 1/outDegree
   * and emit a normalisation warning naming the node's user-assigned label.
   */
  private weightedSelect(nodeId: string, edges: EdgeData[]): EdgeData {
    const node = this.nodeConfigs.get(nodeId);
    let weightSum = 0;
    for (const edge of edges) {
      weightSum += edge.weight;
    }

    // Zero or non-finite weight-sum fallback to uniform 1/outDegree
    if (weightSum <= 0 || !isFinite(weightSum)) {
      const label = node?.label ?? nodeId;
      console.warn(
        `[routing] Normalisation warning: node "${label}" has a zero or non-finite weight sum (${weightSum}). Falling back to uniform 1/${edges.length}.`,
      );
      // Uniform selection via a single PRNG draw
      const draw = this.rng.next();
      const index = Math.min(Math.floor(draw * edges.length), edges.length - 1);
      return edges[index]!;
    }

    // Weighted selection with cumulative normalised weights
    const draw = this.rng.next();
    let cumulative = 0;
    for (const edge of edges) {
      cumulative += edge.weight / weightSum;
      if (draw < cumulative) {
        return edge;
      }
    }
    // Floating-point rounding — fall back to last edge
    return edges[edges.length - 1]!;
  }

  private getProcessorContext(): ProcessorContext {
    return {
      scheduleEvent: (partial) => this.scheduleEvent(partial),
      getOutgoingEdges: (nodeId) => this.getOutgoingEdges(nodeId),
      resolveTargets: (nodeId, request) => this.resolveTargets(nodeId, request),
      getNodeConfig: (nodeId) => this.nodeConfigs.get(nodeId),
      getNodeState: (nodeId) => this.nodeStates.get(nodeId),
      getRNG: () => this.rng,
      currentTime: () => this.virtualClockMs,
      recordArrival: (nodeId, requestId, timestamp) => {
        this.metricsCollector.recordArrival(nodeId, requestId, timestamp);
        this.metricsCollector.recordAnalysisArrival(nodeId);
      },
      recordDeparture: (nodeId, requestId, timestamp) => {
        this.metricsCollector.recordDeparture(nodeId, requestId, timestamp);
        this.metricsCollector.recordAnalysisDeparture(nodeId);
      },
      unmarkRequestDone: (requestId) => this.unmarkRequestDone(requestId),
      getRequestMap: () => this.requests,
      getNextRequestId: () => `req-${this.requestCounter++}`,
    };
  }

  private emitComplete(): void {
    // R28.13 — notify Scheduler processors of completion
    for (const [, state] of this.nodeStates) {
      if (state.processor instanceof SchedulerProcessor) {
        state.processor.onSimulationComplete();
      }
    }

    const wallClockMs = Date.now() - this.startWallTime;
    const allRequests = [...this.requests.values()];
    // Only count non-branch requests for system-wide summary
    const topLevelRequests = allRequests.filter((r) => !r.parentRequestId);
    const successful = topLevelRequests.filter((r) => r.status === RequestStatus.Success);
    const totalLatency = successful.reduce((sum, r) => sum + r.accumulatedLatencyMs, 0);
    // Task 341: report unfinished In_Flight count
    const unfinishedCount = topLevelRequests.filter((r) => r.status === RequestStatus.InFlight).length;

    this.onComplete?.({
      totalEvents: this.eventCounter,
      totalRequests: topLevelRequests.length,
      successRate: topLevelRequests.length > 0
        ? successful.length / (topLevelRequests.length - unfinishedCount || 1)
        : 0,
      avgEndToEndLatencyMs: successful.length > 0 ? totalLatency / successful.length : 0,
      simulatedDurationMs: this.virtualClockMs,
      wallClockDurationMs: wallClockMs,
      eventsPerSecond: wallClockMs > 0 ? (this.eventCounter / wallClockMs) * 1000 : 0,
    });
  }

  private yieldToMacroTask(): Promise<void> {
    if (this.config.disablePacing) {
      // In test mode, use immediate yield (no wall-clock delay)
      return new Promise((resolve) => setTimeout(resolve, 0));
    }
    // At 1x speed, yield for ~50ms between batches to allow UI updates and user interaction
    // At higher speeds, reduce the delay proportionally
    const delayMs = Math.max(1, Math.floor(50 / this.config.speedMultiplier));
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
