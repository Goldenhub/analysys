import { describe, it, expect, beforeEach } from 'vitest';
import { useTopologyStore } from './topologyStore';
import { NodeType } from '../types/nodes';
import { EdgeProtocol } from '../types/edges';
import type { AnalysysNode } from '../types/nodes';
import type { AnalysysEdge } from '../types/edges';

// ─── Test Helpers ────────────────────────────────────────────────

function createTestNode(id: string, overrides?: Partial<AnalysysNode>): AnalysysNode {
  return {
    id,
    type: 'default',
    position: { x: 100, y: 200 },
    data: {
      id,
      nodeType: NodeType.AppServer,
      label: `Node ${id}`,
      position: { x: 100, y: 200 },
      config: {
        workerThreadPoolSize: 10,
        requestQueueDepth: 100,
        processingTimeMeanMs: 50,
        processingTimeStdDevMs: 10,
      },
    },
    ...overrides,
  } as AnalysysNode;
}

function createTestEdge(id: string, source: string, target: string): AnalysysEdge {
  return {
    id,
    source,
    target,
    data: {
      id,
      source,
      target,
      protocol: EdgeProtocol.Sync,
    },
  } as AnalysysEdge;
}

// ─── Tests ───────────────────────────────────────────────────────

describe('topologyStore', () => {
  beforeEach(() => {
    useTopologyStore.setState({ nodes: [], edges: [], past: [], future: [] });
  });

  describe('initial state', () => {
    it('starts with empty nodes and edges', () => {
      const { nodes, edges } = useTopologyStore.getState();
      expect(nodes).toEqual([]);
      expect(edges).toEqual([]);
    });

    it('starts with empty history', () => {
      const { past, future } = useTopologyStore.getState();
      expect(past).toEqual([]);
      expect(future).toEqual([]);
    });
  });

  describe('addNode', () => {
    it('adds a node to the store', () => {
      const node = createTestNode('node-1');
      useTopologyStore.getState().addNode(node);

      const { nodes } = useTopologyStore.getState();
      expect(nodes).toHaveLength(1);
      expect(nodes[0].id).toBe('node-1');
    });

    it('pushes to undo history', () => {
      const node = createTestNode('node-1');
      useTopologyStore.getState().addNode(node);

      const { past } = useTopologyStore.getState();
      expect(past).toHaveLength(1);
      expect(past[0].nodes).toEqual([]);
    });
  });

  describe('removeNode', () => {
    it('removes a node by id', () => {
      const node = createTestNode('node-1');
      useTopologyStore.setState({ nodes: [node], edges: [], past: [], future: [] });

      useTopologyStore.getState().removeNode('node-1');

      const { nodes } = useTopologyStore.getState();
      expect(nodes).toHaveLength(0);
    });

    it('removes connected edges when a node is removed', () => {
      const nodeA = createTestNode('a');
      const nodeB = createTestNode('b');
      const edge = createTestEdge('e1', 'a', 'b');
      useTopologyStore.setState({ nodes: [nodeA, nodeB], edges: [edge], past: [], future: [] });

      useTopologyStore.getState().removeNode('a');

      const { edges } = useTopologyStore.getState();
      expect(edges).toHaveLength(0);
    });

    it('does not remove edges unrelated to the removed node', () => {
      const nodeA = createTestNode('a');
      const nodeB = createTestNode('b');
      const nodeC = createTestNode('c');
      const edge = createTestEdge('e1', 'b', 'c');
      useTopologyStore.setState({ nodes: [nodeA, nodeB, nodeC], edges: [edge], past: [], future: [] });

      useTopologyStore.getState().removeNode('a');

      const { edges } = useTopologyStore.getState();
      expect(edges).toHaveLength(1);
    });
  });

  describe('updateNodePosition', () => {
    it('updates position on both the RFNode and the data', () => {
      const node = createTestNode('node-1');
      useTopologyStore.setState({ nodes: [node], edges: [], past: [], future: [] });

      useTopologyStore.getState().updateNodePosition('node-1', { x: 300, y: 400 });

      const { nodes } = useTopologyStore.getState();
      expect(nodes[0].position).toEqual({ x: 300, y: 400 });
      expect(nodes[0].data.position).toEqual({ x: 300, y: 400 });
    });
  });

  describe('updateNodeConfig', () => {
    it('merges new config fields into existing config', () => {
      const node = createTestNode('node-1');
      useTopologyStore.setState({ nodes: [node], edges: [], past: [], future: [] });

      useTopologyStore.getState().updateNodeConfig('node-1', { workerThreadPoolSize: 50 });

      const { nodes } = useTopologyStore.getState();
      const data = nodes[0].data as { config: { workerThreadPoolSize: number; requestQueueDepth: number } };
      expect(data.config.workerThreadPoolSize).toBe(50);
      expect(data.config.requestQueueDepth).toBe(100); // unchanged
    });
  });

  describe('addEdge', () => {
    it('adds an edge to the store', () => {
      const edge = createTestEdge('e1', 'a', 'b');
      useTopologyStore.getState().addEdge(edge);

      const { edges } = useTopologyStore.getState();
      expect(edges).toHaveLength(1);
      expect(edges[0].id).toBe('e1');
    });
  });

  describe('removeEdge', () => {
    it('removes an edge by id', () => {
      const edge = createTestEdge('e1', 'a', 'b');
      useTopologyStore.setState({ nodes: [], edges: [edge], past: [], future: [] });

      useTopologyStore.getState().removeEdge('e1');

      const { edges } = useTopologyStore.getState();
      expect(edges).toHaveLength(0);
    });
  });

  describe('updateEdgeProtocol', () => {
    it('updates the protocol of an edge', () => {
      const edge = createTestEdge('e1', 'a', 'b');
      useTopologyStore.setState({ nodes: [], edges: [edge], past: [], future: [] });

      useTopologyStore.getState().updateEdgeProtocol('e1', EdgeProtocol.Async);

      const { edges } = useTopologyStore.getState();
      expect(edges[0].data!.protocol).toBe(EdgeProtocol.Async);
    });
  });

  describe('undo / redo', () => {
    it('undo restores previous state', () => {
      const node = createTestNode('node-1');
      useTopologyStore.getState().addNode(node);
      expect(useTopologyStore.getState().nodes).toHaveLength(1);

      useTopologyStore.getState().undo();
      expect(useTopologyStore.getState().nodes).toHaveLength(0);
    });

    it('redo restores undone state', () => {
      const node = createTestNode('node-1');
      useTopologyStore.getState().addNode(node);
      useTopologyStore.getState().undo();
      expect(useTopologyStore.getState().nodes).toHaveLength(0);

      useTopologyStore.getState().redo();
      expect(useTopologyStore.getState().nodes).toHaveLength(1);
    });

    it('undo is a no-op when history is empty', () => {
      useTopologyStore.getState().undo();
      const { nodes, edges, past, future } = useTopologyStore.getState();
      expect(nodes).toEqual([]);
      expect(edges).toEqual([]);
      expect(past).toEqual([]);
      expect(future).toEqual([]);
    });

    it('redo is a no-op when future is empty', () => {
      const node = createTestNode('node-1');
      useTopologyStore.getState().addNode(node);
      useTopologyStore.getState().redo();
      expect(useTopologyStore.getState().nodes).toHaveLength(1);
    });

    it('new action clears future stack', () => {
      const node1 = createTestNode('node-1');
      const node2 = createTestNode('node-2');
      useTopologyStore.getState().addNode(node1);
      useTopologyStore.getState().undo();
      expect(useTopologyStore.getState().future).toHaveLength(1);

      useTopologyStore.getState().addNode(node2);
      expect(useTopologyStore.getState().future).toHaveLength(0);
    });

    it('supports multiple undo/redo steps', () => {
      const node1 = createTestNode('node-1');
      const node2 = createTestNode('node-2');
      useTopologyStore.getState().addNode(node1);
      useTopologyStore.getState().addNode(node2);

      expect(useTopologyStore.getState().nodes).toHaveLength(2);
      useTopologyStore.getState().undo();
      expect(useTopologyStore.getState().nodes).toHaveLength(1);
      useTopologyStore.getState().undo();
      expect(useTopologyStore.getState().nodes).toHaveLength(0);

      useTopologyStore.getState().redo();
      expect(useTopologyStore.getState().nodes).toHaveLength(1);
      useTopologyStore.getState().redo();
      expect(useTopologyStore.getState().nodes).toHaveLength(2);
    });
  });

  describe('getTopologySnapshot', () => {
    it('returns serialized nodes and edges for Worker INIT', () => {
      const node = createTestNode('node-1');
      const edge = createTestEdge('e1', 'node-1', 'node-2');
      useTopologyStore.setState({ nodes: [node], edges: [edge], past: [], future: [] });

      const snapshot = useTopologyStore.getState().getTopologySnapshot();

      expect(snapshot.nodes).toHaveLength(1);
      expect(snapshot.nodes[0].id).toBe('node-1');
      expect(snapshot.nodes[0].nodeType).toBe(NodeType.AppServer);
      expect(snapshot.edges).toHaveLength(1);
      expect(snapshot.edges[0].protocol).toBe(EdgeProtocol.Sync);
    });
  });

  describe('loadTopology', () => {
    it('bulk-replaces nodes and edges', () => {
      const oldNode = createTestNode('old');
      useTopologyStore.setState({ nodes: [oldNode], edges: [], past: [], future: [] });

      const newNodes = [createTestNode('new-1'), createTestNode('new-2')];
      const newEdges = [createTestEdge('e1', 'new-1', 'new-2')];
      useTopologyStore.getState().loadTopology(newNodes, newEdges);

      const { nodes, edges } = useTopologyStore.getState();
      expect(nodes).toHaveLength(2);
      expect(nodes[0].id).toBe('new-1');
      expect(edges).toHaveLength(1);
    });

    it('pushes previous state to undo history', () => {
      const oldNode = createTestNode('old');
      useTopologyStore.setState({ nodes: [oldNode], edges: [], past: [], future: [] });

      const newNodes = [createTestNode('new-1')];
      useTopologyStore.getState().loadTopology(newNodes, []);

      const { past } = useTopologyStore.getState();
      expect(past).toHaveLength(1);
      expect(past[0].nodes[0].id).toBe('old');
    });
  });

  describe('onNodesChange / onEdgesChange (React Flow)', () => {
    it('onNodesChange applies position changes', () => {
      const node = createTestNode('node-1');
      useTopologyStore.setState({ nodes: [node], edges: [], past: [], future: [] });

      useTopologyStore.getState().onNodesChange([
        { type: 'position', id: 'node-1', position: { x: 500, y: 600 } },
      ]);

      const { nodes } = useTopologyStore.getState();
      expect(nodes[0].position).toEqual({ x: 500, y: 600 });
    });

    it('onEdgesChange applies removal changes', () => {
      const edge = createTestEdge('e1', 'a', 'b');
      useTopologyStore.setState({ nodes: [], edges: [edge], past: [], future: [] });

      useTopologyStore.getState().onEdgesChange([{ type: 'remove', id: 'e1' }]);

      const { edges } = useTopologyStore.getState();
      expect(edges).toHaveLength(0);
    });
  });
});
