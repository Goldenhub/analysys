import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NodeType } from '@/types/nodes';
import { useTopologyStore } from '@/store/topologyStore';
import type { AnalysysNode } from '@/types/nodes';
import { createDefaultNodeData } from '@/types/nodeDefaults';
import { CONNECTION_RULES, getValidProtocols } from '@/validation/edgeValidation';
import { EdgeProtocol } from '@/types/edges';
import { SECTION_NODE_TYPE, TEXT_NOTE_NODE_TYPE } from '@/canvas';
import { createTextNoteNode } from '@/canvas';
import { useCanvasToolStore } from '@/store/canvasToolStore';
import { getViewportState } from '@/canvas/viewportBus';
import { placePaletteNode } from '@/canvas/palettePlacement';
import { ChevronDown, ChevronRight } from 'lucide-react';

// ─── Palette Item Definition ─────────────────────────────────────

type PaletteNodeType = NodeType | typeof SECTION_NODE_TYPE | typeof TEXT_NOTE_NODE_TYPE;

function isVisualPaletteType(nodeType: PaletteNodeType): boolean {
  return nodeType === SECTION_NODE_TYPE || nodeType === TEXT_NOTE_NODE_TYPE;
}

interface PaletteItem {
  nodeType: PaletteNodeType;
  label: string;
  icon: React.ReactNode;
}

interface PaletteCategory {
  name: string;
  items: PaletteItem[];
}

// ─── Icons (inline SVG) ──────────────────────────────────────────

function TrafficGeneratorIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.348 14.652a3.75 3.75 0 0 1 0-5.304m5.304 0a3.75 3.75 0 0 1 0 5.304m-7.425 2.121a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
      />
    </svg>
  );
}

function SchedulerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
      />
    </svg>
  );
}

function ApiGatewayIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 17l5-5-5-5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12H3" />
    </svg>
  );
}

function RateLimiterIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18l-7 8v7l-4 2v-9L3 4z" />
    </svg>
  );
}

function CircuitBreakerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M18.36 6.64a9 9 0 1 1-12.73 0" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v10" />
    </svg>
  );
}

function AuthServiceIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z"
      />
    </svg>
  );
}

function AuthzServiceIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"
      />
    </svg>
  );
}

function LoadBalancerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
      />
    </svg>
  );
}

function AppServerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5.25 14.25h13.5m-13.5 0a3 3 0 0 1-3-3m3 3a3 3 0 1 0 0 6h13.5a3 3 0 1 0 0-6m-13.5-3a3 3 0 0 1 0-6h13.5a3 3 0 1 1 0 6M6 6.75h.008v.008H6V6.75Zm0 7.5h.008v.008H6v-.008Zm0 7.5h.008v.008H6v-.008Z"
      />
    </svg>
  );
}

function WorkerPoolIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z"
      />
    </svg>
  );
}

function CacheIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z"
      />
    </svg>
  );
}

function DatabaseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125"
      />
    </svg>
  );
}

function ObjectStoreIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 3.75v3.75m-16.5-3.75v3.75"
      />
    </svg>
  );
}

function MessageQueueIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.429 9.75 2.25 12l4.179 2.25m0-4.5 5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L12 12.75l-5.571-3m11.142 0L21.75 12l-4.179 2.25m0 0L12 17.25l-5.571-3m11.142 0L21.75 16.5 12 21.75l-9.75-5.25 4.179-2.25"
      />
    </svg>
  );
}

function DeadLetterQueueIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m6 4.125 2.25 2.25m0 0 2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z"
      />
    </svg>
  );
}

function SectionIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
      />
    </svg>
  );
}

function TextNoteIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125"
      />
    </svg>
  );
}

// ─── Node Descriptions ───────────────────────────────────────────

