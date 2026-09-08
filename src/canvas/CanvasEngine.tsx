import { useCallback, useLayoutEffect, useMemo, useRef, useState, useEffect } from 'react';
import type {
  CanvasEdge,
  CanvasEdgeChange,
  CanvasNode,
  CanvasNodeChange,
  Viewport,
  ViewportApi,
} from './types';
import { MIN_ZOOM, MAX_ZOOM, DEFAULT_ZOOM, CanvasContext } from './CanvasContext';
import { getBezierPath, arrowMarkerDef } from './path';
import { getHandleLayout, resolveHandleAnchor } from './handleRegistry';
import { clamp } from './utils';
import { isVisualNode } from './nodeFactory';
import { publishViewport, publishSize, subscribeCommands } from './viewportBus';
import { useCanvasToolStore } from '@/store/canvasToolStore';

// ─── Renderer contracts ──────────────────────────────────────────

export interface NodeRendererProps {
  id: string;
  data: CanvasNode['data'];
  selected: boolean;
  width: number;
  height: number;
  onConnectStart: (handle: 'source' | 'target', e: React.PointerEvent) => void;
  onConnectEnd: (e: React.PointerEvent) => void;
  onNodeClick: (id: string, e: React.MouseEvent) => void;
  /** Commit an inline edit (label, text, etc.) for a node. */
  onEdit: (id: string, patch: Record<string, unknown>) => void;
}

export type NodeRenderer = (props: NodeRendererProps) => React.ReactElement;

export type NodeRegistry = Record<string, NodeRenderer>;

export interface EdgeRenderContext {
  id: string;
  data: CanvasEdge['data'];
  selected: boolean;
  source: { x: number; y: number };
  target: { x: number; y: number };
}

export type EdgeRenderer = (ctx: EdgeRenderContext) => React.ReactElement;

export type EdgeRegistry = Record<string, EdgeRenderer>;

// ─── Props ───────────────────────────────────────────────────────

