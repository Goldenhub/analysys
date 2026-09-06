import { useToastStore } from './toastStore';

/** Fixed bottom-center viewport for the application toast store. */
export function ToastViewport() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed bottom-6 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-lg border px-4 py-2 text-sm shadow-xl ${
            toast.variant === 'error'
              ? 'border-[#8b2e1e] bg-[#8b2e1e]/10 text-[#8b2e1e]/70'
              : 'border-[#5b5347]/30 bg-[#5b5347]/95 text-[#f3ede2]/90'
          }`}
        >
          <span>{toast.message}</span>
          <button
            onClick={() => dismiss(toast.id)}
            aria-label="Dismiss notification"
            className="shrink-0 rounded px-1 text-base leading-none opacity-70 hover:opacity-100"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
