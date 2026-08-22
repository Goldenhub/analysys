import { describe, it, expect } from 'vitest';
import { CircuitState } from '@/types/nodes';
import type { EdgeData } from '@/types/edges';
import { EdgeProtocol } from '@/types/edges';
import type {
  NodeProcessor,
  NodeRuntimeState,
  ProcessorContext,
  SimEvent,
  SimRequest,
} from '../types';
import { SimEventType, RequestStatus, emptyTerminalCounts } from '../types';
import { ApiGatewayProcessor } from './ApiGatewayProcessor';
import { RateLimiterProcessor } from './RateLimiterProcessor';
import { CircuitBreakerProcessor } from './CircuitBreakerProcessor';

// ─── Test Doubles ────────────────────────────────────────────────

/** Placeholder processor for nodes the test never exercises directly. */
const inertProcessor: NodeProcessor = {
  onRequestArrived: () => {},
  onChaosApplied: () => {},
  onChaosReverted: () => {},
  getUtilization: () => ({ kind: 'value', value: 0, idle: true }),
};

/**
 * Utilization is a discriminated reading. These tests all assert on the numeric variant,
 * so unwrap it loudly rather than coercing a not-applicable reading to a number.
 */
function utilizationValue(processor: NodeProcessor): number {
  const reading = processor.getUtilization();
  if (reading.kind !== 'value') {
    throw new Error(`expected a numeric utilization reading, got: ${reading.reason}`);
  }
  return reading.value;
}

function makeNodeState(nodeId: string, overrides: Partial<NodeRuntimeState> = {}): NodeRuntimeState {
  return {
    nodeId,
    processor: inertProcessor,
    activeConnections: 0,
    queuedRequests: [],
    bufferedMessages: 0,
    totalProcessed: 0,
    totalDropped: 0,
    totalTimedOut: 0,
    latencySamples: [],
    terminalCounts: emptyTerminalCounts(),
    cumulativeTerminalCounts: emptyTerminalCounts(),
    ...overrides,
  };
}

interface HarnessOptions {
  /** Adjacency: source node id → outgoing edges. */
  edges?: Record<string, EdgeData[]>;
  /** Values returned in sequence by rng.next(); cycles when exhausted. */
  randomSequence?: number[];
}

/**
 * Minimal ProcessorContext that records scheduled events and lets a test
 * mutate any node's runtime state (which is how the breaker observes its
 * downstream dependency).
 */
class Harness implements ProcessorContext {
  readonly scheduled: SimEvent[] = [];
  readonly states = new Map<string, NodeRuntimeState>();
  readonly arrivals: Array<{ nodeId: string; requestId: string; timestamp: number }> = [];
  readonly departures: Array<{ nodeId: string; requestId: string; timestamp: number }> = [];

  private edges: Record<string, EdgeData[]>;
  private randomSequence: number[];
  private randomIndex = 0;
  private now = 0;
  private eventCounter = 0;

  constructor(options: HarnessOptions = {}) {
    this.edges = options.edges ?? {};
    this.randomSequence = options.randomSequence ?? [0.5];
  }

  nodeState(nodeId: string): NodeRuntimeState {
    let state = this.states.get(nodeId);
    if (!state) {
      state = makeNodeState(nodeId);
      this.states.set(nodeId, state);
    }
    return state;
  }

  setTime(timestamp: number): void {
    this.now = timestamp;
  }

  /** Builds a request/event pair at the given time and delivers it to `processor`. */
  deliver(processor: NodeProcessor, nodeId: string, timestamp: number, requestId: string): SimRequest {
    this.setTime(timestamp);
    const request: SimRequest = {
      id: requestId,
      originNodeId: 'gen-1',
      createdAt: timestamp,
      status: RequestStatus.InFlight,
      hopCount: 1,
      maxHops: 20,
      path: ['gen-1', nodeId],
      accumulatedLatencyMs: 0,
      fanOutDepth: 0,
      emittedByNodeId: 'gen-1',
    };
    const event: SimEvent = {
      id: this.eventCounter++,
      timestamp,
      type: SimEventType.RequestRoute,
      nodeId,
      requestId,
      payload: {},
    };
    // Ensure the node has runtime state, mirroring engine initialization.
    this.nodeState(nodeId);
    processor.onRequestArrived(event, request, this);
    return request;
  }

  routesTo(targetNodeId: string): SimEvent[] {
    return this.scheduled.filter(
      (e) => e.type === SimEventType.RequestRoute && e.nodeId === targetNodeId,
    );
  }

  // ─── ProcessorContext ──────────────────────────────────────────

  scheduleEvent(partial: Omit<SimEvent, 'id'>): void {
    this.scheduled.push({ ...partial, id: this.eventCounter++ });
  }

