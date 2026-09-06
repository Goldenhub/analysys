import type { SpofDesignation } from '@/analysis/reachability';
import type { Finding } from '@/types/findings';

// ─── Types ───────────────────────────────────────────────────────

export interface ExcludedNode {
  nodeId: string;
  label: string;
  reason: string;
}

export interface SpofListProps {
  /** SPOF Findings from the analysis engine. */
  spofFindings: Finding[];
  /** Nodes excluded from SPOF candidacy with reasons. */
  exclusions?: ExcludedNode[];
  /** Raw SPOF designations for additional detail. */
  spofDesignations?: SpofDesignation[];
  /** Topology node labels for display. */
  nodeLabels: Map<string, string>;
}

// ─── SpofList (Task 552) ─────────────────────────────────────────

export function SpofList({
  spofFindings,
  exclusions = [],
  spofDesignations = [],
  nodeLabels,
}: SpofListProps) {
  const resolveLabel = (id: string) => nodeLabels.get(id) ?? id.slice(0, 8);

  const hasSpofs = spofFindings.length > 0 || spofDesignations.length > 0;

  return (
    <div className="flex flex-col gap-3">
      {/* SPOF findings */}
      <section aria-label="Single points of failure">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[#5b5347]/80 mb-1">
          Single Points of Failure
        </h4>

        {!hasSpofs ? (
          <div className="rounded border border-[#6b8f71]/40 bg-[#6b8f71]/10 px-3 py-2 text-xs text-[#4d6b52]">
            Every source retains a path to at least one terminal under any single-node removal. No
            single points of failure detected.
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5" role="list" aria-label="SPOF nodes">
            {spofDesignations.map((spof) => (
              <li
                key={spof.nodeId}
                className="rounded border border-[#8b2e1e]/40 bg-[#8b2e1e]/10 px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[#8b2e1e] font-medium">{resolveLabel(spof.nodeId)}</span>
                  <span className="text-[#211e1a]/65 text-[10px]">Fan-in: {spof.fanIn}</span>
                </div>
                <p className="text-[#211e1a]/75 text-[10px] mt-0.5">
                  Removal disconnects: {spof.losingSources.map((s) => resolveLabel(s)).join(', ')}
                </p>
              </li>
            ))}
            {spofFindings.map((finding) => (
              <li
                key={finding.id}
                className="rounded border border-[#8b2e1e]/40 bg-[#8b2e1e]/10 px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[#8b2e1e] font-medium">
                    {finding.subjectNodeIds.map((id) => resolveLabel(id)).join(', ')}
                  </span>
                  <span
                    className={`text-[10px] ${finding.severity === 'Critical' ? 'text-[#8b2e1e]' : 'text-[#8a6418]'}`}
                  >
                    {finding.severity}
                  </span>
                </div>
                <p className="text-[#211e1a]/75 text-[10px] mt-0.5">{finding.constraint}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Exclusions */}
      {exclusions.length > 0 && (
        <section aria-label="Exclusions from SPOF analysis">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[#5b5347]/80 mb-1">
            Excluded from SPOF Candidacy
          </h4>
          <ul className="text-xs text-[#5b5347]/85" role="list">
            {exclusions.map((ex) => (
              <li key={ex.nodeId} className="py-0.5">
                <span className="text-[#211e1a]/85">{ex.label}</span>
                <span className="text-[#5b5347]/75"> — {ex.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