export interface CanvasEngineProps {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  nodeRegistry: NodeRegistry;
  edgeRegistry: EdgeRegistry;
  onNodesChange: (changes: CanvasNodeChange[]) => void;
  onEdgesChange: (changes: CanvasEdgeChange[]) => void;
  onConnect: (connection: {
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
  }) => void;
  onNodeSelect?: (nodeId: string | null) => void;
  onNodeDoubleClick?: (nodeId: string) => void;
  /** Right-click a node: report the node and the cursor position for a context menu. */
  onNodeContextMenu?: (nodeId: string, position: { x: number; y: number }) => void;
  /** Drill into a node's component layer (an explicit affordance alongside double-click). */
  onEnterComponent?: (nodeId: string) => void;
  onBackgroundClick?: () => void;
  onEditNode?: (id: string, patch: Record<string, unknown>) => void;
  /** Commit a newly drawn visual node (e.g. a section) in canvas coordinates. */
  onDrawSection?: (bounds: { x: number; y: number; width: number; height: number }) => void;
  onDrop?: (canvasPos: { x: number; y: number } | null, e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver?: React.DragEventHandler<HTMLDivElement>;
  defaultNodeWidth?: number;
  defaultNodeHeight?: number;
  fitView?: boolean;
  showMiniMap?: boolean;
  children?: React.ReactNode;
}

interface DragState {
  mode: 'pan' | 'node' | 'connect' | 'draw-section';
  startX: number;
  startY: number;
  viewportStart?: Viewport;
  nodeId?: string;
  startPos?: { x: number; y: number };
  from?: { nodeId: string; handle: 'source' | 'target'; x: number; y: number };
  /** Anchor (screen) and live corner (canvas) for the draw-section preview. */
  drawStart?: { x: number; y: number };
  drawEnd?: { x: number; y: number };
}

/** Screen-space movement below which a node press is treated as a click (not a drag). */
const CLICK_DRAG_THRESHOLD_PX = 4;

interface TempEdge {
  from: { x: number; y: number; handle: 'source' | 'target' };
  cursor: { x: number; y: number };
}

// ─── Engine ──────────────────────────────────────────────────────

export function CanvasEngine({
  nodes,
  edges,
  nodeRegistry,
  edgeRegistry,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodeSelect,
  onNodeDoubleClick,
  onNodeContextMenu,
  onEnterComponent,
  onBackgroundClick,
  onEditNode,
  onDrawSection,
  onDrop,
  onDragOver,
  defaultNodeWidth = 140,
  defaultNodeHeight = 80,
  fitView = false,
  showMiniMap = false,
  children,
}: CanvasEngineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewport, setViewport] = useState<Viewport>({
    x: 0,
    y: 0,
    zoom: DEFAULT_ZOOM,
  });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [tempEdge, setTempEdge] = useState<TempEdge | null>(null);
  const drawTool = useCanvasToolStore((s) => s.drawTool);
  const setDrawTool = useCanvasToolStore((s) => s.setDrawTool);

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep wheel events from bubbling to the browser's own pinch/scroll zoom.
  // React's onWheel is passive by default, so its preventDefault() cannot stop
  // the page from zooming; a native non-passive listener is required to trap the
  // event at the canvas. The React onWheel handler performs the actual pan/zoom.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const block = (e: WheelEvent) => e.preventDefault();
    el.addEventListener('wheel', block, { passive: false });
    return () => el.removeEventListener('wheel', block);
  }, []);

  // Fit view once the nodes and container are known.
  const fitDoneRef = useRef(false);
  useLayoutEffect(() => {
    if (!fitView || fitDoneRef.current) return;
    if (nodes.length === 0 || size.width === 0) return;
    const minX = Math.min(...nodes.map((n) => n.position.x));
    const minY = Math.min(...nodes.map((n) => n.position.y));
    const maxX = Math.max(...nodes.map((n) => n.position.x + (n.width ?? defaultNodeWidth)));
    const maxY = Math.max(...nodes.map((n) => n.position.y + (n.height ?? defaultNodeHeight)));
    const pad = 60;
    const scale = clamp(
      Math.min(
        (size.width - pad * 2) / Math.max(1, maxX - minX),
        (size.height - pad * 2) / Math.max(1, maxY - minY),
        MAX_ZOOM,
      ),
      MIN_ZOOM,
      MAX_ZOOM,
    );
    // Fit-view is an intentional one-time layout effect: it computes the initial
    // viewport from the measured container/nodes, so calling setViewport here is correct.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setViewport({
      zoom: scale,
      x: (size.width - (maxX - minX) * scale) / 2 - minX * scale,
      y: (size.height - (maxY - minY) * scale) / 2 - minY * scale,
    });
    fitDoneRef.current = true;
  }, [fitView, nodes, size.width, size.height, defaultNodeHeight, defaultNodeWidth]);

  // Publish viewport + size to the external viewport bus so sibling consumers
  // (e.g. the AnalysisPanel) can read and drive the viewport.
  useEffect(() => {
    publishSize(size);
  }, [size]);

  useEffect(() => {
    publishViewport(viewport);
  }, [viewport]);

  // ─── Viewport commands from external consumers ─────────────────
  const fitToBounds = useCallback(
    (bounds: { x: number; y: number; width: number; height: number }, padding: number) => {
      const availW = size.width - padding * 2;
      const availH = size.height - padding * 2;
      if (availW <= 0 || availH <= 0) return;
      const scale = clamp(
        Math.min(availW / Math.max(1, bounds.width), availH / Math.max(1, bounds.height), MAX_ZOOM),
        MIN_ZOOM,
        MAX_ZOOM,
      );
      return {
        zoom: scale,
        x: (size.width - bounds.width * scale) / 2 - bounds.x * scale,
        y: (size.height - bounds.height * scale) / 2 - bounds.y * scale,
      } satisfies Viewport;
    },
    [size],
  );

  const fitAllNodes = useCallback(
    (padding: number) => {
      if (nodes.length === 0 || size.width === 0) return;
      const minX = Math.min(...nodes.map((n) => n.position.x));
      const minY = Math.min(...nodes.map((n) => n.position.y));
      const maxX = Math.max(...nodes.map((n) => n.position.x + (n.width ?? defaultNodeWidth)));
      const maxY = Math.max(...nodes.map((n) => n.position.y + (n.height ?? defaultNodeHeight)));
      const fitted = fitToBounds(
        { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
        padding,
      );
      if (fitted) setViewport(fitted);
    },
    [nodes, size, defaultNodeWidth, defaultNodeHeight, fitToBounds],
  );

  useEffect(() => {
    const cancel = subscribeCommands((cmd) => {
      if (cmd.type === 'set') {
        setViewport({
          x: cmd.viewport.x,
          y: cmd.viewport.y,
          zoom: clamp(cmd.viewport.zoom, MIN_ZOOM, MAX_ZOOM),
        });
      } else if (cmd.type === 'zoomTo') {
        setViewport((p) => ({ ...p, zoom: clamp(cmd.zoom, MIN_ZOOM, MAX_ZOOM) }));
      } else if (cmd.type === 'fitBounds') {
        const fitted = fitToBounds(cmd.bounds, cmd.padding);
        if (fitted) setViewport(fitted);
      } else if (cmd.type === 'fitAll') {
        fitAllNodes(cmd.padding);
      }
    });
    return cancel;
  }, [fitToBounds, fitAllNodes]);

  // ─── Coordinate conversion ─────────────────────────────────────
  const screenToCanvas = useCallback(
    (screen: { x: number; y: number }) => ({
      x: (screen.x - viewport.x) / viewport.zoom,
      y: (screen.y - viewport.y) / viewport.zoom,
    }),
    [viewport],
  );

  const canvasToScreen = useCallback(
    (canvas: { x: number; y: number }) => ({
      x: canvas.x * viewport.zoom + viewport.x,
      y: canvas.y * viewport.zoom + viewport.y,
    }),
    [viewport],
  );

  const viewportApi = useMemo<ViewportApi>(
    () => ({
      screenToCanvas,
      canvasToScreen,
      panBy: (dx, dy) => setViewport((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
      zoomIn: () => setViewport((p) => ({ ...p, zoom: clamp(p.zoom * 1.2, MIN_ZOOM, MAX_ZOOM) })),
      zoomOut: () => setViewport((p) => ({ ...p, zoom: clamp(p.zoom / 1.2, MIN_ZOOM, MAX_ZOOM) })),
      zoomTo: (zoom) => setViewport((p) => ({ ...p, zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM) })),
      fitView: () => fitAllNodes(60),
      focus: () => svgRef.current?.focus(),
    }),
    [screenToCanvas, canvasToScreen, fitAllNodes],
  );

  // ─── Pointer plumbing ──────────────────────────────────────────
  const getEventPos = (e: React.PointerEvent | React.MouseEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pos = getEventPos(e);
    if (drawTool === 'section') {
      // Drawing a section: anchor at the press point, reveal the rectangle on move,
      // and commit on pointer-up (instead of dragging/panning the canvas).
      setDrag({ mode: 'draw-section', startX: pos.x, startY: pos.y, drawStart: pos });
      return;
    }
    setDrag({ mode: 'pan', startX: pos.x, startY: pos.y, viewportStart: { ...viewport } });
    onBackgroundClick?.();
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const pos = getEventPos(e);
    if (drag?.mode === 'connect' && drag.from) {
      const canvasPos = screenToCanvas(pos);
      setTempEdge({
        from: { x: drag.from.x, y: drag.from.y, handle: drag.from.handle },
        cursor: canvasPos,
      });
      return;
    }
    if (!drag) return;
    if (drag.mode === 'draw-section') {
      setDrag((d) => (d ? { ...d, drawEnd: pos } : d));
      return;
    }
    if (drag.mode === 'pan' && drag.viewportStart) {
      const dx = pos.x - drag.startX;
      const dy = pos.y - drag.startY;
      setViewport((p) => ({
        ...p,
        x: drag.viewportStart!.x + dx,
        y: drag.viewportStart!.y + dy,
      }));
    }
    // Node drags are handled entirely by the overlay node's own pointer handlers
    // (it captures the pointer on press), so no 'node' branch is needed here.
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag?.mode === 'draw-section' && drag.drawStart && onDrawSection) {
      const end = drag.drawEnd ?? getEventPos(e);
      const a = screenToCanvas(drag.drawStart);
      const b = screenToCanvas(end);
      onDrawSection({
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.max(40, Math.abs(b.x - a.x)),
        height: Math.max(30, Math.abs(b.y - a.y)),
      });
      setDrawTool(null);
    }
    if (drag?.mode === 'connect' && drag.from) {
      const canvasPos = screenToCanvas(getEventPos(e));
      const hit = hitTestTargetHandle(canvasPos);
      if (hit && hit.nodeId !== drag.from.nodeId) {
        onConnect({ source: drag.from.nodeId, target: hit.nodeId });
      }
      setTempEdge(null);
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Pointer capture was never acquired (or already released); nothing to do.
    }
    setDrag(null);
  };

  const getNodePosition = (id: string) => nodes.find((n) => n.id === id)?.position ?? { x: 0, y: 0 };
  void getNodePosition;
  // Edge selection is handled by the registered edge renderers (Phase 7), which invoke
  // this via their own pointer handlers.
  void onEdgesChange;

  const hitTestTargetHandle = (canvasPos: { x: number; y: number }): { nodeId: string } | null => {
    for (const node of nodes) {
      const layout = getHandleLayout(node.type);
      for (const handle of layout.handles) {
        if (handle.id !== 'target') continue;
        const anchor = resolveHandleAnchor(
          handle,
          node.position,
          node.width ?? defaultNodeWidth,
          node.height ?? defaultNodeHeight,
        );
        const d = Math.hypot(anchor.x - canvasPos.x, anchor.y - canvasPos.y);
        if (d < 20) return { nodeId: node.id };
      }
    }
    return null;
  };

  const handleConnectStart = (
    nodeId: string,
    handle: 'source' | 'target',
    e: React.PointerEvent,
  ) => {
    // Capture on the SVG, not the handle. The temp-edge tracking and connection
    // completion live in the SVG's pointer handlers, and the handles now render
    // in the HTML overlay (a sibling of the SVG, outside its event path), so
    // capturing on the handle would starve the drag of move/up events.
    svgRef.current?.setPointerCapture(e.pointerId);
    // Seed the drag from the true handle anchor in canvas space so the temp edge
    // starts at the dot, and so `from` matches the canvas-space cursor that
    // handlePointerMove writes into tempEdge.
    let anchor = screenToCanvas(getEventPos(e));
    const node = nodes.find((n) => n.id === nodeId);
    if (node) {
      const layout = getHandleLayout(node.type);
      const def = layout.handles.find((h) => h.id === handle);
      if (def) {
        anchor = resolveHandleAnchor(
          def,
          node.position,
          node.width ?? defaultNodeWidth,
          node.height ?? defaultNodeHeight,
        );
      }
    }
    setDrag({
      mode: 'connect',
      startX: anchor.x,
      startY: anchor.y,
      from: { nodeId, handle, x: anchor.x, y: anchor.y },
    });
    setTempEdge({ from: { x: anchor.x, y: anchor.y, handle }, cursor: anchor });
  };

  const handleConnectEnd = () => {
    // Pointer-up lands on the SVG (it holds capture for the drag); completion is
    // done in handlePointerUp. Kept to satisfy the NodeRenderer contract.
  };

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const pos = getEventPos(e);
    // Ctrl/Cmd — and a trackpad pinch, which the browser reports as ctrl+wheel —
    // zoom about the cursor. A plain wheel / two-finger scroll pans the viewport.
    if (e.ctrlKey || e.metaKey) {
      setViewport((p) => {
        const newZoom = clamp(p.zoom * (e.deltaY > 0 ? 1 / 1.1 : 1.1), MIN_ZOOM, MAX_ZOOM);
        const zf = newZoom / p.zoom;
        return {
          zoom: newZoom,
          x: pos.x - (pos.x - p.x) * zf,
          y: pos.y - (pos.y - p.y) * zf,
        };
      });
      return;
    }
    setViewport((p) => ({ ...p, x: p.x - e.deltaX, y: p.y - e.deltaY }));
  };

  // ─── Edge rendering ────────────────────────────────────────────

  const renderEdges = () => {
    const anchors = new Map<string, Record<string, { x: number; y: number }>>();
    for (const node of nodes) {
      const layout = getHandleLayout(node.type);
      const map: Record<string, { x: number; y: number }> = {};
      for (const handle of layout.handles) {
        map[handle.id] = resolveHandleAnchor(
          handle,
          node.position,
          node.width ?? defaultNodeWidth,
          node.height ?? defaultNodeHeight,
        );
      }
      anchors.set(node.id, map);
    }
    const rendered = edges.map((edge) => {
      // Always render a stable element for every edge. Edge renderers such as
      // SyncEdge/AsyncEdge call hooks (useState, useSimulationStore), so a
      // conditional `null` here (e.g. when a source/target anchor is missing)
      // would toggle the number of hook-calling child components across renders
      // and violate the Rules of Hooks — "Rendered more hooks than during the
      // previous render." Fall back to a zero anchor so the renderer is always
      // mounted; the dangling edge simply draws to the origin.
      const src = anchors.get(edge.source);
      const tgt = anchors.get(edge.target);
      const source = src?.source ?? { x: 0, y: 0 };
      const target = tgt?.target ?? { x: 0, y: 0 };
      const ctx: EdgeRenderContext = {
        id: edge.id,
        data: edge.data,
        selected: edge.selected ?? false,
        source,
        target,
      };
      const Renderer = edgeRegistry[edge.type];
      if (!Renderer) {
        const d = getBezierPath(source, target, 'right', 'left');
        return (
          <path
            key={edge.id}
            d={d}
            fill="none"
            stroke={edge.selected ? '#b8402e' : '#5b5347'}
            strokeWidth={edge.selected ? 3 : 2}
            markerEnd={edge.type === 'SYNC' ? 'url(#edge-arrow)' : undefined}
          />
        );
      }
      return (
        <g key={edge.id}>
          <Renderer {...ctx} />
        </g>
      );
    });
    return rendered;
  };

  // ─── Node rendering (SVG foreignObject — removed for overlay) ───

  // ─── HTML Overlay Node Rendering ───────────────────────────────────
  // Nodes are rendered as absolutely positioned HTML in an overlay layer
  // above the SVG. This avoids Safari's foreignObject rendering bug where
  // HTML inside a transformed <g> is invisible on Safari (macOS + iOS).
  const renderNodesOverlay = () => {
    const ordered = [...nodes].sort(
      (a, b) => Number(isVisualNode(b)) - Number(isVisualNode(a)),
    );
    return ordered.map((node) => {
      const Renderer = nodeRegistry[node.type];
      const dta = node.data as { width?: number; height?: number };
      const width = (dta.width ?? node.width) || defaultNodeWidth;
      const height = (dta.height ?? node.height) || defaultNodeHeight;
      if (!Renderer) {
        return <div key={node.id} />;
      }
      const props: NodeRendererProps = {
        id: node.id,
        data: node.data,
        selected: node.selected ?? false,
        width,
        height,
        onConnectStart: (handle, e) => {
          e.stopPropagation();
          handleConnectStart(node.id, handle, e);
        },
        onConnectEnd: handleConnectEnd,
        onNodeClick: (id) => onNodeSelect?.(id),
        onEdit: (id, patch) => onEditNode?.(id, patch),
      };
      return (
        <div
          key={node.id}
          // `touch-none` (touch-action: none) is required for the drag: without
          // it iOS Safari claims the touch for a page pan/zoom and fires
          // pointercancel, aborting the move.
          className="absolute touch-none pointer-events-auto"
          style={{
            left: `${node.position.x}px`,
            top: `${node.position.y}px`,
            width: `${width}px`,
            height: `${height}px`,
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            // Raw client coords for the whole drag — down/move/up all read
            // e.clientX/Y, so the delta stays in one coordinate space. The pixel
            // delta is divided by zoom to convert to canvas units.
            setDrag({
              mode: 'node',
              startX: e.clientX,
              startY: e.clientY,
              nodeId: node.id,
              startPos: { ...node.position },
            });
            if (!node.selected) {
              onNodesChange([{ type: 'select', id: node.id, selected: true }]);
            }
          }}
          onPointerMove={(e) => {
            if (!drag || drag.mode !== 'node' || drag.nodeId !== node.id || !drag.startPos) return;
            const dx = (e.clientX - drag.startX) / viewport.zoom;
            const dy = (e.clientY - drag.startY) / viewport.zoom;
            onNodesChange([
              {
                type: 'position',
                id: drag.nodeId,
                position: { x: drag.startPos.x + dx, y: drag.startPos.y + dy },
                dragging: true,
              },
            ]);
          }}
          onPointerUp={(e) => {
            try {
              e.currentTarget.releasePointerCapture(e.pointerId);
            } catch {
              // noop
            }
            if (drag?.mode === 'node' && drag.nodeId === node.id) {
              const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
              if (dist < CLICK_DRAG_THRESHOLD_PX) {
                onNodeSelect?.(node.id);
              }
            }
            setDrag(null);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            onNodeDoubleClick?.(node.id);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onNodeContextMenu?.(node.id, { x: e.clientX, y: e.clientY });
          }}
        >
          {/* No transform here: the overlay layer already applies
              translate+scale(zoom), matching the SVG edge layer's <g>. A second
              scale on the node would compound to zoom². */}
          <Renderer {...props} />
        </div>
      );
    });
  };

  const renderTempEdge = () => {
    if (!tempEdge) return null;
    const from = tempEdge.from;
    const to = tempEdge.cursor;
    const d = getBezierPath(
      { x: from.x, y: from.y },
      { x: to.x, y: to.y },
      from.handle === 'source' ? 'right' : 'left',
      from.handle === 'source' ? 'left' : 'right',
    );
    return <path d={d} fill="none" stroke="#b8402e" strokeWidth={2} strokeDasharray="5 3" />;
  };

  // Live rectangle revealed while dragging out a section (draw tool armed).
  const renderDrawPreview = () => {
    if (drag?.mode !== 'draw-section' || !drag.drawStart || !drag.drawEnd) return null;
    const a = screenToCanvas(drag.drawStart);
    const b = screenToCanvas(drag.drawEnd);
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return (
      <rect
        x={x}
        y={y}
        width={Math.abs(b.x - a.x)}
        height={Math.abs(b.y - a.y)}
        fill="rgba(184,64,46,0.08)"
        stroke="#b8402e"
        strokeWidth={1.5}
        strokeDasharray="6 4"
      />
    );
  };

  return (
    <CanvasContext.Provider value={{ viewport, viewportApi, enterComponent: onEnterComponent }}>
      <div
        ref={containerRef}
        data-testid="canvas-engine"
        className="relative h-full w-full overflow-hidden bg-[#f3ede2]"
        onDrop={(e) => {
          if (!onDrop) return;
          const rect = svgRef.current?.getBoundingClientRect();
          if (!rect) {
            onDrop(null, e);
            return;
          }
          onDrop(
            screenToCanvas({ x: e.clientX - rect.left, y: e.clientY - rect.top }),
            e,
          );
        }}
        onDragOver={onDragOver}
      >
        <svg
          ref={svgRef}
          width={size.width}
          height={size.height}
          className="block h-full w-full touch-none select-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onWheel={handleWheel}
          style={{
            cursor:
              drawTool === 'section'
                ? 'crosshair'
                : drag?.mode === 'pan'
                  ? 'grabbing'
                  : drag
                    ? 'crosshair'
                    : 'default',
          }}
        >
          <defs>{arrowMarkerDef('edge-arrow', '#5b5347')}</defs>
          <g>{renderBackgroundGrid(size.width, size.height, viewport)}</g>
          <g transform={`translate(${viewport.x}, ${viewport.y}) scale(${viewport.zoom})`}>
            {renderEdges()}
            {renderTempEdge()}
            {renderDrawPreview()}
          </g>
        </svg>
        {/* HTML Overlay Layer — nodes rendered as absolute HTML to avoid Safari's
            foreignObject-in-transformed-<g> bug. Same translate+scale as the SVG
            edge <g>, so the two layers stay registered. No `overflow-hidden`:
            WebKit mis-clips a scaled box and drops nodes/sections at larger
            coordinates — the parent container already clips the viewport. */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
            transformOrigin: '0 0',
          }}
        >
          {renderNodesOverlay()}
        </div>
        {children}
        {showMiniMap && <MiniMap nodes={nodes} viewport={viewport} size={size} />}
      </div>
    </CanvasContext.Provider>
  );
}

