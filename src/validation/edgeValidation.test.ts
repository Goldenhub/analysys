import { describe, it, expect } from 'vitest';
import {
  validateEdgeConnection,
  getValidProtocols,
  CONNECTION_RULES,
  PROTOCOL_OVERRIDES,
  type ValidationResult,
} from './edgeValidation';
import {
  NodeType,
  Distribution,
  DatabaseType,
  LBAlgorithm,
  EvictionPolicy,
  BackpressureStrategy,
  VerificationMode,
  RetryBackoff,
  RedriveMode,
  OverlapPolicy,
  RoutingPolicy,
} from '@/types/nodes';
import type { SimulationNode } from '@/types/nodes';
import { EdgeProtocol } from '@/types/edges';
import type { EdgeData } from '@/types/edges';

// ─── Test Helpers ────────────────────────────────────────────────

function makeNode(id: string, nodeType: NodeType): SimulationNode {
  const base = { id, label: id, position: { x: 0, y: 0 }, routingPolicy: RoutingPolicy.First };

  switch (nodeType) {
    case NodeType.TrafficGenerator:
      return { ...base, nodeType, config: { rps: 100, distribution: Distribution.Poisson, spikeMultiplier: 1, spikeDurationSec: 0 } };
    case NodeType.ApiGateway:
      return { ...base, nodeType, config: { authLatencyMeanMs: 5, authLatencyStdDevMs: 2, rejectionRate: 0.02 } };
    case NodeType.RateLimiter:
      return { ...base, nodeType, config: { bucketCapacity: 100, refillRatePerSec: 50 } };
    case NodeType.CircuitBreaker:
      return { ...base, nodeType, config: { errorThreshold: 0.5, openDurationMs: 5000, probeCount: 3 } };
    case NodeType.LoadBalancer:
      return { ...base, nodeType, config: { algorithm: LBAlgorithm.RoundRobin, healthCheckIntervalMs: 5000, evictionThreshold: 3 } };
    case NodeType.AppServer:
      return { ...base, nodeType, config: { workerThreadPoolSize: 10, requestQueueDepth: 100, processingTimeMeanMs: 5, processingTimeStdDevMs: 1 } };
    case NodeType.Cache:
      return { ...base, nodeType, config: { hitRatio: 0.9, evictionPolicy: EvictionPolicy.LRU, accessLatencyMs: 1 } };
    case NodeType.Database:
      return { ...base, nodeType, config: { connectionPoolSize: 20, queryLatencyMeanMs: 10, queryLatencyStdDevMs: 2, lockTimeoutMs: 5000, dbType: DatabaseType.Relational } };
    case NodeType.MessageQueue:
      return { ...base, nodeType, config: { consumerBatchSize: 10, bufferCapacity: 1000, backpressureThresholdPct: 80, backpressureStrategy: BackpressureStrategy.DropOldest } };
    case NodeType.AuthService:
      return { ...base, nodeType, config: { verificationMode: VerificationMode.Local, verificationLatencyMeanMs: 3, verificationLatencyStdDevMs: 1, concurrencyLimit: 64, queueDepth: 100, tokenCacheHitRatio: 0.9, credentialFailureRate: 0.01 } };
    case NodeType.AuthzService:
      return { ...base, nodeType, config: { policyLatencyMeanMs: 4, policyLatencyStdDevMs: 1.5, policyCacheHitRatio: 0.9, lookupsPerRequest: 1, denyRate: 0.01, concurrencyLimit: 64, queueDepth: 100 } };
    case NodeType.WorkerPool:
      return { ...base, nodeType, config: { concurrency: 8, jobProcessingMeanMs: 200, jobProcessingStdDevMs: 50, prefetchBufferDepth: 100, jobFailureRate: 0.02, maxRetries: 3, retryBackoff: RetryBackoff.Exponential, retryBaseDelayMs: 1000, jobTimeoutMs: 30000 } };
    case NodeType.DeadLetterQueue:
      return { ...base, nodeType, config: { capacity: 10000, retentionPeriodMs: 86400000, redriveMode: RedriveMode.Manual, redriveIntervalMs: 60000, redriveBatchSize: 10, maxRedriveAttempts: 3 } };
    case NodeType.ObjectStore:
      return { ...base, nodeType, config: { objectSizeMeanKB: 256, objectSizeStdDevKB: 64, throughputCapacityMBps: 100, baseLatencyMeanMs: 10, baseLatencyStdDevMs: 3, maxConcurrentTransfers: 64, transferQueueDepth: 100, readFraction: 0.8, writeLatencyMultiplier: 1.5 } };
    case NodeType.Scheduler:
      return { ...base, nodeType, config: { intervalMs: 60000, jobsPerTrigger: 50, startOffsetMs: 0, jitterMs: 0, overlapPolicy: OverlapPolicy.Skip, maxDeferredTriggers: 10 } };
  }
}