  getOutgoingEdges(nodeId: string): EdgeData[] {
    return this.edges[nodeId] ?? [];
  }

  resolveTargets(nodeId: string, _request: SimRequest): EdgeData[] {
    const edges = this.getOutgoingEdges(nodeId);
    return edges.slice(0, 1);
  }

  getNodeConfig(): undefined {
    return undefined;
  }

  getNodeState(nodeId: string): NodeRuntimeState | undefined {
    return this.states.get(nodeId);
  }

  getRNG() {
    return {
      next: () => {
        const value = this.randomSequence[this.randomIndex % this.randomSequence.length]!;
        this.randomIndex++;
        return value;
      },
      // Deterministic stand-in: the mean is enough to assert latency accounting.
      normalPositive: (mean: number) => mean,
      exponential: (rate: number) => 1 / rate,
    };
  }

  currentTime(): number {
    return this.now;
  }

  recordArrival(nodeId: string, requestId: string, timestamp: number): void {
    this.arrivals.push({ nodeId, requestId, timestamp });
  }

  recordDeparture(nodeId: string, requestId: string, timestamp: number): void {
    this.departures.push({ nodeId, requestId, timestamp });
  }
}

function edge(source: string, target: string): EdgeData {
  return { id: `${source}-${target}`, source, target, protocol: EdgeProtocol.Sync, weight: 1.0 };
}

// ─── Rate Limiter ────────────────────────────────────────────────

describe('RateLimiterProcessor', () => {
  it('admits up to bucketCapacity in an instantaneous burst then rejects', () => {
    const harness = new Harness({ edges: { 'rl-1': [edge('rl-1', 'app-1')] } });
    const processor = new RateLimiterProcessor({ bucketCapacity: 5, refillRatePerSec: 10 });

    const admitted: SimRequest[] = [];
    for (let i = 0; i < 5; i++) {
      admitted.push(harness.deliver(processor, 'rl-1', 0, `req-${i}`));
    }
    // 6th request in the same instant finds an empty bucket.
    const rejected = harness.deliver(processor, 'rl-1', 0, 'req-5');

    for (const request of admitted) {
      expect(request.status).toBe(RequestStatus.InFlight);
    }
    expect(rejected.status).toBe(RequestStatus.Dropped);

    const state = harness.nodeState('rl-1');
    expect(state.totalProcessed).toBe(5);
    expect(state.totalDropped).toBe(1);
    expect(state.latencySamples).toHaveLength(5);
    expect(harness.routesTo('app-1')).toHaveLength(5);

    // Nothing queues at a limiter.
    expect(state.queuedRequests).toHaveLength(0);
    expect(state.activeConnections).toBe(0);
  });

  it('refills tokens over elapsed time', () => {
    const harness = new Harness({ edges: { 'rl-1': [edge('rl-1', 'app-1')] } });
    const processor = new RateLimiterProcessor({ bucketCapacity: 20, refillRatePerSec: 10 });

    // Drain the bucket instantly.
    for (let i = 0; i < 20; i++) {
      harness.deliver(processor, 'rl-1', 0, `burst-${i}`);
    }
    expect(harness.deliver(processor, 'rl-1', 0, 'burst-overflow').status).toBe(
      RequestStatus.Dropped,
    );

    // One second later 10 tokens have been replenished.
    let admittedAfterRefill = 0;
    for (let i = 0; i < 15; i++) {
      const request = harness.deliver(processor, 'rl-1', 1000, `refill-${i}`);
      if (request.status === RequestStatus.InFlight) admittedAfterRefill++;
    }

    expect(admittedAfterRefill).toBeGreaterThanOrEqual(10);
  });

  it('reports utilization as the fraction of the bucket drained', () => {
    const harness = new Harness({ edges: { 'rl-1': [edge('rl-1', 'app-1')] } });
    const processor = new RateLimiterProcessor({ bucketCapacity: 10, refillRatePerSec: 1 });

    expect(utilizationValue(processor)).toBe(0);
    for (let i = 0; i < 10; i++) {
      harness.deliver(processor, 'rl-1', 0, `req-${i}`);
    }
    expect(utilizationValue(processor)).toBe(1);
  });
});

// ─── Circuit Breaker ─────────────────────────────────────────────

const BREAKER_CONFIG = { errorThreshold: 0.5, openDurationMs: 5000, probeCount: 3 };

/** Downstream state with enough samples to be trusted, at the given error rate. */
function setDownstream(
  harness: Harness,
  nodeId: string,
  { processed, dropped }: { processed: number; dropped: number },
): void {
  const state = harness.nodeState(nodeId);
  state.totalProcessed = processed;
  state.totalDropped = dropped;
  state.totalTimedOut = 0;
}

