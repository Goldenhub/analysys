// ─── Handle Registry ─────────────────────────────────────────────
// Defines, per node type, which connection handles exist and where they are anchored
// relative to the node's top-left origin. This keeps edge anchoring logic out of the
// individual node components and centralized in the engine.

import type { NodeType } from '@/types/nodes';
import { SECTION_NODE_TYPE, TEXT_NOTE_NODE_TYPE } from './types';

export type HandlePosition = 'left' | 'right' | 'top' | 'bottom';

export interface HandleDef {
  id: 'source' | 'target';
  position: HandlePosition;
  /** Offset within the edge of the node, 0–1 (default centered). */
  offset?: number;
}

export interface NodeHandleLayout {
  handles: HandleDef[];
}

// Most service nodes: request flow is left→right, so target on the left, source on the right.
const LTR: NodeHandleLayout = {
  handles: [
    { id: 'target', position: 'left' },
    { id: 'source', position: 'right' },
  ],
};

// Producers that only emit (no upstream request input): source only on the right.
const PRODUCER_SOURCE: NodeHandleLayout = {
  handles: [{ id: 'source', position: 'right' }],
};

// Message queue and scheduler fan out asynchronously; keep target left, source right.
const QUEUE_SOURCES: NodeHandleLayout = {
  handles: [
    { id: 'target', position: 'left' },
    { id: 'source', position: 'right' },
  ],
};

const REGISTRY: Record<NodeType | string, NodeHandleLayout> = {
  TRAFFIC_GENERATOR: PRODUCER_SOURCE,
  API_GATEWAY: LTR,
  RATE_LIMITER: LTR,
  LOAD_BALANCER: LTR,
  CIRCUIT_BREAKER: LTR,
  APP_SERVER: LTR,
  CACHE: LTR,
  DATABASE: LTR,
  MESSAGE_QUEUE: QUEUE_SOURCES,
  AUTH_SERVICE: LTR,
  AUTHZ_SERVICE: LTR,
  WORKER_POOL: QUEUE_SOURCES,
  DEAD_LETTER_QUEUE: LTR,
  OBJECT_STORE: LTR,
  SCHEDULER: PRODUCER_SOURCE,
  // Visual-only nodes have no connection handles.
  [SECTION_NODE_TYPE]: { handles: [] },
  [TEXT_NOTE_NODE_TYPE]: { handles: [] },
};

/** Default layout for unknown/internal node types is full LTR. */
export const DEFAULT_HANDLE_LAYOUT: NodeHandleLayout = LTR;

export function getHandleLayout(nodeType: NodeType | string): NodeHandleLayout {
  return REGISTRY[nodeType] ?? DEFAULT_HANDLE_LAYOUT;
}

/**
 * Resolve the absolute (canvas-space) anchor for a handle of a node.
 */
export function resolveHandleAnchor(
  handle: HandleDef,
  nodePosition: { x: number; y: number },
  nodeWidth: number,
  nodeHeight: number,
): { x: number; y: number } {
  const t = handle.offset ?? 0.5;
  switch (handle.position) {
    case 'left':
      return { x: nodePosition.x, y: nodePosition.y + nodeHeight * t };
    case 'right':
      return { x: nodePosition.x + nodeWidth, y: nodePosition.y + nodeHeight * t };
    case 'top':
      return { x: nodePosition.x + nodeWidth * t, y: nodePosition.y };
    case 'bottom':
      return { x: nodePosition.x + nodeWidth * t, y: nodePosition.y + nodeHeight };
  }
}
