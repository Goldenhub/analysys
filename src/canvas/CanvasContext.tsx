import { createContext, useContext } from 'react';
import type { Viewport, ViewportApi } from './types';

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 2.5;
export const DEFAULT_ZOOM = 1;

// ─── Context ─────────────────────────────────────────────────────

export interface CanvasContextValue {
  viewport: Viewport;
  viewportApi: ViewportApi;
  /** Drill into a node's component layer; absent when the engine has no handler. */
  enterComponent?: (nodeId: string) => void;
}

export const CanvasContext = createContext<CanvasContextValue | null>(null);

export function useCanvas(): CanvasContextValue {
  const ctx = useContext(CanvasContext);
  if (!ctx) {
    throw new Error('useCanvas must be used within a <CanvasEngine>.');
  }
  return ctx;
}

export function useViewport(): Viewport {
  return useCanvas().viewport;
}

export function useViewportApi(): ViewportApi {
  return useCanvas().viewportApi;
}
