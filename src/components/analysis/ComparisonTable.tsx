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
  if (diff.absoluteDiff === 0) return 'text-[#5b5347]/75';
  // For error rates and latency, increase is bad (red); for throughput, increase is good (green)
  const isNegativeMetric =
    diff.metric.includes('error') || diff.metric.includes('latency') || diff.metric.startsWith('p');
  if (isNegativeMetric) {
    return diff.absoluteDiff > 0 ? 'text-[#8b2e1e]' : 'text-[#4d6b52]';
  }
  return diff.absoluteDiff > 0 ? 'text-[#4d6b52]' : 'text-[#8b2e1e]';
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
      <div className="text-xs text-[#211e1a]/80">
        {result.label.kind === 'controlled' ? (
          <span className="text-[#4d6b52]">
            Controlled comparison — identical seed, duration, and offered load.
          </span>
        ) : (
          <span className="text-[#8a6418]">
            Uncontrolled comparison — differs in:{' '}
            {result.label.differences.map((d) => d.attribute).join(', ')}
          </span>
        )}
      </div>

      {/* System metrics table */}
      <table aria-label={tableName} className="w-full text-xs border-collapse" role="table">
        <caption className="sr-only">{tableName}</caption>
        <thead>
          <tr className="border-b border-[#5b5347]/30">
            <th scope="col" className="text-left py-1 px-2 text-[#211e1a]/75 font-medium">
              Metric
            </th>
            <th scope="col" className="text-right py-1 px-2 text-[#211e1a]/75 font-medium">
              {result.nameA}
            </th>
            <th scope="col" className="text-right py-1 px-2 text-[#211e1a]/75 font-medium">
              {result.nameB}
            </th>
            <th scope="col" className="text-right py-1 px-2 text-[#211e1a]/75 font-medium">
              Difference
            </th>
          </tr>
        </thead>
        <tbody>
          {result.systemMetrics.map((diff) => (
            <tr key={diff.metric} className="border-b border-[#5b5347]/15 hover:bg-[#5b5347]/10 transition-colors">
              <th scope="row" className="text-left py-1 px-2 text-[#211e1a]/85 font-normal">
                {diff.metric}
              </th>
              <td className="text-right py-1 px-2 text-[#211e1a]/85">
                {formatValue(diff.valueA, diff.unit)}
              </td>
              <td className="text-right py-1 px-2 text-[#211e1a]/85">
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
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[#5b5347]/80 mb-1">
            Per-Node Differences
          </h4>
          {result.perNode.map((node: PerNodeDifference) => (
            <details key={node.nodeId} className="mb-1">
              <summary className="cursor-pointer text-xs text-[#211e1a]/85 hover:text-[#211e1a] py-0.5">
                {node.label} ({node.nodeType})
              </summary>
              <table
                aria-label={`Per-node metrics for ${node.label}`}
                className="w-full text-[10px] ml-2 mt-1"
              >
                <thead>
                  <tr className="border-b border-[#5b5347]/20">
                    <th scope="col" className="text-left py-0.5 px-1 text-[#211e1a]/55">
                      Metric
                    </th>
                    <th scope="col" className="text-right py-0.5 px-1 text-[#211e1a]/55">
                      {result.nameA}
                    </th>
                    <th scope="col" className="text-right py-0.5 px-1 text-[#211e1a]/55">
                      {result.nameB}
                    </th>
                    <th scope="col" className="text-right py-0.5 px-1 text-[#211e1a]/55">
                      Diff
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {node.metrics.map((diff) => (
                    <tr key={diff.metric} className="border-b border-[#5b5347]/10">
                      <th scope="row" className="text-left py-0.5 px-1 text-[#211e1a]/70 font-normal">
                        {diff.metric}
                      </th>
                      <td className="text-right py-0.5 px-1 text-[#211e1a]/70">
                        {formatValue(diff.valueA, diff.unit)}
                      </td>
                      <td className="text-right py-0.5 px-1 text-[#211e1a]/70">
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
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[#5b5347]/80 mb-1">
            Nodes Present in Only One Run
          </h4>
          <ul className="text-xs text-[#5b5347]/85">
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
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[#5b5347]/80 mb-1">
            Configuration Changes
          </h4>
          <ul className="text-xs text-[#5b5347]/85">
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
