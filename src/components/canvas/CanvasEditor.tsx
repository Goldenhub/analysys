import { useCallback, useRef, useEffect, useMemo } from 'react';
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
import { WelcomeOverlay } from './WelcomeOverlay';
import type { AnalysysNode, SimulationNode } from '@/types/nodes';
import {
  NodeType,
  Distribution,
  LBAlgorithm,
  EvictionPolicy,
  DatabaseType,
  BackpressureStrategy,
} from '@/types/nodes';
import type { AnalysysEdge, EdgeData } from '@/types/edges';
import { EdgeProtocol } from '@/types/edges';
import { validateEdgeConnection } from '@/validation';

import {
  TrafficGeneratorNode,
  LoadBalancerNode,
  AppServerNode,
  CacheNode,
  DatabaseNode,
  MessageQueueNode,
} from './nodes';
import { SyncEdge, AsyncEdge } from './edges';
import { HealthLegend } from './HealthLegend';

// ─── Custom Node Type Registry ───────────────────────────────────

const nodeTypes: NodeTypes = {
  [NodeType.TrafficGenerator]: TrafficGeneratorNode,
  [NodeType.LoadBalancer]: LoadBalancerNode,
  [NodeType.AppServer]: AppServerNode,
  [NodeType.Cache]: CacheNode,
  [NodeType.Database]: DatabaseNode,
  [NodeType.MessageQueue]: MessageQueueNode,
};

// ─── Custom Edge Type Registry ───────────────────────────────────

const edgeTypes: EdgeTypes = {
  [EdgeProtocol.Sync]: SyncEdge,
  [EdgeProtocol.Async]: AsyncEdge,
};

// ─── Default Configurations Per Node Type ────────────────────────

function createDefaultNodeData(
  nodeType: NodeType,
  position: { x: number; y: number },
): SimulationNode {
  const id = crypto.randomUUID();
  const base = { id, position };

  switch (nodeType) {
    case NodeType.TrafficGenerator:
      return {
        ...base,
        nodeType: NodeType.TrafficGenerator,
        label: 'Traffic Generator',
        config: {
          rps: 100,
          distribution: Distribution.Poisson,
          spikeMultiplier: 1,
          spikeDurationSec: 10,
        },
      };
    case NodeType.LoadBalancer:
      return {
        ...base,
        nodeType: NodeType.LoadBalancer,
        label: 'Load Balancer',
        config: {
          algorithm: LBAlgorithm.RoundRobin,
          healthCheckIntervalMs: 5000,
          evictionThreshold: 3,
        },
      };
    case NodeType.AppServer:
      return {
        ...base,
        nodeType: NodeType.AppServer,
        label: 'App Server',
        config: {
          workerThreadPoolSize: 16,
          requestQueueDepth: 100,
          processingTimeMeanMs: 50,
          processingTimeStdDevMs: 15,
        },
      };
    case NodeType.Cache:
      return {
        ...base,
        nodeType: NodeType.Cache,
        label: 'Cache',
        config: {
          hitRatio: 0.85,
          evictionPolicy: EvictionPolicy.LRU,
          accessLatencyMs: 2,
        },
      };
    case NodeType.Database:
      return {
        ...base,
        nodeType: NodeType.Database,
        label: 'Database',
        config: {
          connectionPoolSize: 20,
          queryLatencyMeanMs: 25,
          queryLatencyStdDevMs: 10,
          lockTimeoutMs: 5000,
          dbType: DatabaseType.Relational,
        },
      };
    case NodeType.MessageQueue:
      return {
        ...base,
        nodeType: NodeType.MessageQueue,
        label: 'Message Queue',
        config: {
          consumerBatchSize: 10,
          bufferCapacity: 10000,
          backpressureThresholdPct: 80,
          backpressureStrategy: BackpressureStrategy.RejectNew,
        },
      };
  }
}

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

  // Connect to topology store
  const nodes = useTopologyStore((s) => s.nodes);
  const edges = useTopologyStore((s) => s.edges);
  const onNodesChange = useTopologyStore((s) => s.onNodesChange);
  const onEdgesChange = useTopologyStore((s) => s.onEdgesChange);
  const addNode = useTopologyStore((s) => s.addNode);
  const addEdge = useTopologyStore((s) => s.addEdge);
  const removeNode = useTopologyStore((s) => s.removeNode);
  const removeEdge = useTopologyStore((s) => s.removeEdge);
  const undo = useTopologyStore((s) => s.undo);
  const redo = useTopologyStore((s) => s.redo);

  // ─── onConnect: validate then add edge ─────────────────────────

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;

      // Find source and target node data for validation
      const sourceNode = nodes.find((n) => n.id === connection.source);
      const targetNode = nodes.find((n) => n.id === connection.target);
      if (!sourceNode || !targetNode) return;

      const sourceData = sourceNode.data as SimulationNode;
      const targetData = targetNode.data as SimulationNode;

      // Extract existing edge data for duplicate check
      const existingEdgeData: EdgeData[] = edges.map((e) => e.data as EdgeData);

      const result = validateEdgeConnection(sourceData, targetData, existingEdgeData);
      if (!result.valid) {
        // Could surface this to the user via toast/notification in the future
        console.warn('Connection rejected:', result.reason);
        return;
      }

      // Determine default protocol based on connection rules
      const defaultProtocol = EdgeProtocol.Sync;

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
        },
      };

      addEdge(newEdge);
    },
    [nodes, edges, addEdge],
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
        const selectedNodes = nodes.filter((n) => n.selected);
        const selectedEdges = edges.filter((e) => e.selected);

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
    [nodes, edges, removeNode, removeEdge, undo, redo],
  );

  useEffect(() => {
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);

  // ─── Memoize node/edge types to prevent re-renders ─────────────

  const memoizedNodeTypes = useMemo(() => nodeTypes, []);
  const memoizedEdgeTypes = useMemo(() => edgeTypes, []);

  // ─── Render ────────────────────────────────────────────────────

  const isCanvasEmpty = nodes.length === 0;

  return (
    <div ref={reactFlowWrapper} className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
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
      {isCanvasEmpty && <WelcomeOverlay />}
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
