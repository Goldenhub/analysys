import { useRef, useCallback, useEffect, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useAnalysisStore } from '@/store/analysisStore';
import { useTopologyStore } from '@/store/topologyStore';
import type { Finding, SuppressionEntry } from '@/types/findings';
import type { SimulationNode } from '@/types/nodes';
import { MIN_COMPLETED_WINDOWS } from '@/analysis/AnalysisWindowStore';
import { FindingList } from './FindingList';
import { ComparisonTable } from './ComparisonTable';
import { HeadroomList } from './HeadroomList';
import type { NodeHeadroom, SystemHeadroom } from './HeadroomList';
import { SpofList } from './SpofList';
import type { ExcludedNode } from './SpofList';
import { CapacitySweepPanel } from './CapacitySweepPanel';
import type { ComparisonResult } from '@/analysis/comparison';
import type { SweepStepResult } from '@/analysis/CapacitySweepController';

// ─── Constants ───────────────────────────────────────────────────

const ZOOM_FLOOR = 0.25;

// ─── Tab definitions ─────────────────────────────────────────────

type PanelTab = 'findings' | 'headroom' | 'spof' | 'sweep' | 'comparison';

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'findings', label: 'Findings' },
  { id: 'headroom', label: 'Headroom' },
  { id: 'spof', label: 'SPOF' },
  { id: 'sweep', label: 'Sweep' },
  { id: 'comparison', label: 'Comparison' },
];

// ─── AnalysisPanel (Tasks 536–558) ───────────────────────────────

export interface AnalysisPanelProps {
  /** Ref to the button that opened this panel, for Escape focus-return. */
  openerRef: React.RefObject<HTMLElement | null>;
  /** Called to close the panel (e.g. on toggle). */
  onClose?: () => void;
  /** Optional comparison result to display. */
  comparisonResult?: ComparisonResult | null;
  /** Optional sweep results. */
  sweepSteps?: SweepStepResult[];
  /** Optional per-node headroom data. */
  headroomNodes?: NodeHeadroom[];
  /** Optional system headroom data. */
  systemHeadroom?: SystemHeadroom | null;
  /** Optional SPOF exclusions. */
  spofExclusions?: ExcludedNode[];
}

