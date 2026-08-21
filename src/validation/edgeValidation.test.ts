import { describe, it, expect } from 'vitest';
import { validateEdgeConnection, getValidProtocols, CONNECTION_RULES } from './edgeValidation';
import { NodeType, Distribution, DatabaseType, LBAlgorithm, EvictionPolicy, BackpressureStrategy } from '@/types/nodes';
import type { SimulationNode } from '@/types/nodes';
import { EdgeProtocol } from '@/types/edges';
import type { EdgeData } from '@/types/edges';

// ─── Test Helpers ────────────────────────────────────────────────

function makeNode(id: string, nodeType: NodeType): SimulationNode {
  const base = { id, label: id, position: { x: 0, y: 0 } };

  switch (nodeType) {
    case NodeType.TrafficGenerator:
      return { ...base, nodeType, config: { rps: 100, distribution: Distribution.Poisson, spikeMultiplier: 1, spikeDurationSec: 0 } };
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
  }
}

function makeEdge(source: string, target: string): EdgeData {
  return { id: `${source}-${target}`, source, target, protocol: EdgeProtocol.Sync };
}

// ─── Tests ───────────────────────────────────────────────────────

describe('validateEdgeConnection', () => {
  describe('self-loop rejection', () => {
    it('rejects a self-referencing edge', () => {
      const node = makeNode('app-1', NodeType.AppServer);
      const result = validateEdgeConnection(node, node, []);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Self-referencing');
    });
  });

  describe('duplicate-edge rejection', () => {
    it('rejects a duplicate edge between the same source and target', () => {
      const source = makeNode('gen-1', NodeType.TrafficGenerator);
      const target = makeNode('lb-1', NodeType.LoadBalancer);
      const existing: EdgeData[] = [makeEdge('gen-1', 'lb-1')];

      const result = validateEdgeConnection(source, target, existing);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('already exists');
    });

    it('allows the reverse direction of an existing edge', () => {
      const source = makeNode('app-1', NodeType.AppServer);
      const target = makeNode('app-2', NodeType.AppServer);
      const existing: EdgeData[] = [makeEdge('app-2', 'app-1')];

      const result = validateEdgeConnection(source, target, existing);
      expect(result.valid).toBe(true);
    });
  });

  describe('valid connections', () => {
    it('allows TrafficGenerator → LoadBalancer', () => {
      const source = makeNode('gen-1', NodeType.TrafficGenerator);
      const target = makeNode('lb-1', NodeType.LoadBalancer);
      const result = validateEdgeConnection(source, target, []);
      expect(result.valid).toBe(true);
    });

    it('allows TrafficGenerator → AppServer', () => {
      const source = makeNode('gen-1', NodeType.TrafficGenerator);
      const target = makeNode('app-1', NodeType.AppServer);
      const result = validateEdgeConnection(source, target, []);
      expect(result.valid).toBe(true);
    });

    it('allows AppServer → AppServer', () => {
      const source = makeNode('app-1', NodeType.AppServer);
      const target = makeNode('app-2', NodeType.AppServer);
      const result = validateEdgeConnection(source, target, []);
      expect(result.valid).toBe(true);
    });

    it('allows AppServer → Database', () => {
      const source = makeNode('app-1', NodeType.AppServer);
      const target = makeNode('db-1', NodeType.Database);
      const result = validateEdgeConnection(source, target, []);
      expect(result.valid).toBe(true);
    });

    it('allows Cache → Database', () => {
      const source = makeNode('cache-1', NodeType.Cache);
      const target = makeNode('db-1', NodeType.Database);
      const result = validateEdgeConnection(source, target, []);
      expect(result.valid).toBe(true);
    });
  });

  describe('invalid source-target pair', () => {
    it('rejects Database → AppServer (Database is a sink)', () => {
      const source = makeNode('db-1', NodeType.Database);
      const target = makeNode('app-1', NodeType.AppServer);
      const result = validateEdgeConnection(source, target, []);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('cannot connect');
    });

    it('rejects LoadBalancer → Database', () => {
      const source = makeNode('lb-1', NodeType.LoadBalancer);
      const target = makeNode('db-1', NodeType.Database);
      const result = validateEdgeConnection(source, target, []);
      expect(result.valid).toBe(false);
    });

    it('rejects Cache → AppServer', () => {
      const source = makeNode('cache-1', NodeType.Cache);
      const target = makeNode('app-1', NodeType.AppServer);
      const result = validateEdgeConnection(source, target, []);
      expect(result.valid).toBe(false);
    });

    it('rejects MessageQueue → Database', () => {
      const source = makeNode('mq-1', NodeType.MessageQueue);
      const target = makeNode('db-1', NodeType.Database);
      const result = validateEdgeConnection(source, target, []);
      expect(result.valid).toBe(false);
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
});