function makeEdge(
  source: string,
  target: string,
  protocol: EdgeProtocol = EdgeProtocol.Sync,
): EdgeData {
  return { id: `${source}-${target}`, source, target, protocol, weight: 1.0 };
}

/**
 * Calls the validator with the pair's own default protocol and a `nodesById` covering
 * just the endpoints, so a test only has to state what it is actually varying.
 */
function validate(
  source: SimulationNode,
  target: SimulationNode,
  opts: {
    protocol?: EdgeProtocol;
    existingEdges?: EdgeData[];
    nodes?: SimulationNode[];
  } = {},
): ValidationResult {
  const protocol =
    opts.protocol ??
    getValidProtocols(source.nodeType, target.nodeType)[0] ??
    EdgeProtocol.Sync;
  const nodes = opts.nodes ?? [source, target];
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  return validateEdgeConnection(source, target, protocol, opts.existingEdges ?? [], nodesById);
}

// ─── Tests ───────────────────────────────────────────────────────

describe('validateEdgeConnection', () => {
  describe('self-loop rejection', () => {
    it('rejects a self-referencing edge', () => {
      const node = makeNode('app-1', NodeType.AppServer);
      const result = validate(node, node);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Self-referencing');
    });
  });

  describe('duplicate-edge rejection', () => {
    it('rejects a duplicate edge between the same source and target', () => {
      const source = makeNode('gen-1', NodeType.TrafficGenerator);
      const target = makeNode('lb-1', NodeType.LoadBalancer);

      const result = validate(source, target, { existingEdges: [makeEdge('gen-1', 'lb-1')] });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('already exists');
    });

    it('allows the reverse direction of an existing edge', () => {
      const source = makeNode('app-1', NodeType.AppServer);
      const target = makeNode('app-2', NodeType.AppServer);

      const result = validate(source, target, { existingEdges: [makeEdge('app-2', 'app-1')] });
      expect(result.valid).toBe(true);
    });
  });

  describe('valid connections', () => {
    it('allows TrafficGenerator → LoadBalancer', () => {
      const result = validate(
        makeNode('gen-1', NodeType.TrafficGenerator),
        makeNode('lb-1', NodeType.LoadBalancer),
      );
      expect(result.valid).toBe(true);
    });

    it('allows TrafficGenerator → AppServer', () => {
      const result = validate(
        makeNode('gen-1', NodeType.TrafficGenerator),
        makeNode('app-1', NodeType.AppServer),
      );
      expect(result.valid).toBe(true);
    });

    it('allows AppServer → AppServer', () => {
      const result = validate(
        makeNode('app-1', NodeType.AppServer),
        makeNode('app-2', NodeType.AppServer),
      );
      expect(result.valid).toBe(true);
    });

    it('allows AppServer → Database', () => {
      const result = validate(
        makeNode('app-1', NodeType.AppServer),
        makeNode('db-1', NodeType.Database),
      );
      expect(result.valid).toBe(true);
    });

    it('allows Cache → Database', () => {
      const result = validate(
        makeNode('cache-1', NodeType.Cache),
        makeNode('db-1', NodeType.Database),
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('invalid source-target pair', () => {
    it('rejects Database → AppServer (Database is a sink)', () => {
      const result = validate(
        makeNode('db-1', NodeType.Database),
        makeNode('app-1', NodeType.AppServer),
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('cannot connect');
    });

    it('rejects LoadBalancer → Database', () => {
      const result = validate(
        makeNode('lb-1', NodeType.LoadBalancer),
        makeNode('db-1', NodeType.Database),
      );
      expect(result.valid).toBe(false);
    });

    it('rejects Cache → AppServer', () => {
      const result = validate(
        makeNode('cache-1', NodeType.Cache),
        makeNode('app-1', NodeType.AppServer),
      );
      expect(result.valid).toBe(false);
    });

    it('rejects MessageQueue → Database', () => {
      const result = validate(
        makeNode('mq-1', NodeType.MessageQueue),
        makeNode('db-1', NodeType.Database),
      );
      expect(result.valid).toBe(false);
    });
  });

  // ─── Requirement 30 Pair Table ─────────────────────────────────

  describe('Requirement 30 permitted pairs', () => {
    const permitted: [string, NodeType, NodeType][] = [
      // R30.1
      ['TrafficGenerator → AuthService', NodeType.TrafficGenerator, NodeType.AuthService],
      // R30.2
      ['ApiGateway → AuthService', NodeType.ApiGateway, NodeType.AuthService],
      ['ApiGateway → AuthzService', NodeType.ApiGateway, NodeType.AuthzService],
      // R30.3
      ['AuthService → Cache', NodeType.AuthService, NodeType.Cache],
      ['AuthService → Database', NodeType.AuthService, NodeType.Database],
      // R30.4
      ['AuthzService → Cache', NodeType.AuthzService, NodeType.Cache],
      ['AuthzService → Database', NodeType.AuthzService, NodeType.Database],
      // R30.5
      ['AppServer → AuthService', NodeType.AppServer, NodeType.AuthService],
      ['AppServer → AuthzService', NodeType.AppServer, NodeType.AuthzService],
      ['AppServer → ObjectStore', NodeType.AppServer, NodeType.ObjectStore],
      // R30.6
      ['MessageQueue → WorkerPool', NodeType.MessageQueue, NodeType.WorkerPool],
      // R30.7
      ['WorkerPool → Database', NodeType.WorkerPool, NodeType.Database],
      ['WorkerPool → Cache', NodeType.WorkerPool, NodeType.Cache],
      ['WorkerPool → ObjectStore', NodeType.WorkerPool, NodeType.ObjectStore],
      ['WorkerPool → AppServer', NodeType.WorkerPool, NodeType.AppServer],
      ['WorkerPool → MessageQueue', NodeType.WorkerPool, NodeType.MessageQueue],
      ['WorkerPool → DeadLetterQueue', NodeType.WorkerPool, NodeType.DeadLetterQueue],
      // R30.8
      ['Scheduler → MessageQueue', NodeType.Scheduler, NodeType.MessageQueue],
      ['Scheduler → WorkerPool', NodeType.Scheduler, NodeType.WorkerPool],
      ['Scheduler → AppServer', NodeType.Scheduler, NodeType.AppServer],
      ['Scheduler → ApiGateway', NodeType.Scheduler, NodeType.ApiGateway],
      // R30.9
      ['DeadLetterQueue → MessageQueue', NodeType.DeadLetterQueue, NodeType.MessageQueue],
      ['DeadLetterQueue → WorkerPool', NodeType.DeadLetterQueue, NodeType.WorkerPool],
    ];

    for (const [name, sourceType, targetType] of permitted) {
      it(`allows ${name}`, () => {
        const result = validate(makeNode('src', sourceType), makeNode('dst', targetType));
        expect(result.valid).toBe(true);
      });
    }

    // R30.7 — rejected by the pair table alone: WorkerPool is absent from its own
    // allowedTargets, so this needs no special case in the validator.
    it('rejects WorkerPool → WorkerPool', () => {
      const result = validate(
        makeNode('wp-1', NodeType.WorkerPool),
        makeNode('wp-2', NodeType.WorkerPool),
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('cannot connect');
    });

    // R30.3 / R30.4 — Cache and Database are the *complete* target sets.
    it('rejects AuthService → AppServer', () => {
      const result = validate(
        makeNode('auth-1', NodeType.AuthService),
        makeNode('app-1', NodeType.AppServer),
      );
      expect(result.valid).toBe(false);
    });

    it('rejects AuthzService → AuthService', () => {
      const result = validate(
        makeNode('authz-1', NodeType.AuthzService),
        makeNode('auth-1', NodeType.AuthService),
      );
      expect(result.valid).toBe(false);
    });

    // R30.8 — Scheduler's four targets are the complete set.
    it('rejects Scheduler → Database', () => {
      const result = validate(
        makeNode('sched-1', NodeType.Scheduler),
        makeNode('db-1', NodeType.Database),
      );
      expect(result.valid).toBe(false);
    });

    // R30.10 — an Object_Store source is rejected with a message naming it as terminal.
    it('rejects every ObjectStore outgoing edge, naming the type as terminal', () => {
      const result = validate(
        makeNode('obj-1', NodeType.ObjectStore),
        makeNode('db-1', NodeType.Database),
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toBe(
        'OBJECT_STORE is a terminal node type and cannot have outgoing connections.',
      );
    });
  });

  // ─── Requirement 30.13 Protocol Mismatch ───────────────────────

  describe('protocol mismatch', () => {
    it('rejects WorkerPool → Database over Async, naming the permitted protocol', () => {
      const result = validate(
        makeNode('wp-1', NodeType.WorkerPool),
        makeNode('db-1', NodeType.Database),
        { protocol: EdgeProtocol.Async },
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toBe(
        'WORKER_POOL cannot connect to DATABASE over ASYNC. ' +
          'The permitted protocol for this pair is SYNC.',
      );
    });

    it('rejects WorkerPool → MessageQueue over Sync, naming the permitted protocol', () => {
      const result = validate(
        makeNode('wp-1', NodeType.WorkerPool),
        makeNode('mq-1', NodeType.MessageQueue),
        { protocol: EdgeProtocol.Sync },
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toBe(
        'WORKER_POOL cannot connect to MESSAGE_QUEUE over SYNC. ' +
          'The permitted protocol for this pair is ASYNC.',
      );
    });

    it('rejects TrafficGenerator → AuthService over Async even though the source type permits Async', () => {
      const result = validate(
        makeNode('gen-1', NodeType.TrafficGenerator),
        makeNode('auth-1', NodeType.AuthService),
        { protocol: EdgeProtocol.Async },
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('ASYNC');
    });

    it('accepts a pair at its permitted protocol', () => {
      const result = validate(
        makeNode('sched-1', NodeType.Scheduler),
        makeNode('mq-1', NodeType.MessageQueue),
        { protocol: EdgeProtocol.Async },
      );
      expect(result.valid).toBe(true);
    });
  });

  // ─── Requirement 30.11 Worker_Pool → DLQ Cardinality ───────────

  describe('Worker_Pool → Dead_Letter_Queue cardinality', () => {
    it('allows the first outgoing DLQ edge from a Worker_Pool', () => {
      const pool = makeNode('wp-1', NodeType.WorkerPool);
      const dlq = makeNode('dlq-1', NodeType.DeadLetterQueue);
      const result = validate(pool, dlq, { protocol: EdgeProtocol.Async });
      expect(result.valid).toBe(true);
    });

    it('rejects a second DLQ edge, naming the pool and the DLQ it already targets', () => {
      const pool = makeNode('wp-1', NodeType.WorkerPool);
      const held = makeNode('dlq-1', NodeType.DeadLetterQueue);
      const attempted = makeNode('dlq-2', NodeType.DeadLetterQueue);

      const result = validate(pool, attempted, {
        protocol: EdgeProtocol.Async,
        existingEdges: [makeEdge('wp-1', 'dlq-1', EdgeProtocol.Async)],
        nodes: [pool, held, attempted],
      });

      expect(result.valid).toBe(false);
      expect(result.reason).toBe(
        'wp-1 already has a dead letter queue connection to dlq-1. ' +
          'A Worker Pool may have at most one outgoing Dead Letter Queue edge.',
      );
    });

    it('permits two distinct Worker_Pools to target the same Dead_Letter_Queue', () => {
      const poolA = makeNode('wp-1', NodeType.WorkerPool);
      const poolB = makeNode('wp-2', NodeType.WorkerPool);
      const dlq = makeNode('dlq-1', NodeType.DeadLetterQueue);

      const result = validate(poolB, dlq, {
        protocol: EdgeProtocol.Async,
        existingEdges: [makeEdge('wp-1', 'dlq-1', EdgeProtocol.Async)],
        nodes: [poolA, poolB, dlq],
      });

      expect(result.valid).toBe(true);
    });

    it('does not count a Worker_Pool\u2019s non-DLQ edges against the limit', () => {
      const pool = makeNode('wp-1', NodeType.WorkerPool);
      const db = makeNode('db-1', NodeType.Database);
      const dlq = makeNode('dlq-1', NodeType.DeadLetterQueue);

      const result = validate(pool, dlq, {
        protocol: EdgeProtocol.Async,
        existingEdges: [makeEdge('wp-1', 'db-1')],
        nodes: [pool, db, dlq],
      });

      expect(result.valid).toBe(true);
    });
  });
});

describe('getValidProtocols', () => {
  it('returns Sync and Async for TrafficGenerator → AppServer', () => {
    const protocols = getValidProtocols(NodeType.TrafficGenerator, NodeType.AppServer);
    expect(protocols).toContain(EdgeProtocol.Sync);
    expect(protocols).toContain(EdgeProtocol.Async);
  });

  it('returns only Sync for LoadBalancer → AppServer', () => {
    const protocols = getValidProtocols(NodeType.LoadBalancer, NodeType.AppServer);
    expect(protocols).toEqual([EdgeProtocol.Sync]);
  });

  it('returns only Async for MessageQueue → AppServer', () => {
    const protocols = getValidProtocols(NodeType.MessageQueue, NodeType.AppServer);
    expect(protocols).toEqual([EdgeProtocol.Async]);
  });

  it('returns empty array for invalid connection', () => {
    const protocols = getValidProtocols(NodeType.Database, NodeType.AppServer);
    expect(protocols).toEqual([]);
  });

  // R30.7 / R30.8 — the override table narrows a source type that permits both protocols
  // down to one per pair, which the flat allowedProtocols shape cannot express.
  it('narrows WorkerPool → Database to Sync and WorkerPool → MessageQueue to Async', () => {
    expect(CONNECTION_RULES[NodeType.WorkerPool].allowedProtocols).toEqual([
      EdgeProtocol.Sync,
      EdgeProtocol.Async,
    ]);
    expect(getValidProtocols(NodeType.WorkerPool, NodeType.Database)).toEqual([EdgeProtocol.Sync]);
    expect(getValidProtocols(NodeType.WorkerPool, NodeType.MessageQueue)).toEqual([EdgeProtocol.Async]);
    expect(getValidProtocols(NodeType.WorkerPool, NodeType.DeadLetterQueue)).toEqual([EdgeProtocol.Async]);
  });

  it('narrows Scheduler per pair the same way', () => {
    expect(getValidProtocols(NodeType.Scheduler, NodeType.MessageQueue)).toEqual([EdgeProtocol.Async]);
    expect(getValidProtocols(NodeType.Scheduler, NodeType.WorkerPool)).toEqual([EdgeProtocol.Async]);
    expect(getValidProtocols(NodeType.Scheduler, NodeType.AppServer)).toEqual([EdgeProtocol.Sync]);
    expect(getValidProtocols(NodeType.Scheduler, NodeType.ApiGateway)).toEqual([EdgeProtocol.Sync]);
  });

  it('narrows TrafficGenerator → AuthService to Sync', () => {
    expect(getValidProtocols(NodeType.TrafficGenerator, NodeType.AuthService)).toEqual([
      EdgeProtocol.Sync,
    ]);
  });

  it('falls back to the source type\u2019s flat set for a pair no override narrows', () => {
    expect(getValidProtocols(NodeType.AppServer, NodeType.Database)).toEqual(
      CONNECTION_RULES[NodeType.AppServer].allowedProtocols,
    );
  });

  it('returns an empty array for an override on a pair the table denies', () => {
    // A stale override must not resurrect a denied pair: the pair table is consulted first.
    expect(getValidProtocols(NodeType.ObjectStore, NodeType.Database)).toEqual([]);
  });
});

describe('CONNECTION_RULES', () => {
  it('defines rules for all node types', () => {
    for (const nodeType of Object.values(NodeType)) {
      expect(CONNECTION_RULES[nodeType]).toBeDefined();
      expect(CONNECTION_RULES[nodeType].allowedTargets).toBeInstanceOf(Array);
      expect(CONNECTION_RULES[nodeType].allowedProtocols).toBeInstanceOf(Array);
    }
  });

  it('Database has no allowed targets (sink node)', () => {
    expect(CONNECTION_RULES[NodeType.Database].allowedTargets).toHaveLength(0);
    expect(CONNECTION_RULES[NodeType.Database].allowedProtocols).toHaveLength(0);
  });

  it('ObjectStore has no allowed targets (terminal node, R30.10)', () => {
    expect(CONNECTION_RULES[NodeType.ObjectStore].allowedTargets).toHaveLength(0);
    expect(CONNECTION_RULES[NodeType.ObjectStore].allowedProtocols).toHaveLength(0);
  });
});

describe('PROTOCOL_OVERRIDES', () => {
  it('names only pairs the connection rules already permit', () => {
    for (const key of Object.keys(PROTOCOL_OVERRIDES)) {
      const [sourceType, targetType] = key.split('->') as [NodeType, NodeType];
      expect(CONNECTION_RULES[sourceType].allowedTargets).toContain(targetType);
    }
  });

  it('pins exactly one protocol per pair it covers', () => {
    for (const protocols of Object.values(PROTOCOL_OVERRIDES)) {
      expect(protocols).toHaveLength(1);
    }
  });
});
