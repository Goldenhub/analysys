import type { SweepStepResult } from '@/analysis/CapacitySweepController';
import { downloadTextFile } from '@/utils/download';
import { toCsv } from '@/utils/csv';

// ─── Terminal Status Names ───────────────────────────────────────

const TERMINAL_STATUSES = [
  'SUCCESS',
  'TIMEOUT',
  'DROPPED',
  'LOOP_DETECTED',
  'NO_ROUTE',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'RETRY_EXHAUSTED',
  'DEAD_LETTERED',
] as const;

// ─── Verdict styling ─────────────────────────────────────────────

const VERDICT_STYLES: Record<string, string> = {
  satisfied: 'text-green-400',
  violated: 'text-red-400',
  'not-evaluated': 'text-gray-500',
};

// ─── SweepResultsTable (Task 550) ────────────────────────────────

export interface SweepResultsTableProps {
  steps: SweepStepResult[];
}

export function SweepResultsTable({ steps }: SweepResultsTableProps) {
  if (steps.length === 0) {
    return <p className="text-xs text-gray-500 italic">No sweep results available.</p>;
  }

  const exportCsv = () => {
    const csv = toCsv(
      [
        'step',
        'requested_rps',
        'applied_rps',
        'throughput_req_s',
        'p50_ms',
        'p90_ms',
        'p99_ms',
        'error_rate_pct',
        ...TERMINAL_STATUSES.map((s) => s.toLowerCase()),
        'interval_start_ms',
        'interval_end_ms',
        'verdict',
      ],
      steps.map((step) => [
        step.stepIndex + 1,
        step.requestedRps,
        step.appliedRps,
        step.achievedThroughput.toFixed(2),
        step.latency.p50.toFixed(2),
        step.latency.p90.toFixed(2),
        step.latency.p99.toFixed(2),
        (step.totalErrorRate * 100).toFixed(2),
        ...TERMINAL_STATUSES.map((s) => step.terminalCounts[s] ?? 0),
        step.measurementInterval.startMs,
        step.measurementInterval.endMs,
        step.verdict,
      ]),
    );
    downloadTextFile(csv, 'analysys-sweep.csv', 'text/csv');
  };

  return (
    <div className="overflow-x-auto">
      <div className="mb-1 flex justify-end">
        <button
          onClick={exportCsv}
          className="rounded border border-gray-700 bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-300 hover:border-gray-600 hover:text-gray-100"
          title="Download all sweep steps as CSV"
        >
          Export steps CSV
        </button>
      </div>
      <table
        aria-label="Capacity sweep results"
        className="w-full text-[10px] border-collapse whitespace-nowrap"
        role="table"
      >
        <thead>
          <tr className="border-b border-gray-700 text-gray-400 font-medium">
            <th scope="col" className="py-1 px-1.5 text-left">
              Step
            </th>
            <th scope="col" className="py-1 px-1.5 text-right">
              Requested RPS
            </th>
            <th scope="col" className="py-1 px-1.5 text-right">
              Applied RPS
            </th>
            <th scope="col" className="py-1 px-1.5 text-right">
              Throughput (req/s)
            </th>
            <th scope="col" className="py-1 px-1.5 text-right">
              p50 (ms)
            </th>
            <th scope="col" className="py-1 px-1.5 text-right">
              p90 (ms)
            </th>
            <th scope="col" className="py-1 px-1.5 text-right">
              p99 (ms)
            </th>
            <th scope="col" className="py-1 px-1.5 text-right">
              Error Rate
            </th>
            {TERMINAL_STATUSES.map((status) => (
              <th key={status} scope="col" className="py-1 px-1.5 text-right">
                {status.replace(/_/g, ' ')}
              </th>
            ))}
            <th scope="col" className="py-1 px-1.5 text-right">
              Interval Start (ms)
            </th>
            <th scope="col" className="py-1 px-1.5 text-right">
              Interval End (ms)
            </th>
            <th scope="col" className="py-1 px-1.5 text-center">
              Verdict
            </th>
          </tr>
        </thead>
        <tbody>
          {steps.map((step) => (
            <tr key={step.stepIndex} className="border-b border-gray-800/50 hover:bg-gray-800/30">
              <th scope="row" className="py-1 px-1.5 text-left text-gray-300 font-normal">
                {step.stepIndex + 1}
              </th>
              <td className="py-1 px-1.5 text-right text-gray-300">{step.requestedRps}</td>
              <td className="py-1 px-1.5 text-right text-gray-300">{step.appliedRps}</td>
              <td className="py-1 px-1.5 text-right text-gray-300">
                {step.achievedThroughput.toFixed(1)}
              </td>
              <td className="py-1 px-1.5 text-right text-gray-300">
                {step.latency.p50.toFixed(1)}
              </td>
              <td className="py-1 px-1.5 text-right text-gray-300">
                {step.latency.p90.toFixed(1)}
              </td>
              <td className="py-1 px-1.5 text-right text-gray-300">
                {step.latency.p99.toFixed(1)}
              </td>
              <td className="py-1 px-1.5 text-right text-gray-300">
                {(step.totalErrorRate * 100).toFixed(2)}%
              </td>
              {TERMINAL_STATUSES.map((status) => (
                <td key={status} className="py-1 px-1.5 text-right text-gray-400">
                  {step.terminalCounts[status] ?? 0}
                </td>
              ))}
              <td className="py-1 px-1.5 text-right text-gray-400">
                {step.measurementInterval.startMs}
              </td>
              <td className="py-1 px-1.5 text-right text-gray-400">
                {step.measurementInterval.endMs}
              </td>
              <td
                className={`py-1 px-1.5 text-center font-medium ${VERDICT_STYLES[step.verdict] ?? 'text-gray-400'}`}
              >
                {step.verdict}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