const NODE_DESCRIPTIONS: Record<NodeType, string> = {
  [NodeType.TrafficGenerator]:
    'Generates incoming requests at a configurable rate and distribution. Acts as the entry point for simulated traffic.',
  [NodeType.Scheduler]:
    'Emits requests on a periodic schedule with configurable overlap policies. Useful for batch job patterns.',
  [NodeType.ApiGateway]:
    'Routes, authenticates, and rate-limits incoming requests before forwarding to internal services.',
  [NodeType.RateLimiter]:
    'Token-bucket rate limiter that admits requests up to a sustained rate and burst capacity.',
  [NodeType.CircuitBreaker]:
    'Monitors downstream error rates and trips open to prevent cascading failures.',
  [NodeType.AuthService]:
    'Authenticates requests by verifying credentials. Adds latency for token verification.',
  [NodeType.AuthzService]:
    'Authorizes requests by checking permissions and policies against cached rules.',
  [NodeType.LoadBalancer]:
    'Distributes requests across multiple downstream targets using round-robin or least-connections.',
  [NodeType.AppServer]:
    'Processes requests using a thread pool with configurable concurrency and processing latency.',
  [NodeType.WorkerPool]:
    'Background task processor that pulls work from queues and processes asynchronously.',
  [NodeType.Cache]:
    'In-memory cache with configurable hit ratio and eviction policy. Cache hits bypass the database.',
  [NodeType.Database]:
    'Persistent data store with connection pooling. Terminal node (no outgoing connections).',
  [NodeType.ObjectStore]:
    'Blob/object storage (e.g., S3). Terminal node (no outgoing connections).',
  [NodeType.MessageQueue]:
    'Asynchronous message buffer with backpressure. Decouples producers from consumers.',
  [NodeType.DeadLetterQueue]:
    'Stores failed/undeliverable messages for later inspection or reprocessing.',
};

/** Friendly label for a NodeType enum value */
function nodeTypeLabel(nt: NodeType): string {
  return nt
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Derive which node types can connect TO a given target */
function getAllowedInputs(target: NodeType): NodeType[] {
  const inputs: NodeType[] = [];
  for (const [sourceType, rules] of Object.entries(CONNECTION_RULES)) {
    if (rules.allowedTargets.includes(target)) {
      inputs.push(sourceType as NodeType);
    }
  }
  return inputs;
}

/** Human label for a pair's permitted protocols, e.g. "Sync", "Async", "Sync/Async". */
function protocolLabel(protocols: EdgeProtocol[]): string {
  if (protocols.length === 0) return '';
  const hasSync = protocols.includes(EdgeProtocol.Sync);
  const hasAsync = protocols.includes(EdgeProtocol.Async);
  return hasSync && hasAsync ? 'Sync/Async' : hasAsync ? 'Async' : 'Sync';
}

// ─── Palette Categories (R29.1 five groups) ──────────────────────

const PALETTE_CATEGORIES: PaletteCategory[] = [
  {
    name: 'Sources',
    items: [
      {
        nodeType: NodeType.TrafficGenerator,
        label: 'Traffic Generator',
        icon: <TrafficGeneratorIcon />,
      },
      { nodeType: NodeType.Scheduler, label: 'Scheduler', icon: <SchedulerIcon /> },
    ],
  },
  {
    name: 'Admission',
    items: [
      { nodeType: NodeType.ApiGateway, label: 'API Gateway', icon: <ApiGatewayIcon /> },
      { nodeType: NodeType.RateLimiter, label: 'Rate Limiter', icon: <RateLimiterIcon /> },
      { nodeType: NodeType.CircuitBreaker, label: 'Circuit Breaker', icon: <CircuitBreakerIcon /> },
      { nodeType: NodeType.AuthService, label: 'Auth Service', icon: <AuthServiceIcon /> },
      { nodeType: NodeType.AuthzService, label: 'Authz Service', icon: <AuthzServiceIcon /> },
    ],
  },
  {
    name: 'Compute',
    items: [
      { nodeType: NodeType.LoadBalancer, label: 'Load Balancer', icon: <LoadBalancerIcon /> },
      { nodeType: NodeType.AppServer, label: 'App Server', icon: <AppServerIcon /> },
      { nodeType: NodeType.WorkerPool, label: 'Worker Pool', icon: <WorkerPoolIcon /> },
    ],
  },
  {
    name: 'Data',
    items: [
      { nodeType: NodeType.Cache, label: 'Cache', icon: <CacheIcon /> },
      { nodeType: NodeType.Database, label: 'Database', icon: <DatabaseIcon /> },
      { nodeType: NodeType.ObjectStore, label: 'Object Store', icon: <ObjectStoreIcon /> },
    ],
  },
  {
    name: 'Messaging',
    items: [
      { nodeType: NodeType.MessageQueue, label: 'Message Queue', icon: <MessageQueueIcon /> },
      {
        nodeType: NodeType.DeadLetterQueue,
        label: 'Dead Letter Queue',
        icon: <DeadLetterQueueIcon />,
      },
    ],
  },
  {
    name: 'Annotations',
    items: [
      { nodeType: SECTION_NODE_TYPE, label: 'Section', icon: <SectionIcon /> },
      { nodeType: TEXT_NOTE_NODE_TYPE, label: 'Text Note', icon: <TextNoteIcon /> },
    ],
  },
];

// ─── Palette Item Component ──────────────────────────────────────

interface PaletteItemComponentProps {
  item: PaletteItem;
  parentNodeId: string | null;
}

interface PaletteTouchDrag {
  nodeType: PaletteNodeType;
  icon: React.ReactNode;
  label: string;
  x: number;
  y: number;
  overCanvas: boolean;
}

// ─── Shared heuristics kept at module scope so tests stay deterministic ──

/** Swipe this far toward the palette's right edge to lift a node immediately. */
const TOUCH_DRAG_ACTIVATE_DISTANCE_PX = 14;
/** Vertical movement beyond this (while the drag is not yet lifted) is a palette scroll. */
const TOUCH_DRAG_SCROLL_SLOP_PX = 10;
/** Holding still this long also lifts the node (grab-in-place). */
const TOUCH_DRAG_LONG_PRESS_MS = 300;
/** The canvas engine container exposes this marker for drop-target detection. */
const CANVAS_ENGINE_SELECTOR = '[data-testid="canvas-engine"]';

/** True on touch screens, where the native HTML5 drag must not be engaged. */
function isCoarsePointerDevice() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: coarse)').matches
    : false;
}

