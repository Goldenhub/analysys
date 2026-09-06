import type { NodeRendererProps } from './CanvasEngine';
import { getHandleLayout, resolveHandleAnchor } from './handleRegistry';

// ─── Handles ─────────────────────────────────────────────────────
// Renders the connection anchor dots for a simulation node, positioned per the handle
// registry, and wires pointer-down to begin a connection drag. Used by every processing
// node component so anchoring stays consistent with the engine.

interface NodeHandlesProps {
  nodeType: string;
  width: number;
  height: number;
  selected: boolean;
  onConnectStart: NodeRendererProps['onConnectStart'];
}

export function NodeHandles({
  nodeType,
  width,
  height,
  selected,
  onConnectStart,
}: NodeHandlesProps) {
  const layout = getHandleLayout(nodeType);
  return (
    <>
      {layout.handles.map((handle) => {
        const anchor = resolveHandleAnchor(handle, { x: 0, y: 0 }, width, height);
        return (
          <div
            key={handle.id}
            role="button"
            aria-label={`${handle.id} handle`}
            onPointerDown={(e) => onConnectStart(handle.id as 'source' | 'target', e)}
            className={`absolute z-10 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#f3ede2] transition-colors ${
              selected ? 'bg-[#b8402e]' : 'bg-[#b8402e]/90'
            } hover:scale-125 hover:bg-[#b8402e]`}
            style={{
              left: handle.position === 'right' ? width : handle.position === 'left' ? 0 : anchor.x,
              top: handle.position === 'bottom' ? height : handle.position === 'top' ? 0 : anchor.y,
              cursor: 'crosshair',
            }}
          />
        );
      })}
    </>
  );
}
