import type { SimulationNode } from '@/types/nodes';
import type { EdgeData } from '@/types/edges';
import type { UtilizationReading } from '@/types/metrics';

// ─── Simulation Event ────────────────────────────────────────────

export enum SimEventType {
  RequestArrival = 'REQUEST_ARRIVAL',
  RequestEnqueue = 'REQUEST_ENQUEUE',
  RequestProcess = 'REQUEST_PROCESS',
  RequestRoute = 'REQUEST_ROUTE',
  RequestComplete = 'REQUEST_COMPLETE',
  RequestTimeout = 'REQUEST_TIMEOUT',
  RequestDrop = 'REQUEST_DROP',
  RequestLoopDetected = 'REQUEST_LOOP_DETECTED',
  ResponseRoute = 'RESPONSE_ROUTE',
  ResponseComplete = 'RESPONSE_COMPLETE',
  ChaosStart = 'CHAOS_START',
  ChaosEnd = 'CHAOS_END',
  MetricsSnapshot = 'METRICS_SNAPSHOT',
  ConsumerPoll = 'CONSUMER_POLL',

  // ─── Requirement 23–32 Additions ───────────────────────────────
  // All dispatched from the existing `processEvent` switch in the engine.

  /** R32.9, R23.5, R24.4 — a fan-out or lookup branch has reached its dispatch node. */
  SubRequestSettled = 'SUB_REQUEST_SETTLED',
  /** R23.2 — an Auth_Service verification latency sample has elapsed. */
  VerificationComplete = 'VERIFICATION_COMPLETE',
  /** R24.2 — an Authz_Service policy evaluation has produced a decision. */
  PolicyEvaluated = 'POLICY_EVALUATED',
  /** R25.2 — a Job has taken a Worker_Pool concurrency slot. */
  JobAdmit = 'JOB_ADMIT',
  /** R25.5 — one Job attempt has finished, successfully or not. */
  JobAttemptComplete = 'JOB_ATTEMPT_COMPLETE',
  /** R25.6 — a failed Job's backoff has elapsed and it may be retried. */
  JobRetryReady = 'JOB_RETRY_READY',
  /** R25.10 — a Job exceeded its configured timeout. */
  JobTimeout = 'JOB_TIMEOUT',
  /** R26.6, R26.8 — a Dead_Letter_Queue is redriving retained messages. */
  DlqRedrive = 'DLQ_REDRIVE',
  /** R27.6 — an Object_Store transfer has completed. */
  TransferComplete = 'TRANSFER_COMPLETE',
  /** R28.2 — a Scheduler trigger has fired. */
  SchedulerTrigger = 'SCHEDULER_TRIGGER',
  /** R39.8 — DISABLE_NODE chaos has taken a node out of service. */
  NodeDisabled = 'NODE_DISABLED',
  /** R39.11 — a disabled node has been returned to service. */
  NodeRestored = 'NODE_RESTORED',
}

export interface SimEvent {
  id: number;
  timestamp: number;
  type: SimEventType;
  nodeId: string;
  requestId: string;
  payload: Record<string, unknown>;
}

// ─── Request Object ──────────────────────────────────────────────

/**
 * The nine terminal statuses of Requirement 31, plus the non-terminal `InFlight`.
 *
 * `InFlight` is counted under none of the nine (R31.1). Note that `ApiGatewayProcessor`
 * models an *unauthorized* rejection as `Dropped`: that behaviour predates this taxonomy
 * and is left alone so Requirement 22's metrics do not move. `Unauthenticated` is produced
 * only by an Auth_Service node and `Forbidden` only by an Authz_Service node.
 */
export enum RequestStatus {
  /** Non-terminal — counted under none of the nine. */
  InFlight = 'IN_FLIGHT',
  Success = 'SUCCESS',
  Timeout = 'TIMEOUT',
  Dropped = 'DROPPED',
  LoopDetected = 'LOOP_DETECTED',
  NoRoute = 'NO_ROUTE',
  /** R23.3, R23.11 — credential verification failed at an Auth_Service node. */
  Unauthenticated = 'UNAUTHENTICATED',
  /** R24.6 — policy evaluation denied the request at an Authz_Service node. */
  Forbidden = 'FORBIDDEN',
  /** R25.9 — a Job exhausted its retry budget. */
  RetryExhausted = 'RETRY_EXHAUSTED',
  /** R26.2 — the only reversible terminal status: a Redrive returns the Job to InFlight. */
  DeadLettered = 'DEAD_LETTERED',
}