export function AnalysisPanel({
  openerRef,
  onClose,
  comparisonResult = null,
  sweepSteps = [],
  headroomNodes = [],
  systemHeadroom = null,
  spofExclusions = [],
}: AnalysisPanelProps) {
  const findings = useAnalysisStore((s) => s.findings);
  const suppressions = useAnalysisStore((s) => s.suppressions);
  const completedWindowCount = useAnalysisStore((s) => s.completedWindowCount);
  const incompleteRules = useAnalysisStore((s) => s.incompleteRules);
  const importedFindings = useAnalysisStore((s) => s.importedFindings);

  const nodes = useTopologyStore((s) => s.nodes);
  const subsystemGroups = useTopologyStore((s) => s.subsystemGroups);
  const setGroupCollapsed = useTopologyStore((s) => s.setGroupCollapsed);

  const [activeTab, setActiveTab] = useState<PanelTab>('findings');
  const [offscreenCount, setOffscreenCount] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  // Build node labels map
  const nodeLabels = new Map<string, string>();
  for (const rfNode of nodes) {
    const simNode = rfNode.data as unknown as SimulationNode;
    if (simNode?.id) {
      nodeLabels.set(simNode.id, simNode.label || simNode.id.slice(0, 8));
    }
  }

  // React Flow instance for viewport control
  let reactFlowInstance: ReturnType<typeof useReactFlow> | null = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    reactFlowInstance = useReactFlow();
  } catch {
    // AnalysisPanel may be rendered outside ReactFlowProvider in tests
  }

  // Determine display Findings: imported set or recomputed set
  const displayFindings = importedFindings ?? findings;

  // Determine analysis state
  const hasSufficientWindows = completedWindowCount >= MIN_COMPLETED_WINDOWS;
  const hasFindings = displayFindings.length > 0;

  // Window bounds for display
  const windowBounds = displayFindings.length > 0
    ? {
        start: Math.min(...displayFindings.map((f) => f.window.startMs)),
        end: Math.max(...displayFindings.map((f) => f.window.endMs)),
      }
    : null;

  // SPOF Findings
  const spofFindings = displayFindings.filter((f) => f.category === 'Single_Point_Of_Failure');

  // ─── activateFinding (Tasks 540, 541, 542) ─────────────────────

  const activateFinding = useCallback(
    (finding: Finding) => {
      if (!reactFlowInstance) return;

      // Task 542: system-wide or empty subject set — do nothing to Canvas
      if (finding.subjectNodeIds.length === 0) return;

      // Resolve present subject nodes
      const presentIds = finding.subjectNodeIds.filter((id) => {
        return nodes.some((n) => n.id === id || (n.data as unknown as SimulationNode)?.id === id);
      });

      // Task 542: fully absent — leave Canvas untouched
      if (presentIds.length === 0) return;

      // Task 540: Expand collapsed groups containing present subject nodes
      for (const group of subsystemGroups) {
        if (group.collapsed) {
          const hasSubjectNode = group.memberNodeIds.some((nid: string) => presentIds.includes(nid));
          if (hasSubjectNode) {
            setGroupCollapsed(group.id, false);
          }
        }
      }

      // Set selection to present subject nodes
      const rfNodes = reactFlowInstance.getNodes();
      const updatedNodes = rfNodes.map((n) => ({
        ...n,
        selected: presentIds.includes(n.id),
      }));
      reactFlowInstance.setNodes(updatedNodes);

      // Compute bounding box of selected nodes
      const selectedRfNodes = rfNodes.filter((n) => presentIds.includes(n.id));
      if (selectedRfNodes.length === 0) return;

      const minX = Math.min(...selectedRfNodes.map((n) => n.position.x));
      const minY = Math.min(...selectedRfNodes.map((n) => n.position.y));
      const maxX = Math.max(...selectedRfNodes.map((n) => n.position.x + (n.measured?.width ?? 150)));
      const maxY = Math.max(...selectedRfNodes.map((n) => n.position.y + (n.measured?.height ?? 50)));

      const bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };

      // Fit view with padding
      reactFlowInstance.fitBounds(bounds, { padding: 0.2 });

      // Task 541: Check zoom after fitting
      setTimeout(() => {
        if (!reactFlowInstance) return;
        const viewport = reactFlowInstance.getViewport();
        if (viewport.zoom < ZOOM_FLOOR) {
          reactFlowInstance.setViewport({
            x: -(minX + (maxX - minX) / 2) * ZOOM_FLOOR + window.innerWidth / 2,
            y: -(minY + (maxY - minY) / 2) * ZOOM_FLOOR + window.innerHeight / 2,
            zoom: ZOOM_FLOOR,
          });

          // Count nodes outside viewport at 0.25 zoom
          const vpWidth = window.innerWidth;
          const vpHeight = window.innerHeight;
          const centerX = (minX + maxX) / 2;
          const centerY = (minY + maxY) / 2;
          const halfVpW = vpWidth / (2 * ZOOM_FLOOR);
          const halfVpH = vpHeight / (2 * ZOOM_FLOOR);

          const offscreen = selectedRfNodes.filter((n) => {
            const nx = n.position.x;
            const ny = n.position.y;
            return (
              nx < centerX - halfVpW ||
              nx > centerX + halfVpW ||
              ny < centerY - halfVpH ||
              ny > centerY + halfVpH
            );
          });
          setOffscreenCount(offscreen.length);
        } else {
          setOffscreenCount(0);
        }
      }, 50);
    },
    [reactFlowInstance, nodes, subsystemGroups, setGroupCollapsed],
  );

  // Handle Escape to close panel and return focus (Task 545)
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && panelRef.current?.contains(document.activeElement)) {
        e.preventDefault();
        onClose?.();
        openerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose, openerRef]);

  return (
    <aside
      ref={panelRef}
      role="complementary"
      aria-label="Analysis panel"
      className="flex flex-col h-full border-l border-gray-800 bg-gray-950 w-96 overflow-hidden"
    >
      {/* Panel header */}
      <div className="flex items-center justify-between border-b border-gray-800 px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Analysis
        </h2>
        <button
          type="button"
          onClick={() => {
            onClose?.();
            openerRef.current?.focus();
          }}
          className="rounded p-0.5 text-gray-400 hover:bg-gray-800 hover:text-gray-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          aria-label="Close analysis panel"
        >
          ✕
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 px-2" role="tablist" aria-label="Analysis sections">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`panel-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            className={`px-2 py-1.5 text-[10px] font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-indigo-500 text-indigo-300'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-3">
        {/* Findings tab */}
        {activeTab === 'findings' && (
          <div id="panel-findings" role="tabpanel" aria-label="Findings">
            {/* Task 553: Insufficient windows state */}
            {!hasSufficientWindows && (
              <div className="rounded border border-gray-700 bg-gray-900/60 px-3 py-2 text-xs text-gray-400 mb-3">
                <p>Analysis requires at least {MIN_COMPLETED_WINDOWS} completed metrics windows.</p>
                <p className="text-[10px] text-gray-500 mt-0.5">
                  Completed: {completedWindowCount} / {MIN_COMPLETED_WINDOWS}
                </p>
              </div>
            )}

            {/* Task 553: No findings state */}
            {hasSufficientWindows && !hasFindings && (
              <div className="rounded border border-green-900/50 bg-green-950/30 px-3 py-2 text-xs text-green-400 mb-3">
                <p>Analysis completed — no findings detected.</p>
                {windowBounds && (
                  <p className="text-[10px] text-gray-500 mt-0.5">
                    Window: {windowBounds.start} ms – {windowBounds.end} ms
                  </p>
                )}
              </div>
            )}

            {/* Offscreen count (Task 541) */}
            {offscreenCount > 0 && (
              <div className="rounded border border-amber-800/50 bg-amber-950/30 px-3 py-1.5 text-[10px] text-amber-300 mb-2">
                {offscreenCount} subject node{offscreenCount > 1 ? 's' : ''} outside viewport at minimum zoom.
              </div>
            )}

            {/* Finding list */}
            {hasFindings && (
              <FindingList
                findings={displayFindings}
                onActivateFinding={activateFinding}
                openerRef={openerRef}
              />
            )}

            {/* Task 554: Suppressions */}
            {suppressions.length > 0 && (
              <SuppressionList suppressions={suppressions} nodeLabels={nodeLabels} />
            )}

            {/* Task 554: Budget exhaustion */}
            {incompleteRules && incompleteRules.length > 0 && (
              <div className="mt-3 rounded border border-amber-800/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
                <p className="font-medium mb-0.5">Budget Exhausted</p>
                <p className="text-[10px] text-gray-400">
                  The following rules did not complete: {incompleteRules.join(', ')}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Headroom tab */}
        {activeTab === 'headroom' && (
          <div id="panel-headroom" role="tabpanel" aria-label="Headroom">
            <HeadroomList
              perNode={headroomNodes}
              system={systemHeadroom}
              projectionCaveat={systemHeadroom !== null && systemHeadroom.headroomPercent > 0}
            />
          </div>
        )}

        {/* SPOF tab */}
        {activeTab === 'spof' && (
          <div id="panel-spof" role="tabpanel" aria-label="Single points of failure">
            <SpofList
              spofFindings={spofFindings}
              exclusions={spofExclusions}
              nodeLabels={nodeLabels}
            />
          </div>
        )}

        {/* Sweep tab */}
        {activeTab === 'sweep' && (
          <div id="panel-sweep" role="tabpanel" aria-label="Capacity sweep">
            <CapacitySweepPanel completedSteps={sweepSteps} />
          </div>
        )}

        {/* Comparison tab */}
        {activeTab === 'comparison' && (
          <div id="panel-comparison" role="tabpanel" aria-label="Run comparison">
            {comparisonResult ? (
              <ComparisonTable result={comparisonResult} />
            ) : (
              <p className="text-xs text-gray-500 italic py-4 text-center">
                Select two baseline runs to compare.
              </p>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

// ─── SuppressionList (Task 554) ──────────────────────────────────

function SuppressionList({
  suppressions,
  nodeLabels,
}: {
  suppressions: SuppressionEntry[];
  nodeLabels: Map<string, string>;
}) {
  return (
    <section aria-label="Suppressed findings" className="mt-3">
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
        Suppressed Rules
      </h4>
      <ul className="text-xs text-gray-400" role="list">
        {suppressions.map((s, i) => (
          <li key={i} className="py-0.5 border-b border-gray-800/50 last:border-0">
            <span className="text-gray-300">{s.ruleId}</span>
            <span className="text-gray-500"> — metric: {s.metricName}</span>
            {s.affectedNodeLabels.length > 0 && (
              <span className="text-gray-500">
                {' '}affecting: {s.affectedNodeLabels.map((l) => nodeLabels.get(l) ?? l).join(', ')}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
