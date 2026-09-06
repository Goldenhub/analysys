// ─── Viewport Bus ────────────────────────────────────────────────
// A lightweight, context-free channel between the canvas engine (which owns the
// viewport) and sibling consumers such as the AnalysisPanel — which are rendered
// outside the engine's React provider but still need to read and drive the viewport
// (e.g. "fit view to this finding's nodes").

import type { Viewport } from './types';

export interface ViewportSnapshot {
  viewport: Viewport;
  size: { width: number; height: number };
}

// ─── Module state ────────────────────────────────────────────────

const EMPTY = { x: 0, y: 0, zoom: 1 };

let viewport = { ...EMPTY };
let size = { width: 0, height: 0 };
const viewportListeners = new Set<() => void>();
const sizeListeners = new Set<() => void>();

// ─── Published state (read side) ─────────────────────────────────

export function subscribeViewport(listener: () => void): () => void {
  viewportListeners.add(listener);
  return () => viewportListeners.delete(listener);
}

export function subscribeSize(listener: () => void): () => void {
  sizeListeners.add(listener);
  return () => sizeListeners.delete(listener);
}

export function getViewportState(): ViewportSnapshot {
  return { viewport: { ...viewport }, size: { ...size } };
}

// ─── Engine writes ───────────────────────────────────────────────

export function publishViewport(next: Viewport): void {
  viewport = { ...next };
  viewportListeners.forEach((l) => l());
}

export function publishSize(next: { width: number; height: number }): void {
  size = { ...next };
  sizeListeners.forEach((l) => l());
}

// ─── Command side (what the engine consumes) ─────────────────────

export type ViewportCommand =
  | { type: 'set'; viewport: Viewport }
  | { type: 'fitBounds'; bounds: { x: number; y: number; width: number; height: number }; padding: number }
  | { type: 'fitAll'; padding: number }
  | { type: 'zoomTo'; zoom: number; center: { x: number; y: number } };

type CommandListener = (cmd: ViewportCommand) => void;
const commandListeners = new Set<CommandListener>();

/** Engine-side: register the handler that applies viewport commands. */
export function subscribeCommands(listener: CommandListener): () => void {
  commandListeners.add(listener);
  return () => commandListeners.delete(listener);
}

/** Consumer-side: request a viewport change (e.g. from the AnalysisPanel). */
export function requestViewportChange(cmd: ViewportCommand): void {
  commandListeners.forEach((l) => l(cmd));
}
