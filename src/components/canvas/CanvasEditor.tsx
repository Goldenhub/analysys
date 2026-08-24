import { useCallback, useRef, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  MarkerType,
  useReactFlow,
  ReactFlowProvider,
  type Connection,
  type NodeTypes,
  type EdgeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useTopologyStore } from '@/store/topologyStore';
import type { AnalysysNode, SimulationNode } from '@/types/nodes';
import { NodeType } from '@/types/nodes';
import { createDefaultNodeData } from '@/types/nodeDefaults';
import type { AnalysysEdge, EdgeData } from '@/types/edges';
import { EdgeProtocol } from '@/types/edges';
import { validateEdgeConnection, getValidProtocols } from '@/validation';

import {
  TrafficGeneratorNode,
  ApiGatewayNode,
  RateLimiterNode,
  LoadBalancerNode,
  CircuitBreakerNode,
  AppServerNode,
  CacheNode,
  DatabaseNode,
  MessageQueueNode,
  AuthServiceNode,
  AuthzServiceNode,
  WorkerPoolNode,
  DeadLetterQueueNode,
  ObjectStoreNode,
  SchedulerNode,
} from './nodes';
import { SyncEdge, AsyncEdge } from './edges';
import { HealthLegend } from './HealthLegend';
import {
  SubsystemGroupNode,
  MergedBoundaryEdge,
  GroupToolbar,
  useCollapsedTopologyView,
  SUBSYSTEM_GROUP_NODE_TYPE,
  MERGED_BOUNDARY_EDGE_TYPE,
} from './groups';

// ─── Custom Node Type Registry ───────────────────────────────────

const nodeTypes: NodeTypes = {
  [NodeType.TrafficGenerator]: TrafficGeneratorNode,
  [NodeType.ApiGateway]: ApiGatewayNode,
  [NodeType.RateLimiter]: RateLimiterNode,
  [NodeType.LoadBalancer]: LoadBalancerNode,
  [NodeType.CircuitBreaker]: CircuitBreakerNode,
  [NodeType.AppServer]: AppServerNode,
  [NodeType.Cache]: CacheNode,
  [NodeType.Database]: DatabaseNode,
  [NodeType.MessageQueue]: MessageQueueNode,
  [NodeType.AuthService]: AuthServiceNode,
  [NodeType.AuthzService]: AuthzServiceNode,
  [NodeType.WorkerPool]: WorkerPoolNode,
  [NodeType.DeadLetterQueue]: DeadLetterQueueNode,
  [NodeType.ObjectStore]: ObjectStoreNode,
  [NodeType.Scheduler]: SchedulerNode,
  [SUBSYSTEM_GROUP_NODE_TYPE]: SubsystemGroupNode,
};

// ─── Custom Edge Type Registry ───────────────────────────────────

const edgeTypes: EdgeTypes = {
  [EdgeProtocol.Sync]: SyncEdge,
  [EdgeProtocol.Async]: AsyncEdge,
  [MERGED_BOUNDARY_EDGE_TYPE]: MergedBoundaryEdge,
};

// ─── Default Edge Markers ────────────────────────────────────────

const defaultEdgeOptions = {
  markerEnd: {
    type: MarkerType.ArrowClosed,
    width: 16,
    height: 16,
    color: '#6b7280',
  },
};

// ─── Inner Canvas (requires ReactFlowProvider ancestor) ──────────

interface CanvasEditorInnerProps {
  onNodeSelect?: (nodeId: string | null) => void;
}

