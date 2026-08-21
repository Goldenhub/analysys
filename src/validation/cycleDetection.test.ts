import { describe, it, expect } from 'vitest';
import { detectCycles } from './cycleDetection';
import { NodeType, Distribution, DatabaseType, LBAlgorithm, EvictionPolicy } from '@/types/nodes';
import type { SimulationNode } from '@/types/nodes';
import { EdgeProtocol } from '@/types/edges';
import type { EdgeData } from '@/types/edges';

// ─── Test Helpers ────────────────────────────────────────────────

function makeAppServer(id: string): SimulationNode {
  return {
    id,
    nodeType: NodeType.AppServer,
    label: id,
    position: { x: 0, y: 0 },
    config: { workerThreadPoolSize: 10, requestQueueDepth: 100, processingTimeMeanMs: 5, processingTimeStdDevMs: 1 },
  };
}

function makeEdge(source: string, target: string): EdgeData {
  return { id: `${source}->${target}`, source, target, protocol: EdgeProtocol.Sync };
}

// ─── Tests ───────────────────────────────────────────────────────

describe('detectCycles', () => {
  describe('acyclic graph', () => {
    it('returns empty array for a linear chain', () => {
      const nodes = [makeAppServer('a'), makeAppServer('b'), makeAppServer('c')];
      const edges = [makeEdge('a', 'b'), makeEdge('b', 'c')];

      const cycles = detectCycles(nodes, edges);
      expect(cycles).toEqual([]);
    });

    it('returns empty array for a DAG (diamond shape)', () => {
      const nodes = [makeAppServer('a'), makeAppServer('b'), makeAppServer('c'), makeAppServer('d')];
      const edges = [
        makeEdge('a', 'b'),
        makeEdge('a', 'c'),
        makeEdge('b', 'd'),
        makeEdge('c', 'd'),
      ];

      const cycles = detectCycles(nodes, edges);
      expect(cycles).toEqual([]);
    });

    it('returns empty array for single node with no edges', () => {
      const nodes = [makeAppServer('solo')];
      const cycles = detectCycles(nodes, []);
      expect(cycles).toEqual([]);
    });
  });

  describe('simple cycle', () => {
    it('detects a two-node cycle (A→B→A)', () => {
      const nodes = [makeAppServer('a'), makeAppServer('b')];
      const edges = [makeEdge('a', 'b'), makeEdge('b', 'a')];

      const cycles = detectCycles(nodes, edges);
      expect(cycles.length).toBeGreaterThanOrEqual(1);
      // The cycle should contain both nodes
      const cycle = cycles[0]!;
      expect(cycle).toContain('a');
      expect(cycle).toContain('b');
    });

    it('detects a three-node cycle (A→B→C→A)', () => {
      const nodes = [makeAppServer('a'), makeAppServer('b'), makeAppServer('c')];
      const edges = [makeEdge('a', 'b'), makeEdge('b', 'c'), makeEdge('c', 'a')];

      const cycles = detectCycles(nodes, edges);
      expect(cycles.length).toBeGreaterThanOrEqual(1);
      const cycle = cycles[0]!;
      expect(cycle).toContain('a');
      expect(cycle).toContain('b');
      expect(cycle).toContain('c');
    });
  });

  describe('multi-cycle', () => {
    it('detects multiple independent cycles', () => {
      const nodes = [
        makeAppServer('a'), makeAppServer('b'),
        makeAppServer('c'), makeAppServer('d'),
      ];
      const edges = [
        // Cycle 1: a → b → a
        makeEdge('a', 'b'), makeEdge('b', 'a'),
        // Cycle 2: c → d → c
        makeEdge('c', 'd'), makeEdge('d', 'c'),
      ];

      const cycles = detectCycles(nodes, edges);
      expect(cycles.length).toBeGreaterThanOrEqual(2);
    });

    it('detects cycles in a complex graph with shared nodes', () => {
      // a → b → c → a (cycle) and b → d → b (another cycle through b)
      const nodes = [makeAppServer('a'), makeAppServer('b'), makeAppServer('c'), makeAppServer('d')];
      const edges = [
        makeEdge('a', 'b'),
        makeEdge('b', 'c'),
        makeEdge('c', 'a'),
        makeEdge('b', 'd'),
        makeEdge('d', 'b'),
      ];

      const cycles = detectCycles(nodes, edges);
      expect(cycles.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('disconnected components', () => {
    it('finds cycle in one component while other is acyclic', () => {
      const nodes = [
        makeAppServer('a'), makeAppServer('b'), makeAppServer('c'), // Component 1: a→b→c (no cycle)
        makeAppServer('x'), makeAppServer('y'),                     // Component 2: x→y→x (cycle)
      ];
      const edges = [
        makeEdge('a', 'b'), makeEdge('b', 'c'),
        makeEdge('x', 'y'), makeEdge('y', 'x'),
      ];

      const cycles = detectCycles(nodes, edges);
      expect(cycles.length).toBeGreaterThanOrEqual(1);
      // The cycle should involve x and y, not a/b/c
      const allCycleNodes = cycles.flat();
      expect(allCycleNodes).toContain('x');
      expect(allCycleNodes).toContain('y');
    });

    it('returns empty for multiple disconnected acyclic components', () => {
      const nodes = [
        makeAppServer('a'), makeAppServer('b'),
        makeAppServer('c'), makeAppServer('d'),
      ];
      const edges = [makeEdge('a', 'b'), makeEdge('c', 'd')];

      const cycles = detectCycles(nodes, edges);
      expect(cycles).toEqual([]);
    });
  });
});