function PaletteItemComponent({ item, parentNodeId }: PaletteItemComponentProps) {
  const addNode = useTopologyStore((s) => s.addNode);
  const drawTool = useCanvasToolStore((s) => s.drawTool);
  const setDrawTool = useCanvasToolStore((s) => s.setDrawTool);
  const [showTooltip, setShowTooltip] = useState(false);
  const infoBtnRef = useRef<HTMLButtonElement>(null);
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });

  const visual = isVisualPaletteType(item.nodeType);
  // Sections are NOT drop-placeable nodes. Clicking the palette item arms a
  // "draw section" tool so the user can drag a rectangle out on the canvas.
  const isSection = item.nodeType === SECTION_NODE_TYPE;
  const sectionArmed = drawTool === 'section';

  const rules = visual
    ? { allowedTargets: [] as NodeType[] }
    : CONNECTION_RULES[item.nodeType as NodeType];
  const allowedOutputs = rules.allowedTargets;
  const allowedInputs = visual ? [] : getAllowedInputs(item.nodeType as NodeType);

  // ─── Touch drag + tap-to-place ─────────────────────────────────
  // HTML5 drag-and-drop does not fire from touch, so node items get a
  // pointer-event counterpart: swiping right (toward the canvas) or holding
  // still lifts the item into a floating ghost that can be dropped onto the
  // canvas. Vertical motion belongs to the palette scroll. A quick tap places
  // the node at the canvas center (mirroring the Enter keyboard path).
  const [touchDrag, setTouchDrag] = useState<PaletteTouchDrag | null>(null);
  const dragTimerRef = useRef<number | null>(null);
  const dragModeRef = useRef<'idle' | 'pending' | 'active'>('idle');
  const dragRef = useRef<{
    pointerId: number;
    item: PaletteItem;
    startX: number;
    startY: number;
  } | null>(null);
  const didDragRef = useRef(false);
  const lastPointerTypeRef = useRef('');

  function isCanvasAt(x: number, y: number) {
    try {
      const el = document.elementFromPoint(x, y);
      return !!el?.closest?.(CANVAS_ENGINE_SELECTOR);
    } catch {
      return false;
    }
  }

  function dropAt(clientX: number, clientY: number, nodeType: PaletteNodeType) {
    const svg = document.querySelector<SVGElement>(`${CANVAS_ENGINE_SELECTOR} svg`);
    const rect = svg?.getBoundingClientRect();
    if (!rect) return;
    const { viewport } = getViewportState();
    const canvasPos = {
      x: (clientX - rect.left - viewport.x) / viewport.zoom,
      y: (clientY - rect.top - viewport.y) / viewport.zoom,
    };
    placePaletteNode(nodeType as string, canvasPos, parentNodeId);
  }

  function tearDownWindowListeners() {
    window.removeEventListener('pointermove', onWindowPointerMove);
    window.removeEventListener('pointerup', onWindowPointerUp);
    window.removeEventListener('pointercancel', onWindowPointerCancel);
  }

  function cancelGesture() {
    dragModeRef.current = 'idle';
    dragRef.current = null;
    if (dragTimerRef.current) {
      window.clearTimeout(dragTimerRef.current);
      dragTimerRef.current = null;
    }
    tearDownWindowListeners();
    setTouchDrag(null);
    document.body.style.touchAction = '';
  }

  /** Lift the item off the palette (ghost follows from here on). */
  function activateDrag(e: PointerEvent | null) {
    if (dragModeRef.current !== 'pending') return;
    const drag = dragRef.current;
    if (!drag) return;
    dragModeRef.current = 'active';
    if (dragTimerRef.current) {
      window.clearTimeout(dragTimerRef.current);
      dragTimerRef.current = null;
    }
    didDragRef.current = true;
    const x = e?.clientX ?? drag.startX;
    const y = e?.clientY ?? drag.startY;
    setTouchDrag({
      nodeType: drag.item.nodeType,
      icon: drag.item.icon,
      label: drag.item.label,
      x,
      y,
      overCanvas: isCanvasAt(x, y),
    });
    // Freeze the browser's native scrolling/zooming for the rest of the gesture.
    document.body.style.touchAction = 'none';
  }

  function onWindowPointerMove(e: PointerEvent) {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (dragModeRef.current === 'idle') return;

    if (dragModeRef.current === 'pending') {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      // Vertical motion before the pickup is the palette scrolling — stay out of
      // its way (no preventDefault, so the scroll proceeds).
      if (Math.abs(dy) > TOUCH_DRAG_SCROLL_SLOP_PX && Math.abs(dy) > Math.abs(dx)) {
        cancelGesture();
        return;
      }
      // Rightward pursuit of the canvas lifts the node immediately.
      if (Math.abs(dx) > TOUCH_DRAG_ACTIVATE_DISTANCE_PX) {
        activateDrag(e);
        return;
      }
      return;
    }

    setTouchDrag((prev) =>
      prev ? { ...prev, x: e.clientX, y: e.clientY, overCanvas: isCanvasAt(e.clientX, e.clientY) } : prev,
    );
  }

  function onWindowPointerUp(e: PointerEvent) {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;

    if (dragModeRef.current === 'active') {
      if (isCanvasAt(e.clientX, e.clientY)) {
        dropAt(e.clientX, e.clientY, drag.item.nodeType);
      }
    }

    cancelGesture();
  }

  function onWindowPointerCancel(e: PointerEvent) {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    // The browser reclaimed the gesture (scroll/zoom/long-press). Never treat a
    // cancel as a drop — just put the palette back the way it was.
    cancelGesture();
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    lastPointerTypeRef.current = e.pointerType;
    // Mouse keeps the native HTML5 drag; touch needs the custom path.
    if (e.pointerType !== 'touch') return;

    dragRef.current = { pointerId: e.pointerId, item, startX: e.clientX, startY: e.clientY };
    dragModeRef.current = 'pending';
    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('pointercancel', onWindowPointerCancel);
    dragTimerRef.current = window.setTimeout(() => activateDrag(null), TOUCH_DRAG_LONG_PRESS_MS);
  }

  // Tear down any in-flight drag if the item unmounts mid-gesture.
  useEffect(
    () => () => {
      if (dragTimerRef.current) window.clearTimeout(dragTimerRef.current);
      dragRef.current = null;
      dragModeRef.current = 'idle';
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('pointercancel', onWindowPointerCancel);
      document.body.style.touchAction = '';
    },
    // The window handlers are intentionally re-created per render (they close
    // over this item's props); the effect only binds the unmount cleanup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const onDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.dataTransfer.setData('application/analysys-node-type', item.nodeType);
      event.dataTransfer.effectAllowed = 'move';
    },
    [item.nodeType],
  );

  const placeAtCenter = useCallback(() => {
    if (isSection) {
      setDrawTool(sectionArmed ? null : 'section');
      return;
    }
    const position = { x: 250, y: 250 };
    if (visual) {
      if (item.nodeType === TEXT_NOTE_NODE_TYPE) {
        addNode(createTextNoteNode(position));
        return;
      }
      return;
    }
    const nodeData = createDefaultNodeData(item.nodeType as NodeType, position);
    const newNode: AnalysysNode = {
      id: nodeData.id,
      type: nodeData.nodeType,
      position,
      data: nodeData as AnalysysNode['data'],
    };
    addNode(newNode);
  }, [item.nodeType, visual, addNode, isSection, setDrawTool, sectionArmed]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (isSection) {
          setDrawTool(sectionArmed ? null : 'section');
          return;
        }
        placeAtCenter();
      }
    },
    [isSection, setDrawTool, sectionArmed, placeAtCenter],
  );

  const toggleTooltip = useCallback(() => {
    if (!showTooltip && infoBtnRef.current) {
      const rect = infoBtnRef.current.getBoundingClientRect();
      setTooltipPos({ top: rect.top, left: rect.right + 8 });
    }
    setShowTooltip((prev) => !prev);
  }, [showTooltip]);

  return (
    <div className="group relative flex items-center gap-1">
      <div
        draggable={!isSection && !isCoarsePointerDevice()}
        onDragStart={onDragStart}
        onPointerDown={onPointerDown}
        onClick={() => {
          if (isSection) {
            setDrawTool(sectionArmed ? null : 'section');
            return;
          }
          // Touch tap-to-place: a quick tap adds the node at center. A completed
          // drag suppresses this so the drop isn't followed by a duplicate.
          if (lastPointerTypeRef.current === 'touch' && !didDragRef.current) {
            placeAtCenter();
          }
          didDragRef.current = false;
        }}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="button"
        aria-pressed={isSection ? sectionArmed : undefined}
        aria-label={
          isSection
            ? sectionArmed
              ? 'Section drawing tool active. Click again to cancel, then drag on the canvas to draw.'
              : 'Section drawing tool. Click to activate, then drag on the canvas to draw a section.'
            : `Add ${item.label} node. Drag to canvas or press Enter to place.`
        }
        className={`flex flex-1 items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors select-none focus:outline-none focus:ring-2 focus:ring-[#b8402e] focus:ring-offset-1 focus:ring-offset-[#fffaf2] ${
          touchDrag?.nodeType === item.nodeType ? 'opacity-40' : ''
        } ${
          isSection
            ? sectionArmed
              ? 'cursor-crosshair border-[#b8402e] bg-[#b8402e]/20 text-[#8b2e1e]'
              : 'cursor-pointer border-[#5b5347]/50 bg-[#5b5347] text-[#f3ede2] hover:border-[#b8402e]/60 hover:bg-[#5b5347]/80'
            : 'cursor-grab border-[#5b5347]/50 bg-[#5b5347] text-[#f3ede2] hover:border-[#5b5347]/70 hover:bg-[#5b5347]/80 active:cursor-grabbing'
        }`}
      >
        <span className="flex-shrink-0 opacity-80">{item.icon}</span>
        <span className="truncate">{item.label}</span>
      </div>
      {/* Ghost lifted during a touch drag — positioned fixed so the pointer can
          leave the palette entirely; portal to body because the drawer's
          translate transform would otherwise serve as the positioning context. */}
      {touchDrag &&
        createPortal(
          <div
            className={`pointer-events-none fixed z-[60] flex items-center gap-2 rounded-md border px-3 py-2 text-sm shadow-xl ${
              touchDrag.overCanvas
                ? 'border-[#b8402e] bg-[#8b2e1e] text-[#fffaf2]'
                : 'border-[#5b5347]/60 bg-[#5b5347] text-[#f3ede2]'
            }`}
            style={{ left: touchDrag.x + 12, top: touchDrag.y + 10 }}
            role="status"
          >
            <span className="flex-shrink-0 opacity-80">{touchDrag.icon}</span>
            <span className="truncate">{touchDrag.label}</span>
          </div>,
          document.body,
        )}
      {/* Info button */}
      <button
        ref={infoBtnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggleTooltip();
        }}
        onBlur={() => setShowTooltip(false)}
        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[10px] text-[#5b5347]/70 hover:bg-[#5b5347]/10 hover:text-[#5b5347] focus:outline-none focus:ring-1 focus:ring-[#b8402e]"
        aria-label="Show node connection details"
      >
        ?
      </button>
      {/* Tooltip popover — rendered via portal to avoid sidebar overflow */}
      {showTooltip &&
        createPortal(
          <div
            className="fixed z-[9999] w-64 rounded-lg border border-[#5b5347]/30 bg-[#5b5347] p-3 text-[11px] shadow-xl"
            style={{ top: tooltipPos.top, left: tooltipPos.left }}
          >
            <p className="mb-2 text-[#f3ede2]/80">
              {visual
                ? item.nodeType === SECTION_NODE_TYPE
                  ? 'A labelled container rectangle for visually grouping and organising nodes on the canvas. Does not affect simulation.'
                  : 'A sticky-note style box for adding free-form text notes to the canvas. Does not affect simulation.'
                : NODE_DESCRIPTIONS[item.nodeType as NodeType]}
            </p>
            {!visual && (
              <div className="space-y-1.5">
                {allowedOutputs.length > 0 ? (
                  <div>
                    <span className="font-semibold text-[#f3ede2]/60">Can connect to: </span>
                    <span className="text-[#f3ede2]/80">
                      {allowedOutputs
                        .map((targetType) => {
                          const protocols = getValidProtocols(
                            item.nodeType as NodeType,
                            targetType,
                          );
                          return `${nodeTypeLabel(targetType)} (${protocolLabel(protocols)})`;
                        })
                        .join(', ')}
                    </span>
                  </div>
                ) : (
                  <div>
                    <span className="font-semibold text-[#f3ede2]/60">Can connect to: </span>
                    <span className="text-[#f3ede2]/70 italic">Nothing (terminal node)</span>
                  </div>
                )}
                {allowedInputs.length > 0 ? (
                  <div>
                    <span className="font-semibold text-[#f3ede2]/60">Can receive from: </span>
                    <span className="text-[#f3ede2]/80">
                    {allowedInputs
                      .map((sourceType) => {
                        const protocols = getValidProtocols(sourceType, item.nodeType as NodeType);
                        return `${nodeTypeLabel(sourceType)} (${protocolLabel(protocols)})`;
                      })
                      .join(', ')}
                  </span>
                </div>
              ) : (
                <div>
                  <span className="font-semibold text-[#f3ede2]/60">Can receive from: </span>
                  <span className="text-[#f3ede2]/70 italic">Nothing (source node)</span>
                </div>
              )}
              <p className="border-t border-[#5b5347]/20 pt-1.5 text-[10px] text-[#f3ede2]/70">
                Connections are validated automatically when you drag an edge or import a file.
              </p>
            </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

// ─── Node Palette Component ──────────────────────────────────────

export function NodePalette({ parentNodeId }: { parentNodeId: string | null }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggleCategory = useCallback((name: string) => {
    setCollapsed((prev) => ({ ...prev, [name]: !prev[name] }));
  }, []);

  return (
    <nav aria-label="Node palette" className="flex flex-1 flex-col gap-4 overflow-y-auto min-h-0">
      {PALETTE_CATEGORIES.map((category) => {
        const isOpen = !collapsed[category.name];
        return (
          <div key={category.name}>
            <button
              type="button"
              onClick={() => toggleCategory(category.name)}
              className="flex w-full items-center gap-1 text-left text-xs font-medium uppercase tracking-wider text-[#5b5347]/80 hover:text-[#5b5347]"
              aria-expanded={isOpen}
            >
              {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {category.name}
            </button>
            {isOpen && (
              <div className="mt-1.5 flex flex-col gap-1.5">
                {category.items.map((item) => (
                  <PaletteItemComponent key={item.nodeType} item={item} parentNodeId={parentNodeId} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
