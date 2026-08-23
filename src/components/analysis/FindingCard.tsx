import type { Finding, RecommendedAction, StructuralAction } from '@/types/findings';
import { useTopologyStore } from '@/store/topologyStore';
import type { SimulationNode } from '@/types/nodes';

// ─── Severity Contrast (R43.4, 4.5:1 minimum) ───────────────────

const SEVERITY_STYLES: Record<string, string> = {
  Critical: 'text-red-300 font-semibold', // red-300 on gray-900 ≈ 7.5:1
  Warning: 'text-amber-300 font-medium', // amber-300 on gray-900 ≈ 6.8:1
  Info: 'text-sky-300', // sky-300 on gray-900 ≈ 7.1:1
};

// ─── Helpers ─────────────────────────────────────────────────────

/** Shorten an identifier to first 8 characters for display. */
function shortenId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

/** Resolve a subject node ID to a display label. */
function resolveLabel(nodeId: string, nodesMap: Map<string, SimulationNode>): { label: string; present: boolean } {
  const node = nodesMap.get(nodeId);
  if (node) {
    return { label: node.label || shortenId(nodeId), present: true };
  }
  return { label: shortenId(nodeId), present: false };
}

function formatAction(action: RecommendedAction | StructuralAction): string {
  if ('direction' in action) {
    const a = action as RecommendedAction;
    let text = `${a.direction} ${a.parameter} on ${shortenId(a.nodeId)}`;
    if (a.targetValue) {
      text += ` to ${a.targetValue.value} ${a.targetValue.unit}`;
    } else if (a.multiplier) {
      text += ` by ${a.multiplier}×`;
    }
    return text;
  }
  const s = action as StructuralAction;
  return `${s.change.replace(/-/g, ' ')} (${s.nodesAdded} nodes, ${s.edgesAdded} edges added)`;
}

// ─── FindingCard ─────────────────────────────────────────────────

export interface FindingCardProps {
  finding: Finding;
  /** Whether this card is the active/focused item. */
  isActive?: boolean;
  /** Callback when the card is activated (Enter/Space/click). */
  onActivate?: () => void;
}

export function FindingCard({ finding, isActive, onActivate }: FindingCardProps) {
  const nodes = useTopologyStore((s) => s.nodes);

  // Build a map of node id -> SimulationNode for lookup
  const nodesMap = new Map<string, SimulationNode>();
  for (const rfNode of nodes) {
    const simNode = rfNode.data as unknown as SimulationNode;
    if (simNode?.id) {
      nodesMap.set(simNode.id, simNode);
    }
  }

  // Resolve subject nodes (Task 539)
  const subjectLabels = finding.subjectNodeIds.map((id) => resolveLabel(id, nodesMap));
  const allAbsent = subjectLabels.length > 0 && subjectLabels.every((s) => !s.present);
  const isSystemWide = finding.subjectNodeIds.length === 0;

  // Window bounds
  const windowStart = finding.window.startMs;
  const windowEnd = finding.window.endMs;

  return (
    <article
      role="option"
      aria-selected={isActive}
      aria-label={`${finding.severity} finding: ${finding.constraint}`}
      tabIndex={-1}
      className={`rounded-md border px-3 py-2 text-xs transition-colors cursor-pointer ${
        isActive
          ? 'border-indigo-500 bg-indigo-950/40 ring-2 ring-indigo-500/50'
          : 'border-gray-700 bg-gray-900/60 hover:border-gray-600 hover:bg-gray-800/60'
      }`}
      onClick={onActivate}
    >
      {/* Severity + Confidence */}
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className={SEVERITY_STYLES[finding.severity] ?? 'text-gray-300'}>
          {finding.severity}
        </span>
        <span className="text-gray-500 text-[10px]">
          Confidence: {finding.confidence}
        </span>
      </div>

      {/* Subject nodes (Task 539) */}
      <div className="mb-1">
        {isSystemWide ? (
          <span className="text-gray-400 italic">System-wide scope</span>
        ) : allAbsent ? (
          <span className="text-gray-500 italic">
            {subjectLabels.map((s) => s.label).join(', ')} — absent from current topology
          </span>
        ) : (
          <span className="text-gray-300">
            {subjectLabels.map((s, i) => (
              <span key={i} className={s.present ? '' : 'text-gray-500 line-through'}>
                {s.label}
                {i < subjectLabels.length - 1 ? ', ' : ''}
              </span>
            ))}
          </span>
        )}
      </div>

      {/* Constraint */}
      <p className="text-gray-300 mb-1 leading-snug">{finding.constraint}</p>

      {/* Recommended action */}
      <p className="text-gray-400 mb-1">
        <span className="text-gray-500">Action:</span> {formatAction(finding.action)}
      </p>

      {/* Tradeoff */}
      <p className="text-gray-400 mb-1">
        <span className="text-gray-500">Tradeoff:</span> {finding.tradeoff}
      </p>

      {/* Window bounds */}
      <div className="flex items-center gap-3 text-[10px] text-gray-500 mt-1">
        <span>Window: {windowStart} ms – {windowEnd} ms</span>
        <span>ID: {finding.id}</span>
      </div>
    </article>
  );
}
