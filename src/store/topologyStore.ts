import { create } from 'zustand';
import {
  applyNodeChanges,
  applyEdgeChanges,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
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

  // Edge CRUD
  addEdge: (edge: AnalysysEdge) => void;
  removeEdge: (edgeId: string) => void;
  updateEdgeProtocol: (edgeId: string, protocol: EdgeProtocol) => void;
  updateEdgeWeight: (edgeId: string, weight: number) => void;
  updateNodeRoutingPolicy: (nodeId: string, policy: RoutingPolicy) => void;

  // React Flow compatibility handlers
  onNodesChange: (changes: NodeChange<AnalysysNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<AnalysysEdge>[]) => void;

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
    set((state) => ({
      ...pushHistory(state),
      nodes: state.nodes.filter((n) => n.id !== nodeId),
      edges: state.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
    })),

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

  // ─── Edge Actions ────────────────────────────────────────────

  addEdge: (edge) =>
    set((state) => ({
      ...pushHistory(state),
      // R32.4 — an edge arriving without a weight (an older caller, or a v1 payload)
      // gets an equal share, so the Weighted policy never sees an undefined weight.
      edges: [
        ...state.edges,
        edge.data
          ? { ...edge, data: { ...edge.data, weight: edge.data.weight ?? 1.0 } }
          : edge,
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
        e.id === edgeId
          ? { ...e, data: { ...e.data!, protocol } }
          : e,
      ),
    })),

  updateEdgeWeight: (edgeId, weight) =>
    set((state) => ({
      ...pushHistory(state),
      edges: state.edges.map((e) =>
        e.id === edgeId
          ? { ...e, data: { ...e.data!, weight } }
          : e,
      ),
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

  // ─── React Flow Handlers ─────────────────────────────────────

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
    const simulationNodes: SimulationNode[] = nodes.map((n) => n.data as SimulationNode);
    const edgeData: EdgeData[] = edges.map((e) => e.data as EdgeData);
    return { nodes: simulationNodes, edges: edgeData };
  },

  loadTopology: (nodes, edges) =>
    set((state) => ({
      ...pushHistory(state),
      nodes,
      edges,
    })),
}));
