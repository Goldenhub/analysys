// ─── Change Application ──────────────────────────────────────────
// Applies arrays of CanvasNodeChange/CanvasEdgeChange to node/edge arrays. The change
// shapes mirror @xyflow/react so existing store handlers swap over with minimal churn.

import type {
  CanvasEdge,
  CanvasEdgeChange,
  CanvasNode,
  CanvasNodeChange,
} from './types';

export function applyNodeChanges(changes: CanvasNodeChange[], nodes: CanvasNode[]): CanvasNode[] {
  if (changes.length === 0) return nodes;
  const removed = new Set(changes.filter((c) => c.type === 'remove').map((c) => c.id));
  const next = nodes
    .filter((n) => !removed.has(n.id))
    .map((n) => {
      let updated: CanvasNode = n;
      for (const change of changes) {
        if (change.id !== n.id) continue;
        switch (change.type) {
          case 'position':
            // Mirror the live position into `data` so persistence, baselines, and
            // engine snapshots all see where the node actually is after a drag.
            updated = {
              ...updated,
              position: change.position,
              dragging: change.dragging ?? false,
              data: { ...updated.data, position: change.position },
            };
            break;
          case 'dimensions':
            // Resized sections/text notes keep their size in `data`; mirror it so a
            // resize survives a save/export round trip.
            updated = {
              ...updated,
              width: change.dimensions.width,
              height: change.dimensions.height,
              data: {
                ...updated.data,
                width: change.dimensions.width,
                height: change.dimensions.height,
              },
            };
            break;
          case 'select':
            updated = { ...updated, selected: change.selected };
            break;
        }
      }
      return updated;
    });
  return next;
}

export function applyEdgeChanges(changes: CanvasEdgeChange[], edges: CanvasEdge[]): CanvasEdge[] {
  if (changes.length === 0) return edges;
  const removed = new Set(changes.filter((c) => c.type === 'remove').map((c) => c.id));
  return edges
    .filter((e) => !removed.has(e.id))
    .map((e) => {
      let updated: CanvasEdge = e;
      for (const change of changes) {
        if (change.id !== e.id) continue;
        switch (change.type) {
          case 'select':
            updated = { ...updated, selected: change.selected };
            break;
        }
      }
      return updated;
    });
}
