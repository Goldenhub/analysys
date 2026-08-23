import { create } from 'zustand';

interface AnalysisPanelState {
  isOpen: boolean;
  toggle: () => void;
  close: () => void;
  open: () => void;
}

export const useAnalysisPanelStore = create<AnalysisPanelState>()((set) => ({
  isOpen: false,
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  close: () => set({ isOpen: false }),
  open: () => set({ isOpen: true }),
}));
