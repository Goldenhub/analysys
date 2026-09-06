import { create } from 'zustand';

// ─── Canvas Draw Tool ─────────────────────────────────────────────
// Lets the palette arm a "draw" tool (e.g. draw a Section by dragging on the
// canvas) instead of placing a fixed-size node. The canvas engine reads the
// active tool on pointer-down and disarms it once a shape is committed.

export type CanvasDrawTool = 'section' | null;

interface CanvasToolState {
  drawTool: CanvasDrawTool;
  setDrawTool: (tool: CanvasDrawTool) => void;
}

export const useCanvasToolStore = create<CanvasToolState>((set) => ({
  drawTool: null,
  setDrawTool: (drawTool) => set({ drawTool }),
}));