/**
 * The nine terminal statuses, excluding `InFlight` (R31.1).
 *
 * Enumerated explicitly rather than derived by filtering `RequestStatus`, so that adding a
 * status to the enum without deciding whether it is terminal cannot silently widen the
 * partition the R31.3 sum invariant is defined over.
 */
export const TERMINAL_STATUSES = [
  RequestStatus.Success,
  RequestStatus.Timeout,
  RequestStatus.Dropped,
  RequestStatus.LoopDetected,
  RequestStatus.NoRoute,
  RequestStatus.Unauthenticated,
  RequestStatus.Forbidden,
  RequestStatus.RetryExhausted,
  RequestStatus.DeadLettered,
] as const;

/** A terminal status other than `InFlight`. */
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

/**
 * The three failure classes of R31.5. `Success` belongs to none of them, which is why this
 * is a partition of the eight *failure* statuses rather than of all nine.
 */
export enum FailureClass {
  /** Unauthenticated, Forbidden. */
  Admission = 'ADMISSION',
  /** Timeout, Dropped, RetryExhausted, DeadLettered. */
  CapacityReliability = 'CAPACITY_RELIABILITY',
  /** LoopDetected, NoRoute. */
  TopologyConfiguration = 'TOPOLOGY_CONFIG',
}

/**
 * Which failure class a terminal status falls under, or `null` for `Success` (R31.5).
 *
 * The total error rate of R31.5 is the count of terminations in the three classes over the
 * count of all nine statuses in the same window, so `Success` mapping to `null` is what
 * keeps it out of the numerator while staying in the denominator.
 */
export const FAILURE_CLASS_OF: Record<TerminalStatus, FailureClass | null> = {
  [RequestStatus.Success]: null,
  [RequestStatus.Unauthenticated]: FailureClass.Admission,
  [RequestStatus.Forbidden]: FailureClass.Admission,
  [RequestStatus.Timeout]: FailureClass.CapacityReliability,
  [RequestStatus.Dropped]: FailureClass.CapacityReliability,
  [RequestStatus.RetryExhausted]: FailureClass.CapacityReliability,
  [RequestStatus.DeadLettered]: FailureClass.CapacityReliability,
  [RequestStatus.LoopDetected]: FailureClass.TopologyConfiguration,
  [RequestStatus.NoRoute]: FailureClass.TopologyConfiguration,
};

/**
 * Why a sub-request was dispatched, which decides how its failure maps onto its parent
 * (R32.12, R23.5, R24.4).
 *
 * Declared here because `SimRequest.branchPolicy` needs it. The one shared
 * dispatch-and-settle mechanism that reads it lands with Phase 16.
 */
export enum SubRequestPolicy {
  FanOut = 'FAN_OUT',
  AuthIntrospection = 'AUTH_INTROSPECTION',
  AuthzLookup = 'AUTHZ_LOOKUP',
}

export interface SimRequest {
  id: string;
  originNodeId: string;
  createdAt: number;
  completedAt?: number;
  responseStartedAt?: number;
  status: RequestStatus;
  hopCount: number;
  maxHops: number;
  path: string[];
  accumulatedLatencyMs: number;

  // ─── Fan-Out Lineage (Requirement 32) ────────────────────────

  /** 0 at a source; a branch is its parent's depth plus 1; capped at 4 (R32.7, R32.13). */
  fanOutDepth: number;
  /** The source node that emitted this request — Scheduler overlap accounting (R28.5). */
  emittedByNodeId: string;

  // Branch-only. Absent on a request emitted by a source node.

  parentRequestId?: string;
  /** The fan-out or lookup node the branch was dispatched from; `path[0]` for a branch. */
  dispatchedAtNodeId?: string;
  dispatchedAtMs?: number;
  /** R32.10 — dispatched along an Asynchronous edge, so it settles when the target accepts. */
  settleOnAccept?: boolean;
  /** R32.12 — sibling of a failed branch: counted under no terminal status. */
  isDiscarded?: boolean;