describe('CircuitBreakerProcessor', () => {
  function makeHarness() {
    const harness = new Harness({ edges: { 'cb-1': [edge('cb-1', 'db-1')] } });
    harness.nodeState('db-1');
    return harness;
  }

  it('starts Closed and forwards while downstream is healthy', () => {
    const harness = makeHarness();
    const processor = new CircuitBreakerProcessor(BREAKER_CONFIG);
    setDownstream(harness, 'db-1', { processed: 20, dropped: 0 });

    expect(processor.getCircuitState()).toBe(CircuitState.Closed);

    const request = harness.deliver(processor, 'cb-1', 0, 'req-0');

    expect(request.status).toBe(RequestStatus.InFlight);
    expect(processor.getCircuitState()).toBe(CircuitState.Closed);
    expect(harness.routesTo('db-1')).toHaveLength(1);
    expect(request.accumulatedLatencyMs).toBeGreaterThan(0);

    const state = harness.nodeState('cb-1');
    expect(state.totalProcessed).toBe(1);
    expect(state.latencySamples).toHaveLength(1);
    expect(utilizationValue(processor)).toBe(0);
  });

  it('trips Open when the downstream error rate exceeds the threshold', () => {
    const harness = makeHarness();
    const processor = new CircuitBreakerProcessor(BREAKER_CONFIG);
    // 12 observations, 100% failing — well past MIN_OBSERVATIONS.
    setDownstream(harness, 'db-1', { processed: 0, dropped: 12 });

    const request = harness.deliver(processor, 'cb-1', 0, 'req-0');

    expect(processor.getCircuitState()).toBe(CircuitState.Open);
    expect(request.status).toBe(RequestStatus.Dropped);
    expect(harness.nodeState('cb-1').totalDropped).toBe(1);
    expect(utilizationValue(processor)).toBe(1);
  });

  it('does not trip when downstream observations are below the minimum', () => {
    const harness = makeHarness();
    const processor = new CircuitBreakerProcessor(BREAKER_CONFIG);
    // 100% error rate, but only 5 samples — not enough to act on.
    setDownstream(harness, 'db-1', { processed: 0, dropped: 5 });

    const request = harness.deliver(processor, 'cb-1', 0, 'req-0');

    expect(processor.getCircuitState()).toBe(CircuitState.Closed);
    expect(request.status).toBe(RequestStatus.InFlight);
    expect(harness.routesTo('db-1')).toHaveLength(1);
  });

  it('schedules no downstream route while Open', () => {
    const harness = makeHarness();
    const processor = new CircuitBreakerProcessor(BREAKER_CONFIG);
    setDownstream(harness, 'db-1', { processed: 0, dropped: 12 });

    for (let i = 0; i < 5; i++) {
      const request = harness.deliver(processor, 'cb-1', i, `req-${i}`);
      expect(request.status).toBe(RequestStatus.Dropped);
    }

    expect(processor.getCircuitState()).toBe(CircuitState.Open);
    expect(harness.routesTo('db-1')).toHaveLength(0);
    expect(harness.nodeState('cb-1').totalDropped).toBe(5);
  });

  it('moves to HalfOpen after openDurationMs and probes downstream', () => {
    const harness = makeHarness();
    const processor = new CircuitBreakerProcessor(BREAKER_CONFIG);
    setDownstream(harness, 'db-1', { processed: 0, dropped: 12 });

    harness.deliver(processor, 'cb-1', 0, 'trip');
    expect(processor.getCircuitState()).toBe(CircuitState.Open);

    const probe = harness.deliver(processor, 'cb-1', BREAKER_CONFIG.openDurationMs, 'probe-0');

    expect(processor.getCircuitState()).toBe(CircuitState.HalfOpen);
    expect(probe.status).toBe(RequestStatus.InFlight);
    expect(harness.routesTo('db-1')).toHaveLength(1);
    expect(utilizationValue(processor)).toBe(0.5);
  });

  it('returns to Closed when probes find a healthy downstream', () => {
    const harness = makeHarness();
    const processor = new CircuitBreakerProcessor(BREAKER_CONFIG);
    setDownstream(harness, 'db-1', { processed: 0, dropped: 12 });

    harness.deliver(processor, 'cb-1', 0, 'trip');
    expect(processor.getCircuitState()).toBe(CircuitState.Open);

    // Downstream recovers while the breaker waits.
    setDownstream(harness, 'db-1', { processed: 20, dropped: 0 });

    // First arrival past the open window flips to HalfOpen and burns probe 1.
    const t = BREAKER_CONFIG.openDurationMs;
    harness.deliver(processor, 'cb-1', t, 'probe-0');
    expect(processor.getCircuitState()).toBe(CircuitState.HalfOpen);

    // Burn the remaining probes.
    for (let i = 1; i < BREAKER_CONFIG.probeCount; i++) {
      harness.deliver(processor, 'cb-1', t + i, `probe-${i}`);
      expect(processor.getCircuitState()).toBe(CircuitState.HalfOpen);
    }

    // Probes exhausted: the breaker now reads the (healthy) rate and closes.
    const request = harness.deliver(processor, 'cb-1', t + 100, 'post-probe');

    expect(processor.getCircuitState()).toBe(CircuitState.Closed);
    expect(request.status).toBe(RequestStatus.InFlight);
    expect(utilizationValue(processor)).toBe(0);
  });

  it('re-opens from HalfOpen when the downstream is still failing', () => {
    const harness = makeHarness();
    const processor = new CircuitBreakerProcessor(BREAKER_CONFIG);
    setDownstream(harness, 'db-1', { processed: 0, dropped: 12 });

    harness.deliver(processor, 'cb-1', 0, 'trip');
    const t = BREAKER_CONFIG.openDurationMs;
    for (let i = 0; i < BREAKER_CONFIG.probeCount; i++) {
      harness.deliver(processor, 'cb-1', t + i, `probe-${i}`);
    }
    expect(processor.getCircuitState()).toBe(CircuitState.HalfOpen);

    const request = harness.deliver(processor, 'cb-1', t + 100, 'post-probe');

    expect(processor.getCircuitState()).toBe(CircuitState.Open);
    expect(request.status).toBe(RequestStatus.Dropped);
  });
});

