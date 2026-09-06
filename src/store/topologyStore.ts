import { create } from 'zustand';
import { applyNodeChanges, applyEdgeChanges } from '../canvas/changes';
import type { CanvasNodeChange, CanvasEdgeChange } from '../canvas/types';
import type { AnalysysNode, SimulationNode } from '../types/nodes';
import type { RoutingPolicy } from '../types/nodes';
import type { AnalysysEdge, EdgeData, EdgeProtocol } from '../types/edges';

// ─── History Snapshot ────────────────────────────────────────────

interface TopologySnapshot {
  nodes: AnalysysNode[];
  edges: AnalysysEdge[];
}

// ─── Store State ─────────────────────────────────────────────────

interface TopologyState {
  nodes: AnalysysNode[];
  edges: AnalysysEdge[];

  // Undo/Redo
  past: TopologySnapshot[];
  future: TopologySnapshot[];
}

// ─── Store Actions ───────────────────────────────────────────────

interface TopologyActions {
  // Node CRUD
  addNode: (node: AnalysysNode) => void;
  removeNode: (nodeId: string) => void;
  updateNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  updateNodeConfig: (nodeId: string, config: Record<string, unknown>) => void;
  /** Inline edit of a node's data (label, text, etc.). */
  updateNodeEdit: (nodeId: string, patch: Record<string, unknown>) => void;

  // Edge CRUD
  addEdge: (edge: AnalysysEdge) => void;
  removeEdge: (edgeId: string) => void;
  updateEdgeProtocol: (edgeId: string, protocol: EdgeProtocol) => void;
  updateEdgeWeight: (edgeId: string, weight: number) => void;
  updateNodeRoutingPolicy: (nodeId: string, policy: RoutingPolicy) => void;

  // Canvas compatibility handlers
  onNodesChange: (changes: CanvasNodeChange[]) => void;
  onEdgesChange: (changes: CanvasEdgeChange[]) => void;

  // Undo/Redo
  undo: () => void;
  redo: () => void;

