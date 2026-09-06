import { create } from 'zustand';

export interface ToastItem {
  id: number;
  message: string;
  variant: 'error' | 'info';
}

interface ToastState {
  toasts: ToastItem[];
  push: (message: string, variant?: ToastItem['variant']) => void;
  dismiss: (id: number) => void;
}

const AUTO_DISMISS_MS = 5000;
let nextToastId = 1;

/**
 * Minimal application-wide toast store. Lives in its own module so components
 * and non-component modules can share it without tripping fast-refresh rules.
 */
export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  push: (message, variant = 'error') => {
    const id = nextToastId++;
    set((state) => ({
      // Keep the viewport bounded; oldest toasts fall off.
      toasts: [...state.toasts, { id, message, variant }].slice(-4),
    }));
    setTimeout(() => {
      useToastStore.getState().dismiss(id);
    }, AUTO_DISMISS_MS);
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

/** Fire-and-forget application toast. Callable outside React components. */
export function showToast(message: string, variant: ToastItem['variant'] = 'error'): void {
  useToastStore.getState().push(message, variant);
}