// ─── Background grid ─────────────────────────────────────────────

function renderBackgroundGrid(
  width: number,
  height: number,
  viewport: Viewport,
): React.ReactElement {
  // The grid lives in screen space (it renders outside the zoomed <g>), so it
  // must cover the full canvas width/height at any zoom. A canvas grid line at
  // `n * spacing` appears on screen at `viewport.x + n * spacing * zoom`, so use
  // `cell = spacing * zoom` screen pixels between lines, aligned to the viewport.
  const spacing = 20;
  const cell = spacing * viewport.zoom;
  const nMinX = Math.ceil(-viewport.x / cell);
  const nMaxX = Math.floor((width - viewport.x) / cell);
  const nMinY = Math.ceil(-viewport.y / cell);
  const nMaxY = Math.floor((height - viewport.y) / cell);
  const lines: React.ReactElement[] = [];
  for (let n = nMinX; n <= nMaxX; n++) {
    const x = viewport.x + n * cell;
    lines.push(<line key={`v${n}`} x1={x} y1={0} x2={x} y2={height} stroke="#5b534733" />);
  }
  for (let n = nMinY; n <= nMaxY; n++) {
    const y = viewport.y + n * cell;
    lines.push(<line key={`h${n}`} x1={0} y1={y} x2={width} y2={y} stroke="#5b534733" />);
  }
  return <g>{lines}</g>;
}

