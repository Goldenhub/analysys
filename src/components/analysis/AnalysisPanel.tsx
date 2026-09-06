import { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import { useAnalysisStore } from '@/store/analysisStore';
import { useTopologyStore } from '@/store/topologyStore';
import { useSimulationStore } from '@/store/simulationStore';
import { useSweepStore } from '@/store/sweepStore';
import { useBaselineStore } from '@/store/baselineStore';
import { getViewportState, subscribeViewport, requestViewportChange } from '@/canvas/viewportBus';
import type { Finding, SuppressionEntry } from '@/types/findings';
import type { SimulationNode } from '@/types/nodes';
import { SimState } from '@/simulation/types';
import { MIN_COMPLETED_WINDOWS } from '@/analysis/AnalysisWindowStore';
import { FindingList } from './FindingList';
import { ComparisonTable } from './ComparisonTable';
import { SpofList } from './SpofList';
import { BaselineManager } from './BaselineManager';
import { CapacitySweepPanel } from './CapacitySweepPanel';
import {
  compareRuns,
  isComparisonError,
  type ComparisonResult,
  type ComparisonError,
} from '@/analysis/comparison';
import { computeStepLoads } from '@/analysis/CapacitySweepController';
import {
  exportJSON as buildReportJSON,
  exportMarkdown as buildReportMarkdown,
} from '@/analysis/report';
import { downloadTextFile } from '@/utils/download';
import { showToast } from '@/components/ui/toastStore';

// ─── Constants ───────────────────────────────────────────────────

const ZOOM_FLOOR = 0.25;

// ─── Tab definitions ─────────────────────────────────────────────

type PanelTab = 'findings' | 'spof' | 'sweep' | 'comparison';

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'findings', label: 'Findings' },
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
}