function CanvasEditorInner({ onNodeSelect }: CanvasEditorInnerProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  // Canonical store (for mutations)
  const storeNodes = useTopologyStore((s) => s.nodes);
  const storeEdges = useTopologyStore((s) => s.edges);
  const onNodesChange = useTopologyStore((s) => s.onNodesChange);
  const onEdgesChange = useTopologyStore((s) => s.onEdgesChange);
  const addNode = useTopologyStore((s) => s.addNode);
  const addEdge = useTopologyStore((s) => s.addEdge);
  const removeNode = useTopologyStore((s) => s.removeNode);
  const removeEdge = useTopologyStore((s) => s.removeEdge);
  const undo = useTopologyStore((s) => s.undo);
  const redo = useTopologyStore((s) => s.redo);

  // Derived view for rendering (includes collapsed groups)
  const { nodes: renderNodes, edges: renderEdges } = useCollapsedTopologyView();

  // Track selected node IDs for group toolbar
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const subsystemGroups = useTopologyStore((s) => s.subsystemGroups);

  // ─── onConnect: validate then add edge ─────────────────────────

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;

      // Find source and target node data for validation
      const sourceNode = storeNodes.find((n) => n.id === connection.source);
      const targetNode = storeNodes.find((n) => n.id === connection.target);
      if (!sourceNode || !targetNode) return;

      const sourceData = sourceNode.data as SimulationNode;
      const targetData = targetNode.data as SimulationNode;

      // Extract existing edge data for duplicate check
      const existingEdgeData: EdgeData[] = storeEdges.map((e) => e.data as EdgeData);

      // The protocol is decided before validation because R30.13 validates it. Take the
      // pair's first permitted protocol rather than assuming Sync: an async-only pair
      // (Message_Queue → App_Server, Scheduler → Worker_Pool) would otherwise be created
      // as Sync and then rejected by the protocol-mismatch rule.
      const permitted = getValidProtocols(sourceData.nodeType, targetData.nodeType);
      const defaultProtocol = permitted[0] ?? EdgeProtocol.Sync;

      // Node lookup for the R30.11 cardinality rejection, which names a third node.
      const nodesById = new Map<string, SimulationNode>(
        storeNodes.map((n) => [n.id, n.data as SimulationNode]),
      );

      const result = validateEdgeConnection(
        sourceData,
        targetData,
        defaultProtocol,
        existingEdgeData,
        nodesById,
      );
      if (!result.valid) {
        // Could surface this to the user via toast/notification in the future
        console.warn('Connection rejected:', result.reason);
        return;
      }

      const edgeId = crypto.randomUUID();
      const newEdge: AnalysysEdge = {
        id: edgeId,
        source: connection.source,
        target: connection.target,
        type: defaultProtocol,
        markerEnd: defaultEdgeOptions.markerEnd,
        data: {
          id: edgeId,
          source: connection.source,
          target: connection.target,
          protocol: defaultProtocol,
          // R32.4 — a new edge carries an equal share until the user reweights it.
          weight: 1.0,
        },
      };

      addEdge(newEdge);
    },
    [storeNodes, storeEdges, addEdge],
  );

  // ─── onDrop: create new node from palette ──────────────────────

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();

      const nodeTypeStr = event.dataTransfer.getData('application/analysys-node-type');
      if (!nodeTypeStr) return;

      // Validate it's a known NodeType
      if (!Object.values(NodeType).includes(nodeTypeStr as NodeType)) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const nodeData = createDefaultNodeData(nodeTypeStr as NodeType, position);
      const newNode: AnalysysNode = {
        id: nodeData.id,
        type: nodeData.nodeType,
        position,
        data: nodeData as AnalysysNode['data'],
      };

      addNode(newNode);
    },
    [screenToFlowPosition, addNode],
  );

  // ─── onDragOver: allow drop ────────────────────────────────────

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  // ─── Node selection handler ────────────────────────────────────

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: { nodes: AnalysysNode[] }) => {
      const ids = selectedNodes.map((n) => n.id);
      setSelectedNodeIds(ids);
      const firstNode = selectedNodes.length === 1 ? selectedNodes[0] : undefined;
      onNodeSelect?.(firstNode?.id ?? null);
    },
    [onNodeSelect],
  );

  // ─── Keyboard shortcuts ────────────────────────────────────────

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Ignore if user is typing in an input
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Delete/Backspace: remove selected nodes and edges
      if (event.key === 'Delete' || event.key === 'Backspace') {
        const selectedNodes = storeNodes.filter((n) => n.selected);
        const selectedEdges = storeEdges.filter((e) => e.selected);

        selectedNodes.forEach((n) => removeNode(n.id));
        selectedEdges.forEach((e) => removeEdge(e.id));
      }

      // Ctrl+Z: Undo
      if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      }

      // Ctrl+Y or Ctrl+Shift+Z: Redo
      if (
        ((event.ctrlKey || event.metaKey) && event.key === 'y') ||
        ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'z')
      ) {
        event.preventDefault();
        redo();
      }
    },
    [storeNodes, storeEdges, removeNode, removeEdge, undo, redo],
  );

  useEffect(() => {
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);

  // ─── Memoize node/edge types to prevent re-renders ─────────────

  const memoizedNodeTypes = useMemo(() => nodeTypes, []);
  const memoizedEdgeTypes = useMemo(() => edgeTypes, []);

  // ─── Render ────────────────────────────────────────────────────

  return (
    <div ref={reactFlowWrapper} className="relative h-full w-full">
      <ReactFlow
        nodes={renderNodes}
        edges={renderEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onSelectionChange={onSelectionChange}
        nodeTypes={memoizedNodeTypes}
        edgeTypes={memoizedEdgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        fitView
        deleteKeyCode={null} // We handle delete ourselves
        className="bg-gray-950"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#374151" />
        <Controls className="!bg-gray-800 !border-gray-700 [&>button]:!bg-gray-800 [&>button]:!border-gray-700 [&>button]:!text-gray-300 [&>button:hover]:!bg-gray-700" />
        <MiniMap
          className="!bg-gray-900 !border-gray-700"
          nodeColor={() => '#6b7280'}
          maskColor="rgba(0, 0, 0, 0.7)"
        />
        <HealthLegend />
      </ReactFlow>

      {/* Group toolbar: visible when 2+ nodes are selected OR when groups exist */}
      {(selectedNodeIds.length >= 2 || subsystemGroups.length > 0) && (
        <div className="absolute top-2 right-2 z-10 max-h-[60vh] overflow-y-auto">
          <GroupToolbar selectedNodeIds={selectedNodeIds} />
        </div>
      )}
    </div>
  );
}

// ─── Exported Component (wraps with ReactFlowProvider) ───────────

export interface CanvasEditorProps {
  onNodeSelect?: (nodeId: string | null) => void;
}

export function CanvasEditor({ onNodeSelect }: CanvasEditorProps) {
  return (
    <ReactFlowProvider>
      <CanvasEditorInner onNodeSelect={onNodeSelect} />
    </ReactFlowProvider>
  );
}
