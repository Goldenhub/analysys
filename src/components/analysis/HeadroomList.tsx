// ─── Types ───────────────────────────────────────────────────────

export interface NodeHeadroom {
  nodeId: string;
  label: string;
  headroomPercent: number | null; // null = not applicable
  analysisUtilization: number | null;
}

export interface SystemHeadroom {
  headroomPercent: number;
  headroomRps: number;
  bottleneckNodeLabel: string;
  offeredLoadRps: number;
}

export interface HeadroomListProps {
  perNode: NodeHeadroom[];
  system: SystemHeadroom | null;
  /** Whether the projection caveat applies (utilization below Saturation). */
  projectionCaveat?: boolean;
}

// ─── HeadroomList (Task 551) ─────────────────────────────────────

export function HeadroomList({ perNode, system, projectionCaveat = false }: HeadroomListProps) {
  return (
    <div className="flex flex-col gap-3">
      {/* System headroom */}
      <section aria-label="System headroom">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
          System Headroom
        </h4>
        {system ? (
          <div className="rounded border border-gray-700 bg-gray-900/60 px-3 py-2 text-xs">
            <p className="text-gray-300">
              <span className="font-medium text-gray-200">
                {system.headroomPercent.toFixed(1)}%
              </span>{' '}
              additional load capacity ({system.headroomRps.toFixed(1)} RPS above current{' '}
              {system.offeredLoadRps.toFixed(0)} RPS)
            </p>
            <p className="text-gray-500 text-[10px] mt-0.5">
              Bottleneck: {system.bottleneckNodeLabel}
            </p>
            {projectionCaveat && (
              <p className="text-amber-400 text-[10px] mt-1 italic">
                Projection assumes linear scaling — actual capacity may differ under non-linear load
                patterns.
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-gray-500 italic">
            System headroom is not available (requires at least 3 completed metrics windows with
            eligible nodes).
          </p>
        )}
      </section>

      {/* Per-node headroom */}
      <section aria-label="Per-node headroom">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
          Per-Node Headroom
        </h4>
        {perNode.length === 0 ? (
          <p className="text-xs text-gray-500 italic">No per-node headroom data available.</p>
        ) : (
          <table
            aria-label="Per-node headroom values"
            className="w-full text-xs border-collapse"
            role="table"
          >
            <thead>
              <tr className="border-b border-gray-700">
                <th scope="col" className="text-left py-1 px-2 text-gray-400 font-medium">
                  Node
                </th>
                <th scope="col" className="text-right py-1 px-2 text-gray-400 font-medium">
                  Utilization
                </th>
                <th scope="col" className="text-right py-1 px-2 text-gray-400 font-medium">
                  Headroom
                </th>
              </tr>
            </thead>
            <tbody>
              {perNode.map((node) => (
                <tr key={node.nodeId} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <th scope="row" className="text-left py-1 px-2 text-gray-300 font-normal">
                    {node.label}
                  </th>
                  <td className="text-right py-1 px-2 text-gray-400">
                    {node.analysisUtilization !== null
                      ? `${(node.analysisUtilization * 100).toFixed(1)}%`
                      : 'N/A'}
                  </td>
                  <td className="text-right py-1 px-2 text-gray-300">
                    {node.headroomPercent !== null ? (
                      <span
                        className={
                          node.headroomPercent < 15
                            ? 'text-red-400'
                            : node.headroomPercent < 30
                              ? 'text-amber-400'
                              : 'text-green-400'
                        }
                      >
                        {node.headroomPercent.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-gray-500 italic">N/A</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
