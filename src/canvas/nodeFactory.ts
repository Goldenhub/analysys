import type { CanvasNode, SectionNodeData, TextNoteNodeData } from './types';
import { SECTION_NODE_TYPE, TEXT_NOTE_NODE_TYPE } from './types';

// ─── Visual node factories ───────────────────────────────────────

export function createSectionNode(
  position: { x: number; y: number },
  label = 'Section',
): CanvasNode {
  const id = crypto.randomUUID();
  const data: SectionNodeData = {
    kind: 'section',
    id,
    label,
    position,
    width: 320,
    height: 200,
  };
  return {
    id,
    type: SECTION_NODE_TYPE,
    position,
    width: 320,
    height: 200,
    selected: false,
    dragging: false,
    data,
  };
}

export function createTextNoteNode(
  position: { x: number; y: number },
  text = '',
): CanvasNode {
  const id = crypto.randomUUID();
  const data: TextNoteNodeData = {
    kind: 'text_note',
    id,
    text,
    position,
    width: 180,
    height: 120,
    color: '#211e1a',
  };
  return {
    id,
    type: TEXT_NOTE_NODE_TYPE,
    position,
    width: 180,
    height: 120,
    selected: false,
    dragging: false,
    data,
  };
}

/** True if a canvas node is a visual-only (section/text note) node. */
export function isVisualNode(node: Pick<CanvasNode, 'type'>): boolean {
  return node.type === SECTION_NODE_TYPE || node.type === TEXT_NOTE_NODE_TYPE;
}
