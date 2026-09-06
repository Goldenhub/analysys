// ─── Canvas Engine Types ─────────────────────────────────────────
// A minimal, library-agnostic graph type system that replaces @xyflow/react's
// Node/Edge. Data payloads (`SimulationNode`, `EdgeData`) are reused unchanged so the
// simulation engine, persistence, presets, and validation layers do not need to change.

import type { SimulationNode } from '@/types/nodes';
import type { EdgeData } from '@/types/edges';

// ─── Visual-only node kinds ──────────────────────────────────────
// Section and Text Note nodes are non-processing canvas elements. They are *not*
// `SimulationNode`s — they never enter the simulation, routing, metrics, or config
// forms. They only need to render and persist.

export const SECTION_NODE_TYPE = 'SECTION';
export const TEXT_NOTE_NODE_TYPE = 'TEXT_NOTE';

export type VisualNodeType = typeof SECTION_NODE_TYPE | typeof TEXT_NOTE_NODE_TYPE;

export interface BaseVisualNodeData {
  id: string;
  position: { x: number; y: number };
}

export interface SectionNodeData extends BaseVisualNodeData {
  kind: 'section';
  label: string;
  width: number;
  height: number;
}

export interface TextNoteNodeData extends BaseVisualNodeData {
  kind: 'text_note';
  text: string;
  width: number;
  height: number;
  /** Text color for stylized notes. */
  color: string;
}

export type VisualNodeData = SectionNodeData | TextNoteNodeData;

/** Every payload a canvas node can carry: a simulation node OR a visual-only node. */
export type CanvasNodeData = SimulationNode | VisualNodeData;

// ─── Node ────────────────────────────────────────────────────────

export type NodeHandleId = 'source' | 'target';

export interface CanvasNode {
  id: string;
  /** Registry key — a `NodeType` enum value or a visual node kind. */
  type: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  selected?: boolean;
  dragging?: boolean;
  data: CanvasNodeData;
}

// ─── Edge ────────────────────────────────────────────────────────

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  selected?: boolean;
  data: EdgeData;
}

// ─── Change objects (React-Flow-compatible shape) ───────────────

export type CanvasNodeChange =
  | { type: 'position'; id: string; position: { x: number; y: number }; dragging?: boolean }
  | { type: 'dimensions'; id: string; dimensions: { width: number; height: number } }
  | { type: 'select'; id: string; selected: boolean }
  | { type: 'remove'; id: string };

export type CanvasEdgeChange =
  | { type: 'select'; id: string; selected: boolean }
  | { type: 'remove'; id: string };

// ─── Viewport ────────────────────────────────────────────────────

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** The entire engine API exposed to the host (exchanged via context). */
export interface ViewportApi {
  screenToCanvas: (point: { x: number; y: number }) => { x: number; y: number };
  canvasToScreen: (point: { x: number; y: number }) => { x: number; y: number };
  panBy: (dx: number, dy: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomTo: (zoom: number) => void;
  fitView: () => void;
  focus: () => void;
}