// ─── Mini-map ────────────────────────────────────────────────────

function MiniMap({
  nodes,
  viewport,
  size,
}: {
  nodes: CanvasNode[];
  viewport: Viewport;
  size: { width: number; height: number };
}) {
  const mmWidth = 150;
  const scale = mmWidth / Math.max(size.width, 1);
  const mmHeight = size.height ? Math.max(60, size.height * scale) : 90;
  const contentW = size.width / viewport.zoom;
  const contentH = size.height / viewport.zoom;
  return (
    <div
      className="absolute bottom-3 right-3 overflow-hidden rounded border border-[#5b5347]/30 bg-[#5b5347]/85"
      style={{ width: mmWidth, height: mmHeight, maxHeight: '40%' }}
    >
      <svg width={mmWidth} height={mmHeight} className="block">
        {nodes.map((n) => (
          <rect
            key={n.id}
            x={n.position.x * scale}
            y={n.position.y * scale}
            width={(n.width ?? 140) * scale}
            height={(n.height ?? 80) * scale}
            rx={2}
            fill="#b8402e"
            opacity={0.7}
          />
        ))}
        <rect
          x={(-viewport.x / viewport.zoom) * scale}
          y={(-viewport.y / viewport.zoom) * scale}
          width={contentW * scale}
          height={contentH * scale}
          fill="none"
          stroke="#f3ede2"
          strokeOpacity={0.6}
          strokeWidth={1}
        />
      </svg>
    </div>
  );
}

export function nodeRegistryFromTypes(
  ...components: { type: string; render: NodeRenderer }[]
): NodeRegistry {
  const reg: NodeRegistry = {};
  for (const c of components) reg[c.type] = c.render;
  return reg;
}
