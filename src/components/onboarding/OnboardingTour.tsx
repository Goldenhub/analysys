import { useEffect, useRef, useState, type CSSProperties } from 'react';

// ─── OnboardingTour ───────────────────────────────────────────────
// First-visit guided tour. Renders a spotlight highlight around the element
// named by each step's `target` selector and a floating card with navigation.
// Completion or dismissal is persisted via localStorage so it only shows once.

export interface OnboardingStep {
  /** CSS selector of the element to highlight (optional — centered card if absent). */
  target?: string;
  title: string;
  body: string;
}

interface OnboardingTourProps {
  steps: OnboardingStep[];
  onFinish: () => void;
  onSkip: () => void;
}

export const ONBOARDING_KEY = 'analysys_onboarding_completed';

export function hasCompletedOnboarding(): boolean {
  return localStorage.getItem(ONBOARDING_KEY) === 'true';
}

export function markOnboardingCompleted(): void {
  localStorage.setItem(ONBOARDING_KEY, 'true');
}

export function resetOnboarding(): void {
  localStorage.removeItem(ONBOARDING_KEY);
}

const CARD_WIDTH = 340;
const CARD_HEIGHT = 190;
const GAP = 14;
const EDGE = 12;

export function OnboardingTour({ steps, onFinish, onSkip }: OnboardingTourProps) {
  const [index, setIndex] = useState(0);
  const nextRef = useRef<HTMLButtonElement>(null);

  const step = steps[Math.min(index, steps.length - 1)];
  const isLast = index === steps.length - 1;

  // Keep the focus on the tour so keyboard navigation works as users tab through.
  useEffect(() => {
    nextRef.current?.focus();
  }, [index]);

  const next = () => {
    if (isLast) onFinish();
    else setIndex((i) => i + 1);
  };
  const prev = () => setIndex((i) => Math.max(0, i - 1));

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onSkip();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prev();
      } else if (e.key === 'Enter' && e.target instanceof HTMLButtonElement) {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, isLast, onFinish, onSkip]);

  if (!step) return null;

  // Resolve + measure the highlighted element on every render (no effect timers,
  // so positions stay in sync with layout without act() bookkeeping).
  const targetEl = step.target ? document.querySelector<HTMLElement>(step.target) : null;
  const rect = targetEl?.getBoundingClientRect();
  const hasTarget = Boolean(targetEl && rect && (rect.width > 0 || rect.height > 0));

  // Card placement: beside/around the target when it is measured, centered otherwise.
  let card: CSSProperties = { width: CARD_WIDTH };
  let highlight: CSSProperties | null = null;
  if (hasTarget && rect) {
    const fitsBelow = rect.top + rect.height + GAP + CARD_HEIGHT <= window.innerHeight;
    const left = Math.min(Math.max(EDGE, rect.left), window.innerWidth - CARD_WIDTH - EDGE);
    const top = fitsBelow
      ? Math.max(EDGE, rect.top + rect.height + GAP)
      : Math.max(EDGE, rect.top - GAP - CARD_HEIGHT);
    card = { ...card, position: 'fixed', left, top };
    highlight = { position: 'fixed', left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  } else {
    card = {
      ...card,
      position: 'fixed',
      left: Math.max(EDGE, (window.innerWidth - CARD_WIDTH) / 2),
      top: Math.max(EDGE, (window.innerHeight - CARD_HEIGHT) / 2),
    };
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Onboarding tour">
      {/* Dim everything except the spotlighted target. */}
      {hasTarget && highlight && <div className="fixed inset-0 z-[80]" />}
      {hasTarget && highlight && (
        <div
          className="pointer-events-none fixed z-[90] rounded-lg ring-2 ring-[#b8402e]"
          style={{ ...highlight, boxShadow: '0 0 0 9999px rgba(33, 30, 26, 0.55)' }}
        />
      )}
      {!hasTarget && <div className="fixed inset-0 z-[80] bg-[#211e1a]/55" />}

      {/* Tour card */}
      <div
        className="fixed z-[100] overflow-hidden rounded-xl border border-[#f3ede2]/20 bg-[#211e1a] shadow-2xl"
        style={card}
      >
        <div className="flex items-center justify-between border-b border-[#f3ede2]/15 px-5 py-3">
          <span className="text-sm font-semibold text-[#f3ede2]">
            {step.title}
          </span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-[#f3ede2]/50">
            {index + 1} of {steps.length}
          </span>
        </div>

        <div className="px-5 py-4">
          <p className="text-[13px] leading-relaxed text-[#f3ede2]/85">{step.body}</p>

          {/* Progress dots */}
          <div className="mt-4 flex items-center gap-1">
            {steps.map((_, i) => (
              <span
                key={i}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i === index ? 'bg-[#b8402e]' : i < index ? 'bg-[#6b8f71]' : 'bg-[#f3ede2]/15'
                }`}
              />
            ))}
          </div>

          {/* Actions */}
          <div className="mt-4 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onSkip}
              className="rounded px-2 py-1 text-xs text-[#f3ede2]/60 transition-colors hover:bg-[#f3ede2]/10 hover:text-[#f3ede2]"
            >
              Skip
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={prev}
                disabled={index === 0}
                className="rounded px-3 py-1.5 text-xs font-medium text-[#f3ede2]/80 transition-colors hover:bg-[#f3ede2]/10 disabled:opacity-40 disabled:hover:bg-transparent"
              >
                Back
              </button>
              <button
                ref={nextRef}
                type="button"
                onClick={next}
                className={`rounded bg-[#b8402e] px-4 py-1.5 text-xs font-semibold text-[#f3ede2] transition-opacity hover:bg-[#8b2e1e] ${
                  isLast ? 'bg-[#6b8f71] hover:bg-[#4d6b52]' : ''
                }`}
              >
                {isLast ? 'Done' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}