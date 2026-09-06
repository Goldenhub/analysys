import { useViewport, useViewportApi } from './CanvasContext';

// ─── Zoom Controls ───────────────────────────────────────────────
// Floating zoom in/out/percentage controls. Styled for the earthy palette.

export function ZoomControls() {
  const viewport = useViewport();
  const api = useViewportApi();
  const pct = Math.round(viewport.zoom * 100);

  return (
    <div className="absolute bottom-3 left-3 z-10 flex items-center gap-1 rounded-lg border border-[#5b5347]/30 bg-[#5b5347]/90 px-1 py-1 shadow-lg backdrop-blur-sm">
      <button
        type="button"
        onClick={() => api.zoomOut()}
        aria-label="Zoom out"
        className="flex h-6 w-6 items-center justify-center rounded text-[#f3ede2]/80 transition-colors hover:bg-[#b8402e]/70 hover:text-[#f3ede2]"
      >
        −
      </button>
      <button
        type="button"
        onClick={() => api.zoomTo(1)}
        aria-label="Reset zoom"
        className="min-w-[44px] rounded px-1 text-center font-mono text-[10px] text-[#f3ede2]/85 transition-colors hover:bg-[#5b5347]/60 hover:text-[#f3ede2]"
      >
        {pct}%
      </button>
      <button
        type="button"
        onClick={() => api.zoomIn()}
        aria-label="Zoom in"
        className="flex h-6 w-6 items-center justify-center rounded text-[#f3ede2]/80 transition-colors hover:bg-[#b8402e]/70 hover:text-[#f3ede2]"
      >
        +
      </button>
    </div>
  );
}