export function AnalysisPanel({ openerRef, onClose }: AnalysisPanelProps) {
  const findings = useAnalysisStore((s) => s.findings);
  const suppressions = useAnalysisStore((s) => s.suppressions);
  const completedWindowCount = useAnalysisStore((s) => s.completedWindowCount);
  const incompleteRules = useAnalysisStore((s) => s.incompleteRules);
  const importedFindings = useAnalysisStore((s) => s.importedFindings);

  const nodes = useTopologyStore((s) => s.nodes);
  const onNodesChange = useTopologyStore((s) => s.onNodesChange);

  // Capacity sweep: live progress + wired controls (Phase: sweep end-to-end)
  const sweepStatus = useSweepStore((s) => s.status);
  const sweepConfig = useSweepStore((s) => s.config);
  const sweepResults = useSweepStore((s) => s.results);
  const sweepReport = useSweepStore((s) => s.report);
  const startCapacitySweep = useSimulationStore((s) => s.startCapacitySweep);
  const cancelCapacitySweep = useSimulationStore((s) => s.cancelCapacitySweep);

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

  // Current canvas viewport, kept in sync via the viewport bus. The AnalysisPanel
  // is rendered as a sibling of the canvas (outside the engine's React provider),
  // so it reads/drives the viewport through the bus instead of React context.
  const [, forceViewportVersion] = useState(0);
  useEffect(() => subscribeViewport(() => forceViewportVersion((n) => n + 1)), []);

  // Determine display Findings: imported set or recomputed set
  const displayFindings = importedFindings ?? findings;

  // Determine analysis state
  const hasSufficientWindows = completedWindowCount >= MIN_COMPLETED_WINDOWS;
  const hasFindings = displayFindings.length > 0;

  // Window bounds for display
  const windowBounds =
    displayFindings.length > 0
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
      // Task 542: system-wide or empty subject set — do nothing to Canvas
      if (finding.subjectNodeIds.length === 0) return;

      // Resolve present subject nodes
      const presentIds = finding.subjectNodeIds.filter((id) => {
        return nodes.some((n) => n.id === id || (n.data as unknown as SimulationNode)?.id === id);
      });

      // Task 542: fully absent — leave Canvas untouched
      if (presentIds.length === 0) return;

      // Set selection to present subject nodes
      const selectionChanges = nodes
        .filter((n) => !(n.data as unknown as SimulationNode)?.id || presentIds.includes((n.data as unknown as SimulationNode).id))
        .map((n) => ({
          type: 'select' as const,
          id: n.id,
          selected: presentIds.includes(n.id),
        }));
      onNodesChange(selectionChanges);

      // Compute bounding box of selected nodes
      const selectedNodes = nodes.filter((n) => presentIds.includes(n.id));
      if (selectedNodes.length === 0) return;

      const minX = Math.min(...selectedNodes.map((n) => n.position.x));
      const minY = Math.min(...selectedNodes.map((n) => n.position.y));
      const maxX = Math.max(
        ...selectedNodes.map((n) => n.position.x + (n.width ?? 140)),
      );
      const maxY = Math.max(
        ...selectedNodes.map((n) => n.position.y + (n.height ?? 80)),
      );

      const bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };

      // Fit view to the finding's nodes with padding
      requestViewportChange({ type: 'fitBounds', bounds, padding: 60 });

      // Task 541: after fitting, check whether the viewport fell below the zoom floor;
      // if so snap to the floor centered on the finding and count the offscreen nodes.
      setTimeout(() => {
        const current = getViewportState();
        const vp = current.viewport;
        if (vp.zoom < ZOOM_FLOOR) {
          const { width: sizeW, height: sizeH } = current.size;
          requestViewportChange({
            type: 'set',
            viewport: {
              x: -(minX + (maxX - minX) / 2) * ZOOM_FLOOR + sizeW / 2,
              y: -(minY + (maxY - minY) / 2) * ZOOM_FLOOR + sizeH / 2,
              zoom: ZOOM_FLOOR,
            },
          });

          const halfVpW = sizeW / (2 * ZOOM_FLOOR);
          const halfVpH = sizeH / (2 * ZOOM_FLOOR);
          const centerX = (minX + maxX) / 2;
          const centerY = (minY + maxY) / 2;

          const offscreen = selectedNodes.filter((n) => {
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
    [nodes, onNodesChange],
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

  // ─── Report Export ────────────────────────────────────────────

  const buildExportContext = useCallback(() => {
    const topo = useTopologyStore.getState().getTopologySnapshot();
    const runSummary = useSimulationStore.getState().runSummary;
    const offeredLoadRps = topo.nodes
      .filter((n) => n.nodeType === 'TRAFFIC_GENERATOR')
      .reduce(
        (sum, n) => sum + Number((n.config as unknown as Record<string, unknown>)['rps'] ?? 0),
        0,
      );
    return {
      findings,
      topology: topo,
      nodeConfigurations: Object.fromEntries(topo.nodes.map((n) => [n.id, n.config])) as Record<
        string,
        unknown
      >,
      seed: runSummary?.seed ?? 0,
      simulatedDurationMs: runSummary?.simulatedDurationMs ?? 0,
      offeredLoadRps,
    };
  }, [findings]);

  const exportReport = (format: 'md' | 'json') => {
    const stamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-');
    if (format === 'json') {
      downloadTextFile(
        buildReportJSON(buildExportContext()),
        `analysys-report-${stamp}.json`,
        'application/json',
      );
    } else {
      downloadTextFile(
        buildReportMarkdown(buildExportContext()),
        `analysys-report-${stamp}.md`,
        'text/markdown',
      );
    }
  };

  return (
    <aside
      ref={panelRef}
      role="complementary"
      aria-label="Analysis panel"
      className="flex flex-col h-full border-l border-[#5b5347]/20 bg-[#f3ede2] w-96 overflow-hidden"
    >
      {/* Panel header */}
      <div className="flex items-center justify-between border-b border-[#5b5347]/20 px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[#211e1a]/80">Analysis</h2>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => exportReport('md')}
            title="Download the findings report as Markdown"
            className="rounded border border-[#5b5347]/40 bg-[#5b5347] px-1.5 py-0.5 text-[10px] text-[#f3ede2] hover:border-[#5b5347] hover:text-[#f3ede2] focus:outline-none focus:ring-1 focus:ring-[#b8402e]"
          >
            ⬇ MD
          </button>
          <button
            type="button"
            onClick={() => exportReport('json')}
            title="Download the findings report as JSON (re-importable)"
            className="rounded border border-[#5b5347]/40 bg-[#5b5347] px-1.5 py-0.5 text-[10px] text-[#f3ede2] hover:border-[#5b5347] hover:text-[#f3ede2] focus:outline-none focus:ring-1 focus:ring-[#b8402e]"
          >
            ⬇ JSON
          </button>
          <button
            type="button"
            onClick={() => {
              onClose?.();
              openerRef.current?.focus();
            }}
            className="rounded p-0.5 text-[#5b5347]/70 hover:bg-[#5b5347]/80 hover:text-[#f3ede2] focus:outline-none focus:ring-1 focus:ring-[#b8402e]"
            aria-label="Close analysis panel"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div
        className="flex border-b border-[#5b5347]/20 px-2"
        role="tablist"
        aria-label="Analysis sections"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`panel-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            className={`px-2 py-1.5 text-[10px] font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-[#b8402e] text-[#b8402e]'
                : 'border-transparent text-[#5b5347]/70 hover:text-[#5b5347]'
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
              <div className="rounded border border-[#5b5347]/30 bg-[#5b5347]/60 px-3 py-2 text-xs text-[#211e1a]/85 mb-3">
                <p>Analysis requires at least {MIN_COMPLETED_WINDOWS} completed metrics windows.</p>
                <p className="text-[10px] text-[#211e1a]/65 mt-0.5">
                  Completed: {completedWindowCount} / {MIN_COMPLETED_WINDOWS}
                </p>
              </div>
            )}

            {/* Task 553: No findings state */}
            {hasSufficientWindows && !hasFindings && (
              <div className="rounded border border-[#6b8f71]/50/50 bg-[#6b8f71]/10 px-3 py-2 text-xs text-[#4d6b52] mb-3">
                <p>Analysis completed — no findings detected.</p>
                {windowBounds && (
                  <p className="text-[10px] text-[#5b5347]/70 mt-0.5">
                    Window: {windowBounds.start} ms – {windowBounds.end} ms
                  </p>
                )}
              </div>
            )}

            {/* Offscreen count (Task 541) */}
            {offscreenCount > 0 && (
              <div className="rounded border border-[#c49a3c]/50/50 bg-[#c49a3c]/10 px-3 py-1.5 text-[10px] text-[#8a6418] mb-2">
                {offscreenCount} subject node{offscreenCount > 1 ? 's' : ''} outside viewport at
                minimum zoom.
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
              <div className="mt-3 rounded border border-[#c49a3c]/50/50 bg-[#c49a3c]/10 px-3 py-2 text-xs text-[#8a6418]">
                <p className="font-medium mb-0.5">Budget Exhausted</p>
                <p className="text-[10px] text-[#5b5347]/70">
                  The following rules did not complete: {incompleteRules.join(', ')}
                </p>
              </div>
            )}
          </div>
        )}

        {/* SPOF tab */}
        {activeTab === 'spof' && (
          <div id="panel-spof" role="tabpanel" aria-label="Single points of failure">
            <SpofList spofFindings={spofFindings} nodeLabels={nodeLabels} />
          </div>
        )}

        {/* Sweep tab */}
        {activeTab === 'sweep' && (
          <div id="panel-sweep" role="tabpanel" aria-label="Capacity sweep">
            <CapacitySweepPanel
              completedSteps={sweepResults}
              onStartSweep={startCapacitySweep}
              onCancelSweep={cancelCapacitySweep}
              isRunning={sweepStatus === 'running'}
              progress={
                sweepStatus === 'running' && sweepConfig
                  ? {
                      currentStep: sweepResults.length + 1,
                      totalSteps: sweepConfig.stepCount,
                      currentRequestedRps:
                        computeStepLoads(
                          sweepConfig.startRps,
                          sweepConfig.endRps,
                          sweepConfig.stepCount,
                        )?.[Math.min(sweepResults.length, sweepConfig.stepCount - 1)] ?? 0,
                      elapsedMs: 0,
                      completedSteps: sweepResults,
                    }
                  : null
              }
            />
            {sweepReport && (
              <div className="mt-3 rounded-md border border-[#5b5347]/30 bg-[#5b5347]/60 p-3 text-xs text-[#211e1a]/85">
                <p className="font-semibold text-[#211e1a]">
                  {sweepReport.status === 'completed' ? 'Sweep complete' : 'Sweep cancelled'}
                </p>
                {sweepReport.status === 'cancelled' && (
                  <p className="mt-1">
                    Cancelled at step {(sweepReport.cancelledAtStep ?? 0) + 1}.
                  </p>
                )}
                <p className="mt-1">
                  Sustainable load:{' '}
                  <span className="font-mono">
                    {sweepReport.sustainableLoad.offeredRps !== null
                      ? `${sweepReport.sustainableLoad.offeredRps} RPS`
                      : 'undetermined'}
                  </span>
                  {sweepReport.sustainableLoad.explanation && (
                    <span className="block text-[11px] text-[#211e1a]/70">
                      {sweepReport.sustainableLoad.explanation}
                    </span>
                  )}
                </p>
                {sweepReport.kneePoint && (
                  <p className="mt-1">
                    Knee point:{' '}
                    <span className="font-mono">
                      {sweepReport.kneePoint.offeredRps} RPS (step{' '}
                      {sweepReport.kneePoint.stepIndex + 1})
                    </span>
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Comparison tab */}
        {activeTab === 'comparison' && (
          <div
            id="panel-comparison"
            role="tabpanel"
            aria-label="Run comparison"
            className="flex flex-col gap-4"
          >
            {/* Retain the current run as a baseline */}
            <RetainBaselineControl />

            {/* Manage saved baselines */}
            <section aria-label="Saved baselines">
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#5b5347]/80">
                Saved baselines
              </h3>
              <BaselineManager />
            </section>

            {/* A/B comparison */}
            <ComparisonPicker />
          </div>
        )}
      </div>
    </aside>
  );
}

// ─── Baseline retention + comparison wiring ──────────────────────

/** Retain the finished run (whole-run totals + final per-node snapshot) as a named baseline. */
function RetainBaselineControl() {
  const runSummary = useSimulationStore((s) => s.runSummary);
  const simState = useSimulationStore((s) => s.simState);
  const metrics = useSimulationStore((s) => s.metrics);
  const retainBaseline = useBaselineStore((s) => s.retainBaseline);
  const getTopologySnapshot = useTopologyStore((s) => s.getTopologySnapshot);
  const [name, setName] = useState('');

  const canRetain = simState === SimState.Complete && runSummary !== null;
  const offeredRps = useMemo(() => {
    if (!runSummary) return 0;
    const topo = getTopologySnapshot();
    return topo.nodes
      .filter((n) => n.nodeType === 'TRAFFIC_GENERATOR')
      .reduce(
        (sum, n) => sum + Number((n.config as unknown as Record<string, unknown>)['rps'] ?? 0),
        0,
      );
    // Recompute on demand only — topology churn is irrelevant while disabled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runSummary]);

  function handleRetain() {
    if (!runSummary) return;
    const trimmed = name.trim();
    if (!trimmed) {
      showToast('Give this baseline a name first.');
      return;
    }
    const topo = getTopologySnapshot();
    const configById = new Map(topo.nodes.map((n) => [n.id, n.config]));
    const perNode: Record<string, import('@/types/baseline').PerNodeAggregates> = {};
    for (const snap of metrics?.nodes ?? []) {
      perNode[snap.nodeId] = {
        nodeId: snap.nodeId,
        nodeType: 'UNKNOWN',
        label: snap.nodeId,
        meanUtilization: snap.utilization.kind === 'value' ? snap.utilization.value : 0,
        throughput: snap.throughput,
        errorRate: snap.errorRate,
        meanQueueDepth: snap.queueDepth,
        config: (configById.get(snap.nodeId) ?? {}) as Record<string, unknown>,
      };
    }

    const error = retainBaseline({
      name: trimmed,
      seed: runSummary.seed,
      simulatedDurationMs: runSummary.simulatedDurationMs,
      totalOfferedRps: offeredRps,
      topology: {
        schemaVersion: 3,
        nodes: topo.nodes,
        edges: topo.edges,
      },
      wholeRun: runSummary.wholeRun ?? {
        latency: { p50: 0, p90: 0, p99: 0 },
        throughput: 0,
        errorRate: 0,
        terminalStatusRates: {},
      },
      perNode,
    });
    if (error) {
      showToast(`Could not save baseline: ${error}`);
    } else {
      showToast(`Baseline "${trimmed}" saved.`, 'info');
      setName('');
    }
  }

  return (
    <section
      aria-label="Save current run as baseline"
      className="rounded-md border border-[#5b5347]/30 bg-[#5b5347]/60 p-3"
    >
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#211e1a]/85">
        Save current run
      </h3>
      {!canRetain ? (
        <p className="text-[11px] text-[#211e1a]/70">Finish a simulation to enable baseline capture.</p>
      ) : (
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Baseline name…"
            maxLength={40}
            className="h-7 flex-1 rounded-md border border-[#5b5347]/30 bg-[#5b5347]/80 px-2 text-xs text-[#f3ede2] outline-none focus:border-[#b8402e]"
            aria-label="Baseline name"
          />
          <button
            onClick={handleRetain}
            className="rounded-md border border-transparent bg-[#b8402e] px-2 py-1 text-[10px] font-medium text-[#f3ede2] hover:bg-[#9a3525] focus:outline-none focus:ring-1 focus:ring-[#b8402e]"
            title="Capture the finished run's totals and topology for later comparison"
          >
            Save baseline
          </button>
        </div>
      )}
    </section>
  );
}

/** Two dropdowns over saved baselines; computes B − A with the existing comparison engine. */
function ComparisonPicker() {
  const baselines = useBaselineStore((s) => s.baselines);
  const [nameA, setNameA] = useState('');
  const [nameB, setNameB] = useState('');

  const comparison: ComparisonResult | ComparisonError | null = useMemo(() => {
    const runA = baselines.find((b) => b.name === nameA);
    const runB = baselines.find((b) => b.name === nameB);
    if (!runA || !runB) return null;
    return compareRuns({ name: runA.name, run: runA }, { name: runB.name, run: runB });
  }, [baselines, nameA, nameB]);

  const selectClass =
    'h-7 flex-1 rounded-md border border-[#5b5347]/30 bg-[#5b5347]/80 px-2 text-xs text-[#f3ede2] outline-none focus:border-[#b8402e]';

  if (baselines.length < 2) {
    return (
      <p className="py-4 text-center text-xs italic text-[#5b5347]/70">
        Save at least two baselines to compare runs.
      </p>
    );
  }

  return (
    <section aria-label="Compare two baselines" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="w-6 text-[10px] font-semibold text-[#5b5347]/80">A</span>
        <select
          value={nameA}
          onChange={(e) => setNameA(e.target.value)}
          className={selectClass}
          aria-label="Baseline A"
        >
          <option value="">Select run A…</option>
          {baselines.map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-6 text-[10px] font-semibold text-[#5b5347]/80">B</span>
        <select
          value={nameB}
          onChange={(e) => setNameB(e.target.value)}
          className={selectClass}
          aria-label="Baseline B"
        >
          <option value="">Select run B…</option>
          {baselines.map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
      {comparison === null ? (
        <p className="py-2 text-center text-xs italic text-[#5b5347]/70">
          Select two different saved runs to compare.
        </p>
      ) : isComparisonError(comparison) ? (
        <p className="rounded-md border border-[#c49a3c]/60/60 bg-[#c49a3c]/10 px-3 py-2 text-[11px] text-[#8a6418]">
          {comparison.message}
        </p>
      ) : (
        <ComparisonTable result={comparison} />
      )}
    </section>
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
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[#5b5347]/80 mb-1">
        Suppressed Rules
      </h4>
      <ul className="text-xs text-[#5b5347]/85" role="list">
        {suppressions.map((s, i) => (
          <li key={i} className="py-0.5 border-b border-[#5b5347]/20/50 last:border-0">
            <span className="text-[#211e1a]/85">{s.ruleId}</span>
            <span className="text-[#5b5347]/70"> — metric: {s.metricName}</span>
            {s.affectedNodeLabels.length > 0 && (
              <span className="text-[#5b5347]/70">
                {' '}
                affecting: {s.affectedNodeLabels.map((l) => nodeLabels.get(l) ?? l).join(', ')}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
