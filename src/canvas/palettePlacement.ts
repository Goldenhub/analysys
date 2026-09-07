import { useTopologyStore } from '../store/topologyStore';
import { NodeType } from '../types/nodes';
import { createDefaultNodeData } from '../types/nodeDefaults';
import { createSectionNode, createTextNoteNode } from './nodeFactory';
import { SECTION_NODE_TYPE, TEXT_NOTE_NODE_TYPE } from './types';

// ─── Palette placement ────────────────────────────────────────────
// Shared by every path that adds a node from the palette: the HTML5 drag-and-drop
// handler in CanvasEditor and the touch drag / tap path in NodePalette. Keeping the
// creation logic in one place guarantees the placement details stay identical
// (section vs text note vs default node, parentNodeId propagation, topology add).

export function placePaletteNode(
  nodeTypeStr: string,
  canvasPos: { x: number; y: number },
  parentNodeId: string | null,
): void {
  const addNode = useTopologyStore.getState().addNode;

  if (nodeTypeStr === SECTION_NODE_TYPE) {
    const node = createSectionNode(canvasPos);
    addNode({ ...node, data: { ...node.data, parentNodeId } });
    return;
  }
  if (nodeTypeStr === TEXT_NOTE_NODE_TYPE) {
    const node = createTextNoteNode(canvasPos);
    addNode({ ...node, data: { ...node.data, parentNodeId } });
    return;
  }

  if (!Object.values(NodeType).includes(nodeTypeStr as NodeType)) return;

  const nodeData = createDefaultNodeData(nodeTypeStr as NodeType, canvasPos);
  nodeData.parentNodeId = parentNodeId;
  addNode({
    id: nodeData.id,
    type: nodeData.nodeType,
    position: canvasPos,
    data: nodeData,
  });
}