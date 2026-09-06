import type { NodeMetricsSnapshot } from '@/types/metrics';
import { RequestStatus } from '@/simulation/types';

// ─── Types ───────────────────────────────────────────────────────

interface TerminalStatusTableProps {
  /** All node snapshots from the latest metrics batch. */
  nodes: NodeMetricsSnapshot[];
  /** The metrics window duration in seconds (for rate computation). */
  windowDurationSec: number;
}

// ─── Constants ───────────────────────────────────────────────────

/**
 * The nine terminal statuses in display order.
 */
const TERMINAL_STATUS_LABELS: Array<{ key: string; label: string }> = [
  { key: RequestStatus.Success, label: 'Success' },
  { key: RequestStatus.Timeout, label: 'Timeout' },
  { key: RequestStatus.Dropped, label: 'Dropped' },
  { key: RequestStatus.LoopDetected, label: 'Loop Detected' },
  { key: RequestStatus.NoRoute, label: 'No Route' },
  { key: RequestStatus.Unauthenticated, label: 'Unauthenticated' },
  { key: RequestStatus.Forbidden, label: 'Forbidden' },
  { key: RequestStatus.RetryExhausted, label: 'Retry Exhausted' },
  { key: RequestStatus.DeadLettered, label: 'Dead Lettered' },
];

// ─── Component ───────────────────────────────────────────────────

/**
 * Task 343/344 — Reports each of the nine terminal statuses with:
 * - Cumulative count
 * - Rate in terminations per second
 * - Percentage of terminated requests (or "No terminated requests yet" when sum is 0)
 */
export function TerminalStatusTable({ nodes, windowDurationSec }: TerminalStatusTableProps) {
  // Aggregate cumulative counts across all nodes
  const aggregatedCumulative: Record<string, number> = {};
  const aggregatedWindow: Record<string, number> = {};

  for (const { key } of TERMINAL_STATUS_LABELS) {
    aggregatedCumulative[key] = 0;
    aggregatedWindow[key] = 0;
  }

  for (const node of nodes) {
    // Snapshots may omit count records entirely (e.g. before the first window
    // closes) — treat every missing field as zero rather than crashing.
    const cumulative = node.cumulativeTerminalCounts ?? {};
    const window = node.terminalCounts ?? {};
    for (const { key } of TERMINAL_STATUS_LABELS) {
      aggregatedCumulative[key]! += cumulative[key] ?? 0;
      aggregatedWindow[key]! += window[key] ?? 0;
    }
  }

  const totalCumulative = Object.values(aggregatedCumulative).reduce((a, b) => a + b, 0);
  const noTerminationsYet = totalCumulative === 0;

  return (
    <div className="rounded-lg border border-[#5b5347]/30 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[#211e1a] text-left">
            <th className="px-3 py-2 font-medium text-[#f3ede2]/80">Status</th>
            <th className="px-3 py-2 font-medium text-[#f3ede2]/80 text-right">Count</th>
            <th className="px-3 py-2 font-medium text-[#f3ede2]/80 text-right">Rate (term/s)</th>
            <th className="px-3 py-2 font-medium text-[#f3ede2]/80 text-right">Percentage</th>
          </tr>
        </thead>
        <tbody>
          {TERMINAL_STATUS_LABELS.map(({ key, label }) => {
            const count = aggregatedCumulative[key]!;
            const windowCount = aggregatedWindow[key]!;
            const rate = windowDurationSec > 0 ? windowCount / windowDurationSec : 0;

            return (
              <tr key={key} className="border-t border-[#5b5347]/30">
                <td className="px-3 py-1.5 text-[#f3ede2]">{label}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-[#f3ede2]/80">{count}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-[#f3ede2]/80">
                  {rate.toFixed(2)} term/s
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-[#f3ede2]/80">
                  {noTerminationsYet ? (
                    <span className="text-[#f3ede2]/70 text-xs">No terminated requests yet</span>
                  ) : (
                    `${((count / totalCumulative) * 100).toFixed(1)}%`
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-[#5b5347]/40 bg-[#211e1a]">
            <td className="px-3 py-1.5 font-medium text-[#f3ede2]">Total</td>
            <td className="px-3 py-1.5 text-right tabular-nums font-medium text-[#f3ede2]">
              {totalCumulative}
            </td>
            <td className="px-3 py-1.5 text-right tabular-nums text-[#f3ede2]/80">
              {windowDurationSec > 0
                ? (
                    Object.values(aggregatedWindow).reduce((a, b) => a + b, 0) / windowDurationSec
                  ).toFixed(2)
                : '0.00'}{' '}
              term/s
            </td>
            <td className="px-3 py-1.5 text-right tabular-nums font-medium text-[#f3ede2]">
              {noTerminationsYet ? <span className="text-[#f3ede2]/70 text-xs">N/A</span> : '100.0%'}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
