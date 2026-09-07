import { useEffect, useRef } from 'react';

// ─── Icons ─────────────────────────────────────────────────────────

/** Question-mark help icon (fills with currentColor). */
export function HelpIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

// ─── Content ───────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-4 last:mb-0">
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#dfb357]">
        {title}
      </h3>
      <div className="space-y-1.5 text-[13px] text-[#f3ede2]/85 leading-relaxed">{children}</div>
    </section>
  );
}

// ─── HelpModal (How to use Analysys) ──────────────────────────────

export interface HelpModalProps {
  /** Whether the modal is shown. */
  isOpen: boolean;
  /** Called when the modal is dismissed (close button, scrim, Escape). */
  onClose: () => void;
  /** Ref to the button that opened the modal — focus returns here on close. */
  openerRef?: React.RefObject<HTMLButtonElement | null>;
  /** Optional handler to re-run the first-visit onboarding tour. */
  onReplayTour?: () => void;
}

export function HelpModal({ isOpen, onClose, openerRef, onReplayTour }: HelpModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Focus the dialog on open; restore focus to the opener on close.
  useEffect(() => {
    if (isOpen) {
      closeButtonRef.current?.focus();
      return;
    }
    openerRef?.current?.focus();
  }, [isOpen, openerRef]);

  // Escape closes the dialog and returns focus to the opener.
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      {/* Scrim */}
      <div
        className="absolute inset-0 bg-[#211e1a]/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-modal-title"
        className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-[#f3ede2]/20 bg-[#211e1a] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#f3ede2]/15 px-5 py-3">
          <h2 id="help-modal-title" className="text-sm font-semibold text-[#f3ede2]">
            How to use Analysys
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[#f3ede2]/70 hover:bg-[#f3ede2]/10 hover:text-[#f3ede2] focus:outline-none focus:ring-1 focus:ring-[#b8402e]"
            aria-label="Close help"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-4"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-5 py-4">
          <p className="mb-3 text-[13px] leading-relaxed text-[#f3ede2]/75">
            Analysys models how a distributed architecture behaves under real load — from request
            throughput and latency to failures and recovery — entirely in your browser. Nothing
            leaves your machine unless you save or export it.
          </p>
          {onReplayTour && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onReplayTour();
              }}
              className="mb-4 rounded border border-[#b8402e]/50 px-2 py-1 text-xs text-[#b8402e] transition-colors hover:bg-[#b8402e]/10"
            >
              Restart the onboarding tour
            </button>
          )}

          <Section title="1 · Build your architecture">
            <p>
              Drag nodes from the <span className="text-[#8fbf97]">Node Palette</span> (left
              sidebar) onto the canvas: traffic generators, load balancers, app servers, worker
              pools, caches, queues, databases, and more.
            </p>
            <p>
              Connect nodes by dragging from any output handle to a valid target. Invalid
              connections are rejected, and the canvas legend explains the routing rules.
            </p>
            <p>
              Right-click a node for its <span className="text-[#8fbf97]">Details</span> menu, which
              opens the{' '}
              <span className="text-[#8fbf97]">configuration panel</span> where you tune worker pool
              size, queue depth, processing time (mean ± std-dev), routing policy, and timeouts.
            </p>
            <p>
              Section and Note boxes group things visually — they have no effect on the simulation.
              Load a preset or your own saved topology from the toolbar to start from a reference
              architecture.
            </p>
            <p>
              Service nodes — API gateways, app servers, worker pools, and auth
              services — can own a nested layer of their own: tap their{' '}
              <span className="text-[#dfb357]">⌄ chip</span> to drill into it and build the
              internals. Giving a node children makes it a{' '}
              <span className="text-[#dfb357]">container</span>: its own processing settings are
              bypassed and the children handle its requests. The breadcrumb at the top of the
              canvas climbs back out — or all the way to the system overview.
            </p>
            <p>
              Queues, caches, databases, object stores, and the traffic generator don't decompose —
              they stay atomic single units.
            </p>
          </Section>

          <Section title="2 · Run a simulation">
            <p>
              Choose a <span className="text-[#8fbf97]">duration</span> (30s – 10min) and a{' '}
              <span className="text-[#8fbf97]">speed multiplier</span> (up to 50×) so long runs
              finish quickly.
            </p>
            <p>
              Lock a <span className="text-[#dfb357]">seed</span> to make a run reproducible — the
              same topology + settings + seed replays identical behaviour. Every preset ships with a
              seed.
            </p>
            <p>
              Press <span className="text-[#8fbf97]">Start</span>. The dashboard below the canvas
              streams throughput, p50/p90/p99 latency, error rates, and queue depth — system-wide
              and per node — plus terminal statuses (SUCCESS, TIMEOUT, DROPPED, …).
            </p>
          </Section>

          <Section title="3 · Test resilience with chaos">
            <p>
              Inject <span className="text-[#dfb357]">chaos events</span> (latency spikes, errors,
              outages) over a time window to see how your system degrades and where it recovers.
              Events appear on the canvas and in the charts so symptoms trace back to causes.
            </p>
          </Section>

          <Section title="4 · Analyse a run">
            <p>
              Open the <span className="text-[#8fbf97]">Analysis</span> panel from the dashboard.
              After at least 3 completed metrics windows, its rules classify findings by category —
              bottlenecks, saturation, instability, capacity, single points of failure, reliability,
              and configuration. Click any finding to zoom the canvas to the offending nodes.
            </p>
            <p>
              <span className="text-[#dfb357]">SPOF</span> — nodes whose removal disconnects every
              traffic source from all terminals.
            </p>
            <p>
              <span className="text-[#dfb357]">Sweep</span> — steps offered load from a start to an
              end RPS and reports the sustainable load plus the knee point where latency/error
              objectives break.
            </p>
            <p>
              <span className="text-[#dfb357]">Comparison</span> — save finished runs as baselines,
              then diff two runs metric-by-metric. Equal seeds give a controlled A/B comparison.
            </p>
          </Section>

          <Section title="5 · Save and export">
            <p>
              Use <span className="text-[#8fbf97]">Save</span> in the toolbar to keep a topology in
              your browser, and <span className="text-[#8fbf97]">Export</span> to download a JSON
              file that recreates the exact topology and run settings. Import it later (or on another
              machine) and press Start to replay the same run.
            </p>
            <p>
              Export findings reports as Markdown or JSON from the Analysis panel, and capacity
              sweep steps as CSV.
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}