import type { SimulationNode } from '@/types/nodes';
import type { EdgeData } from '@/types/edges';

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
  ChaosStart = 'CHAOS_START',
  ChaosEnd = 'CHAOS_END',
  MetricsSnapshot = 'METRICS_SNAPSHOT',
  ConsumerPoll = 'CONSUMER_POLL',
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

export enum RequestStatus {
  InFlight = 'IN_FLIGHT',
  Success = 'SUCCESS',
  Timeout = 'TIMEOUT',
  Dropped = 'DROPPED',
  LoopDetected = 'LOOP_DETECTED',
  NoRoute = 'NO_ROUTE',
}

export interface SimRequest {
  id: string;
  originNodeId: string;
  createdAt: number;
  completedAt?: number;
  status: RequestStatus;
  hopCount: number;
  maxHops: number;
  path: string[];
  accumulatedLatencyMs: number;
}

// ─── Simulation State ────────────────────────────────────────────

export enum SimState {
  Idle = 'IDLE',
  Running = 'RUNNING',
  Paused = 'PAUSED',
  Complete = 'COMPLETE',
}

// ─── Node Runtime State ──────────────────────────────────────────

export interface NodeRuntimeState {
  nodeId: string;
  processor: NodeProcessor;
  activeConnections: number;
  queuedRequests: string[];
  bufferedMessages: number;
  totalProcessed: number;
  totalDropped: number;
  totalTimedOut: number;
  latencySamples: number[];
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
  getUtilization(): number;
}

/**
 * Context passed to processors so they can schedule events
 * and access topology information without coupling to the engine.
 */
export interface ProcessorContext {
  scheduleEvent(partial: Omit<SimEvent, 'id'>): void;
  getOutgoingEdges(nodeId: string): EdgeData[];
  getNodeConfig(nodeId: string): SimulationNode | undefined;
  getNodeState(nodeId: string): NodeRuntimeState | undefined;
  getRNG(): { next(): number; normalPositive(mean: number, stdDev: number): number; exponential(rate: number): number };
  currentTime(): number;
  recordArrival(nodeId: string, requestId: string, timestamp: number): void;
  recordDeparture(nodeId: string, requestId: string, timestamp: number): void;
}