  // Parent-only. Present only while this request has branches outstanding.

  pendingBranchIds?: Set<string>;
  /** R32.11 — the maximum branch settle time, and the only figure added to the parent. */
  maxBranchSettleMs?: number;
  branchPolicy?: SubRequestPolicy;
}

// ─── Simulation State ────────────────────────────────────────────

export enum SimState {
  Idle = 'IDLE',
  Running = 'RUNNING',
  Paused = 'PAUSED',
  Complete = 'COMPLETE',
}

// ─── Node Runtime State ──────────────────────────────────────────

/** A zeroed count for each of the nine terminal statuses. */
export function emptyTerminalCounts(): Record<TerminalStatus, number> {
  return {
    [RequestStatus.Success]: 0,
    [RequestStatus.Timeout]: 0,
    [RequestStatus.Dropped]: 0,
    [RequestStatus.LoopDetected]: 0,
    [RequestStatus.NoRoute]: 0,
    [RequestStatus.Unauthenticated]: 0,
    [RequestStatus.Forbidden]: 0,
    [RequestStatus.RetryExhausted]: 0,
    [RequestStatus.DeadLettered]: 0,
  };
}

export interface NodeRuntimeState {
  nodeId: string;
  processor: NodeProcessor;
  activeConnections: number;
  queuedRequests: string[];
  bufferedMessages: number;
  /**
   * Kept alongside `terminalCounts` rather than replaced by it:
   * `CircuitBreakerProcessor.downstreamErrorRate` and `deriveHealthStatus` read these
   * three, so the terminal partition is additive.
   */
  totalProcessed: number;
  totalDropped: number;
  totalTimedOut: number;
  latencySamples: number[];
  /** R31.4 — per metrics window; reset at each window boundary with the counters above. */
  terminalCounts: Record<TerminalStatus, number>;
  /** R31.3 — never reset, and the only counter a cumulative Finding may read. */
  cumulativeTerminalCounts: Record<TerminalStatus, number>;
}

// ─── Node Processor Interface ────────────────────────────────────

export interface NodeProcessor {
  onRequestArrived(
    event: SimEvent,
    request: SimRequest,
    context: ProcessorContext,
  ): void;
  onChaosApplied(chaosType: string, params: Record<string, unknown>): void;
  onChaosReverted(): void;
  getUtilization(): UtilizationReading;
  /** Optional: reset per-window internal counters after a metrics snapshot. */
  resetWindowCounters?(): void;
  /** R26.5 — retention expiry is evaluated on the window schedule, before counters reset. */
  onMetricsWindowBoundary?(context: ProcessorContext): void;
  /** R39.9 — DISABLE_NODE chaos. Returns the request IDs the node was holding. */
  onNodeDisabled?(context: ProcessorContext): string[];
  /** R39.11 — the node is returned to service. */
  onNodeRestored?(context: ProcessorContext): void;
}

/**
 * Context passed to processors so they can schedule events
 * and access topology information without coupling to the engine.
 */
export interface ProcessorContext {
  scheduleEvent(partial: Omit<SimEvent, 'id'>): void;
  getOutgoingEdges(nodeId: string): EdgeData[];
  /**
   * Every edge to dispatch this request along, per the node's routing policy (R32.2–R32.7).
   *
   * One edge for First, Round_Robin, and Weighted; every outgoing edge for Fan_Out below
   * the depth cap. Processors should prefer this over reading `getOutgoingEdges` directly,
   * so routing state cannot diverge per processor.
   */
  resolveTargets(nodeId: string, request: SimRequest): EdgeData[];
  getNodeConfig(nodeId: string): SimulationNode | undefined;
  getNodeState(nodeId: string): NodeRuntimeState | undefined;
  getRNG(): { next(): number; normalPositive(mean: number, stdDev: number): number; exponential(rate: number): number };
  currentTime(): number;
  recordArrival(nodeId: string, requestId: string, timestamp: number): void;
  recordDeparture(nodeId: string, requestId: string, timestamp: number): void;
}