// ─── API Gateway ─────────────────────────────────────────────────

describe('ApiGatewayProcessor', () => {
  const GATEWAY_CONFIG = { authLatencyMeanMs: 5, authLatencyStdDevMs: 2, rejectionRate: 0.02 };

  it('adds auth latency to the request and records a sample', () => {
    const harness = new Harness({
      edges: { 'gw-1': [edge('gw-1', 'app-1')] },
      randomSequence: [0.9], // above rejectionRate → admitted
    });
    const processor = new ApiGatewayProcessor(GATEWAY_CONFIG);

    const request = harness.deliver(processor, 'gw-1', 0, 'req-0');

    expect(request.status).toBe(RequestStatus.InFlight);
    expect(request.accumulatedLatencyMs).toBe(GATEWAY_CONFIG.authLatencyMeanMs);

    const state = harness.nodeState('gw-1');
    expect(state.totalProcessed).toBe(1);
    expect(state.latencySamples).toEqual([GATEWAY_CONFIG.authLatencyMeanMs]);

    const routes = harness.routesTo('app-1');
    expect(routes).toHaveLength(1);
    expect(routes[0]!.timestamp).toBe(GATEWAY_CONFIG.authLatencyMeanMs);
  });

  it('rejects every request at rejectionRate 1.0', () => {
    const harness = new Harness({ edges: { 'gw-1': [edge('gw-1', 'app-1')] } });
    const processor = new ApiGatewayProcessor({ ...GATEWAY_CONFIG, rejectionRate: 1 });

    for (let i = 0; i < 10; i++) {
      const request = harness.deliver(processor, 'gw-1', i, `req-${i}`);
      expect(request.status).toBe(RequestStatus.Dropped);
    }

    const state = harness.nodeState('gw-1');
    expect(state.totalDropped).toBe(10);
    expect(state.totalProcessed).toBe(10);
    expect(harness.routesTo('app-1')).toHaveLength(0);
    expect(utilizationValue(processor)).toBe(1);
  });

  it('admits every request at rejectionRate 0.0', () => {
    const harness = new Harness({
      edges: { 'gw-1': [edge('gw-1', 'app-1')] },
      randomSequence: [0, 0.001, 0.5, 0.999],
    });
    const processor = new ApiGatewayProcessor({ ...GATEWAY_CONFIG, rejectionRate: 0 });

    for (let i = 0; i < 10; i++) {
      const request = harness.deliver(processor, 'gw-1', i, `req-${i}`);
      expect(request.status).toBe(RequestStatus.InFlight);
    }

    const state = harness.nodeState('gw-1');
    expect(state.totalDropped).toBe(0);
    expect(state.totalProcessed).toBe(10);
    expect(harness.routesTo('app-1')).toHaveLength(10);
    expect(utilizationValue(processor)).toBe(0);
  });

  it('resets window counters so utilization is per-window', () => {
    const harness = new Harness({ edges: { 'gw-1': [edge('gw-1', 'app-1')] } });
    const processor = new ApiGatewayProcessor({ ...GATEWAY_CONFIG, rejectionRate: 1 });

    harness.deliver(processor, 'gw-1', 0, 'req-0');
    expect(utilizationValue(processor)).toBe(1);

    processor.resetWindowCounters();
    expect(utilizationValue(processor)).toBe(0);
  });
});
