import { useCallback, useEffect } from 'react';

import { CanvasEngine, ZoomControls } from '@/canvas';
import type { NodeRenderer } from '@/canvas';
import { SECTION_NODE_TYPE, TEXT_NOTE_NODE_TYPE } from '@/canvas';
import { createSectionNode, createTextNoteNode } from '@/canvas';
import type { SectionNodeData } from '@/canvas/types';
import { SectionNode, TextNoteNode } from '@/canvas';

import { useTopologyStore } from '@/store/topologyStore';
import { useCanvasToolStore } from '@/store/canvasToolStore';
import type { SimulationNode } from '@/types/nodes';
import { NodeType } from '@/types/nodes';
import { createDefaultNodeData } from '@/types/nodeDefaults';
import type { EdgeData } from '@/types/edges';
import { EdgeProtocol } from '@/types/edges';
import { validateEdgeConnection, getValidProtocols } from '@/validation';
import { detectCycles } from '@/validation/cycleDetection';
import { showToast } from '@/components/ui/toastStore';

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

// ─── Renderer Registries ─────────────────────────────────────────

const nodeRegistry: Record<string, NodeRenderer> = {
  [NodeType.TrafficGenerator]: (p) => <TrafficGeneratorNode {...p} />,
  [NodeType.ApiGateway]: (p) => <ApiGatewayNode {...p} />,
  [NodeType.RateLimiter]: (p) => <RateLimiterNode {...p} />,
  [NodeType.LoadBalancer]: (p) => <LoadBalancerNode {...p} />,
  [NodeType.CircuitBreaker]: (p) => <CircuitBreakerNode {...p} />,
  [NodeType.AppServer]: (p) => <AppServerNode {...p} />,
  [NodeType.Cache]: (p) => <CacheNode {...p} />,
  [NodeType.Database]: (p) => <DatabaseNode {...p} />,
  [NodeType.MessageQueue]: (p) => <MessageQueueNode {...p} />,
  [NodeType.AuthService]: (p) => <AuthServiceNode {...p} />,
  [NodeType.AuthzService]: (p) => <AuthzServiceNode {...p} />,
  [NodeType.WorkerPool]: (p) => <WorkerPoolNode {...p} />,
  [NodeType.DeadLetterQueue]: (p) => <DeadLetterQueueNode {...p} />,
  [NodeType.ObjectStore]: (p) => <ObjectStoreNode {...p} />,
  [NodeType.Scheduler]: (p) => <SchedulerNode {...p} />,
  [SECTION_NODE_TYPE]: (p) => <SectionNode {...p} />,
  [TEXT_NOTE_NODE_TYPE]: (p) => <TextNoteNode {...p} />,
};

const edgeRegistry = {
  [EdgeProtocol.Sync]: SyncEdge,
  [EdgeProtocol.Async]: AsyncEdge,
};

// ─── Canvas Editor ───────────────────────────────────────────────

export interface CanvasEditorProps {
  onNodeSelect?: (nodeId: string | null) => void;
}

