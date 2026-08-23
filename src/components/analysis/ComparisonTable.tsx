import type { ComparisonResult, MetricDifference, PerNodeDifference } from '@/analysis/comparison';

// ─── Helpers ─────────────────────────────────────────────────────

function formatValue(value: number, unit: string): string {
  if (unit === 'fraction') return `${(value * 100).toFixed(2)}%`;
  if (unit === 'ms') return `${value.toFixed(1)} ms`;
  return `${value.toFixed(2)} ${unit}`;
}

function formatDiff(diff: MetricDifference): string {
  const sign = diff.absoluteDiff >= 0 ? '+' : '';
  const pctStr = diff.percentDiff !== null ? ` (${sign}${diff.percentDiff.toFixed(1)}%)` : '';
  return `${sign}${formatValue(diff.absoluteDiff, diff.unit)}${pctStr}`;
}

function diffColorClass(diff: MetricDifference): string {
  if (diff.absoluteDiff === 0) return 'text-gray-400';
  // For error rates and latency, increase is bad (red); for throughput, increase is good (green)
  const isNegativeMetric =
    diff.metric.includes('error') || diff.metric.includes('latency') || diff.metric.startsWith('p');
  if (isNegativeMetric) {
    return diff.absoluteDiff > 0 ? 'text-red-400' : 'text-green-400';
  }
  return diff.absoluteDiff > 0 ? 'text-green-400' : 'text-red-400';
}

// ─── ComparisonTable (Task 549) ──────────────────────────────────

export interface ComparisonTableProps {
  result: ComparisonResult;
}

export function ComparisonTable({ result }: ComparisonTableProps) {
  const tableName = `Comparison: ${result.nameA} vs ${result.nameB}`;

  return (
    <div className="flex flex-col gap-4 overflow-y-auto">
      {/* Comparison label */}
      <div className="text-xs text-gray-400">
        {result.label.kind === 'controlled' ? (
          <span className="text-green-400">
            Controlled comparison — identical seed, duration, and offered load.
          </span>
        ) : (
          <span className="text-amber-400">
            Uncontrolled comparison — differs in:{' '}
            {result.label.differences.map((d) => d.attribute).join(', ')}
          </span>
        )}
      </div>

      {/* System metrics table */}
      <table aria-label={tableName} className="w-full text-xs border-collapse" role="table">
        <caption className="sr-only">{tableName}</caption>
        <thead>
          <tr className="border-b border-gray-700">
            <th scope="col" className="text-left py-1 px-2 text-gray-400 font-medium">
              Metric
            </th>
            <th scope="col" className="text-right py-1 px-2 text-gray-400 font-medium">
              {result.nameA}
            </th>
            <th scope="col" className="text-right py-1 px-2 text-gray-400 font-medium">
              {result.nameB}
            </th>
            <th scope="col" className="text-right py-1 px-2 text-gray-400 font-medium">
              Difference
            </th>
          </tr>
        </thead>
        <tbody>
          {result.systemMetrics.map((diff) => (
            <tr key={diff.metric} className="border-b border-gray-800 hover:bg-gray-800/50">
              <th scope="row" className="text-left py-1 px-2 text-gray-300 font-normal">
                {diff.metric}
              </th>
              <td className="text-right py-1 px-2 text-gray-300">
                {formatValue(diff.valueA, diff.unit)}
              </td>
              <td className="text-right py-1 px-2 text-gray-300">
                {formatValue(diff.valueB, diff.unit)}
              </td>
              <td className={`text-right py-1 px-2 ${diffColorClass(diff)}`}>{formatDiff(diff)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Per-node metrics */}
      {result.perNode.length > 0 && (
        <section aria-label="Per-node comparison">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
            Per-Node Differences
          </h4>
          {result.perNode.map((node: PerNodeDifference) => (
            <details key={node.nodeId} className="mb-1">
              <summary className="cursor-pointer text-xs text-gray-300 hover:text-gray-200 py-0.5">
                {node.label} ({node.nodeType})
              </summary>
              <table
                aria-label={`Per-node metrics for ${node.label}`}
                className="w-full text-[10px] ml-2 mt-1"
              >
                <thead>
                  <tr className="border-b border-gray-800">
                    <th scope="col" className="text-left py-0.5 px-1 text-gray-500">
                      Metric
                    </th>
                    <th scope="col" className="text-right py-0.5 px-1 text-gray-500">
                      {result.nameA}
                    </th>
                    <th scope="col" className="text-right py-0.5 px-1 text-gray-500">
                      {result.nameB}
                    </th>
                    <th scope="col" className="text-right py-0.5 px-1 text-gray-500">
                      Diff
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {node.metrics.map((diff) => (
                    <tr key={diff.metric} className="border-b border-gray-800/50">
                      <th scope="row" className="text-left py-0.5 px-1 text-gray-400 font-normal">
                        {diff.metric}
                      </th>
                      <td className="text-right py-0.5 px-1 text-gray-400">
                        {formatValue(diff.valueA, diff.unit)}
                      </td>
                      <td className="text-right py-0.5 px-1 text-gray-400">
                        {formatValue(diff.valueB, diff.unit)}
                      </td>
                      <td className={`text-right py-0.5 px-1 ${diffColorClass(diff)}`}>
                        {formatDiff(diff)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ))}
        </section>
      )}

      {/* Unmatched nodes */}
      {result.unmatchedNodes.length > 0 && (
        <section aria-label="Unmatched nodes">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
            Nodes Present in Only One Run
          </h4>
          <ul className="text-xs text-gray-400">
            {result.unmatchedNodes.map((n) => (
              <li key={`${n.nodeId}-${n.presentIn}`} className="py-0.5">
                {n.label} ({n.nodeType}) — only in{' '}
                {n.presentIn === 'A' ? result.nameA : result.nameB}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Config differences */}
      {result.configDifferences.length > 0 && (
        <section aria-label="Configuration differences">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
            Configuration Changes
          </h4>
          <ul className="text-xs text-gray-400">
            {result.configDifferences.map((cd, i) => (
              <li key={i} className="py-0.5">
                {cd.label}.{cd.parameter}: {JSON.stringify(cd.valueA)} → {JSON.stringify(cd.valueB)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