  // Serialization
  getTopologySnapshot: () => { nodes: SimulationNode[]; edges: EdgeData[] };
  loadTopology: (nodes: AnalysysNode[], edges: AnalysysEdge[]) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────

const MAX_HISTORY_SIZE = 50;

function takeSnapshot(state: TopologyState): TopologySnapshot {
  return {
    nodes: structuredClone(state.nodes),
    edges: structuredClone(state.edges),
  };
}

function pushHistory(state: TopologyState): Pick<TopologyState, 'past' | 'future'> {
  const snapshot = takeSnapshot(state);
  const past = [...state.past, snapshot].slice(-MAX_HISTORY_SIZE);
  return { past, future: [] };
}

/** True if the node payload is a simulation node (has nodeType), not a visual node. */
function isSimulationData(data: AnalysysNode['data']): data is SimulationNode {
  return 'nodeType' in data;
}

// ─── Store ───────────────────────────────────────────────────────

export const useTopologyStore = create<TopologyState & TopologyActions>()((set, get) => ({
  nodes: [],
  edges: [],
  past: [],
  future: [],

  // ─── Node Actions ────────────────────────────────────────────

  addNode: (node) =>
    set((state) => ({
      ...pushHistory(state),
      nodes: [...state.nodes, node],
    })),

  removeNode: (nodeId) =>
    set((state) => {
      const history = pushHistory(state);
      const nodes = state.nodes.filter((n) => n.id !== nodeId);
      const edges = state.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
      return { ...history, nodes, edges };
    }),

  updateNodePosition: (nodeId, position) =>
    set((state) => ({
      ...pushHistory(state),
      nodes: state.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, position, data: { ...n.data, position } }
          : n,
      ),
    })),

  updateNodeConfig: (nodeId, config) =>
    set((state) => ({
      ...pushHistory(state),
      nodes: state.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        const currentData = n.data as SimulationNode;
        const updatedData = {
          ...currentData,
          config: { ...currentData.config, ...config },
        };
        return { ...n, data: updatedData as AnalysysNode['data'] };
      }),
    })),

  updateNodeEdit: (nodeId, patch) =>
    set((state) => ({
      ...pushHistory(state),
      nodes: state.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        const data = { ...(n.data as unknown as Record<string, unknown>), ...patch } as unknown as AnalysysNode['data'];
        const next: AnalysysNode = { ...n, data };
        // Visual nodes keep their live size mirrored at the node level so bounds
        // math (fit-view, snapshots, persistence) tracks inline resizes.
        if (typeof patch.width === 'number') next.width = patch.width;
        if (typeof patch.height === 'number') next.height = patch.height;
        return next;
      }),
    })),

  // ─── Edge Actions ────────────────────────────────────────────

  addEdge: (edge) =>
    set((state) => ({
      ...pushHistory(state),
      // R32.4 — an edge arriving without a weight (an older caller, or a v1 payload)
      // gets an equal share, so the Weighted policy never sees an undefined weight.
      edges: [
        ...state.edges,
        { id: edge.id, source: edge.source, target: edge.target, type: edge.type, data: { ...edge.data, weight: edge.data.weight ?? 1.0 } },
      ],
    })),

  removeEdge: (edgeId) =>
    set((state) => ({
      ...pushHistory(state),
      edges: state.edges.filter((e) => e.id !== edgeId),
    })),

  updateEdgeProtocol: (edgeId, protocol) =>
    set((state) => ({
      ...pushHistory(state),
      edges: state.edges.map((e) =>
        e.id === edgeId ? { ...e, data: { ...e.data, protocol } } : e,
      ),
    })),

  updateEdgeWeight: (edgeId, weight) =>
    set((state) => ({
      ...pushHistory(state),
      edges: state.edges.map((e) => (e.id === edgeId ? { ...e, data: { ...e.data, weight } } : e)),
    })),

  updateNodeRoutingPolicy: (nodeId, policy) =>
    set((state) => ({
      ...pushHistory(state),
      nodes: state.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        const currentData = n.data as SimulationNode;
        const updatedData = { ...currentData, routingPolicy: policy };
        return { ...n, data: updatedData as AnalysysNode['data'] };
      }),
    })),

  // ─── Canvas Handlers ─────────────────────────────────────────

  onNodesChange: (changes) =>
    set((state) => ({
      nodes: applyNodeChanges(changes, state.nodes),
    })),

  onEdgesChange: (changes) =>
    set((state) => ({
      edges: applyEdgeChanges(changes, state.edges),
    })),

  // ─── Undo / Redo ─────────────────────────────────────────────

  undo: () =>
    set((state) => {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      const currentSnapshot = takeSnapshot(state);
      return {
        nodes: previous.nodes,
        edges: previous.edges,
        past: state.past.slice(0, -1),
        future: [currentSnapshot, ...state.future].slice(0, MAX_HISTORY_SIZE),
      };
    }),

  redo: () =>
    set((state) => {
      const next = state.future[0];
      if (!next) return state;
      const currentSnapshot = takeSnapshot(state);
      return {
        nodes: next.nodes,
        edges: next.edges,
        past: [...state.past, currentSnapshot].slice(-MAX_HISTORY_SIZE),
        future: state.future.slice(1),
      };
    }),

  // ─── Serialization ───────────────────────────────────────────

  getTopologySnapshot: () => {
    const { nodes, edges } = get();
    // Simulation engine only consumes processing nodes — visual nodes are excluded.
    const simulationNodes: SimulationNode[] = nodes
      .map((n) => n.data)
      .filter(isSimulationData);
    const edgeData: EdgeData[] = edges.map((e) => e.data);
    return { nodes: simulationNodes, edges: edgeData };
  },

  loadTopology: (nodes, edges) =>
    set((state) => ({
      ...pushHistory(state),
      nodes,
      edges,
    })),
}));