export function CanvasEditor({ onNodeSelect }: CanvasEditorProps) {
  const nodes = useTopologyStore((s) => s.nodes);
  const edges = useTopologyStore((s) => s.edges);
  const onNodesChange = useTopologyStore((s) => s.onNodesChange);
  const onEdgesChange = useTopologyStore((s) => s.onEdgesChange);
  const addNode = useTopologyStore((s) => s.addNode);
  const addEdge = useTopologyStore((s) => s.addEdge);
  const removeNode = useTopologyStore((s) => s.removeNode);
  const removeEdge = useTopologyStore((s) => s.removeEdge);
  const updateNodeEdit = useTopologyStore((s) => s.updateNodeEdit);
  const undo = useTopologyStore((s) => s.undo);
  const redo = useTopologyStore((s) => s.redo);

  // ─── onConnect: validate then add edge ─────────────────────────

  const onConnect = useCallback(
    (connection: { source: string; target: string }) => {
      const { source, target } = connection;
      if (!source || !target) return;

      const sourceNode = nodes.find((n) => n.id === source);
      const targetNode = nodes.find((n) => n.id === target);
      if (!sourceNode || !targetNode) return;

      const sourceData = sourceNode.data as SimulationNode;
      const targetData = targetNode.data as SimulationNode;
      if (!('nodeType' in sourceData) || !('nodeType' in targetData)) return;

      const existingEdgeData: EdgeData[] = edges.map((e) => e.data);

      // The protocol is decided before validation because R30.13 validates it. Take the
      // pair's first permitted protocol rather than assuming Sync.
      const permitted = getValidProtocols(sourceData.nodeType, targetData.nodeType);
      const defaultProtocol = permitted[0] ?? EdgeProtocol.Sync;

      const nodesById = new Map<string, SimulationNode>(
        nodes
          .filter((n) => 'nodeType' in n.data)
          .map((n) => [n.id, n.data as SimulationNode]),
      );

      const result = validateEdgeConnection(
        sourceData,
        targetData,
        defaultProtocol,
        existingEdgeData,
        nodesById,
      );
      if (!result.valid) {
        showToast(`Connection rejected: ${result.reason}`);
        console.warn('Connection rejected:', result.reason);
        return;
      }

      const candidateEdge: EdgeData = {
        id: 'candidate',
        source,
        target,
        protocol: defaultProtocol,
        weight: 1.0,
      };
      const cycles = detectCycles(
        nodes
          .filter((n) => 'nodeType' in n.data)
          .map((n) => n.data as SimulationNode),
        [...existingEdgeData, candidateEdge],
      );
      if (cycles.length > 0) {
        showToast('Connection rejected: this edge would create a routing cycle.');
        return;
      }

      const edgeId = crypto.randomUUID();
      addEdge({
        id: edgeId,
        source,
        target,
        type: defaultProtocol,
        data: {
          id: edgeId,
          source,
          target,
          protocol: defaultProtocol,
          // R32.4 — a new edge carries an equal share until the user reweights it.
          weight: 1.0,
        },
      });
    },
    [nodes, edges, addEdge],
  );

  // ─── onDrop: create a new node from the palette ────────────────

  const onDrop = useCallback(
    (canvasPos: { x: number; y: number } | null, event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (!canvasPos) return;

      const nodeTypeStr = event.dataTransfer.getData('application/analysys-node-type');
      if (!nodeTypeStr) return;

      if (nodeTypeStr === SECTION_NODE_TYPE) {
        addNode(createSectionNode(canvasPos));
        return;
      }
      if (nodeTypeStr === TEXT_NOTE_NODE_TYPE) {
        addNode(createTextNoteNode(canvasPos));
        return;
      }

      if (!Object.values(NodeType).includes(nodeTypeStr as NodeType)) return;

      const nodeData = createDefaultNodeData(nodeTypeStr as NodeType, canvasPos);
      addNode({
        id: nodeData.id,
        type: nodeData.nodeType,
        position: canvasPos,
        data: nodeData,
      });
    },
    [addNode],
  );

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  // ─── Draw a section tool: create a section sized to the dragged rectangle ───

  const onDrawSection = useCallback(
    (bounds: { x: number; y: number; width: number; height: number }) => {
      const id = crypto.randomUUID();
      const position = { x: bounds.x, y: bounds.y };
      const data: SectionNodeData = {
        kind: 'section',
        id,
        label: 'Section',
        position,
        width: bounds.width,
        height: bounds.height,
      };
      addNode({
        id,
        type: SECTION_NODE_TYPE,
        position,
        width: bounds.width,
        height: bounds.height,
        selected: false,
        dragging: false,
        data,
      });
      useCanvasToolStore.getState().setDrawTool(null);
    },
    [addNode],
  );

  // ─── Keyboard shortcuts ────────────────────────────────────────

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        const selectedNodes = nodes.filter((n) => n.selected);
        const selectedEdges = edges.filter((e) => e.selected);

        selectedNodes.forEach((n) => removeNode(n.id));
        selectedEdges.forEach((e) => removeEdge(e.id));
      }

      if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      }

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

  // ─── Render ────────────────────────────────────────────────────

  return (
    <div className="relative h-full w-full">
      <CanvasEngine
        nodes={nodes}
        edges={edges}
        nodeRegistry={nodeRegistry}
        edgeRegistry={edgeRegistry}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeSelect={onNodeSelect}
        onEditNode={updateNodeEdit}
        onDrawSection={onDrawSection}
        onDrop={onDrop}
        onDragOver={onDragOver}
        fitView
        showMiniMap={false}
      >
        <ZoomControls />
        <HealthLegend />
      </CanvasEngine>
    </div>
  );
}
