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
    for (const { key } of TERMINAL_STATUS_LABELS) {
      aggregatedCumulative[key]! += node.cumulativeTerminalCounts[key] ?? 0;
      aggregatedWindow[key]! += node.terminalCounts[key] ?? 0;
    }
  }

  const totalCumulative = Object.values(aggregatedCumulative).reduce((a, b) => a + b, 0);
  const noTerminationsYet = totalCumulative === 0;

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 dark:bg-gray-800 text-left">
            <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300">Status</th>
            <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300 text-right">
              Count
            </th>
            <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300 text-right">
              Rate (term/s)
            </th>
            <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300 text-right">
              Percentage
            </th>
          </tr>
        </thead>
        <tbody>
          {TERMINAL_STATUS_LABELS.map(({ key, label }) => {
            const count = aggregatedCumulative[key]!;
            const windowCount = aggregatedWindow[key]!;
            const rate = windowDurationSec > 0 ? windowCount / windowDurationSec : 0;

            return (
              <tr
                key={key}
                className="border-t border-gray-100 dark:border-gray-700"
              >
                <td className="px-3 py-1.5 text-gray-800 dark:text-gray-200">{label}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-700 dark:text-gray-300">
                  {count}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-700 dark:text-gray-300">
                  {rate.toFixed(2)} term/s
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-700 dark:text-gray-300">
                  {noTerminationsYet ? (
                    <span className="text-gray-500 text-xs">
                      No terminated requests yet
                    </span>
                  ) : (
                    `${((count / totalCumulative) * 100).toFixed(1)}%`
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800">
            <td className="px-3 py-1.5 font-medium text-gray-800 dark:text-gray-200">Total</td>
            <td className="px-3 py-1.5 text-right tabular-nums font-medium text-gray-800 dark:text-gray-200">
              {totalCumulative}
            </td>
            <td className="px-3 py-1.5 text-right tabular-nums text-gray-700 dark:text-gray-300">
              {windowDurationSec > 0
                ? (
                    Object.values(aggregatedWindow).reduce((a, b) => a + b, 0) / windowDurationSec
                  ).toFixed(2)
                : '0.00'}{' '}
              term/s
            </td>
            <td className="px-3 py-1.5 text-right tabular-nums font-medium text-gray-800 dark:text-gray-200">
              {noTerminationsYet ? (
                <span className="text-gray-500 text-xs">N/A</span>
              ) : (
                '100.0%'
              )}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
