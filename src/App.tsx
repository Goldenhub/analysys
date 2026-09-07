import { useEffect, useRef, useState } from 'react';
import { CanvasEditor } from '@/components/canvas/CanvasEditor';
import { NodeContextMenu } from '@/components/canvas/NodeContextMenu';
import { NodePalette } from '@/components/canvas/NodePalette';
import { NodeConfigPanel } from '@/components/config/NodeConfigPanel';
import { useTopologyStore } from '@/store/topologyStore';
import { useSimulationStore } from '@/store/simulationStore';
import { usePersistenceStore } from '@/store/persistenceStore';
import { isVisualNode } from '@/canvas';
import { canBeParent } from '@/utils/parenting';
import {
  SimulationToolbar,
  ChaosPanel,
  ActiveChaosStrip,
  PersistenceToolbar,
} from '@/components/controls';
import { PresetSelector } from '@/components/presets';
import { HelpIcon, HelpModal } from '@/components/help/HelpModal';
import { TelemetryDashboard } from '@/components/telemetry';
import { LiveAnnouncer } from '@/components/a11y/LiveAnnouncer';
import { ToastViewport } from '@/components/ui/toast';
import { showToast } from '@/components/ui/toastStore';
import { AnalysisPanel } from '@/components/analysis/AnalysisPanel';
import { useAnalysisPanelStore } from '@/store/analysisPanelStore';
import {
  OnboardingTour,
  hasCompletedOnboarding,
  markOnboardingCompleted,
  resetOnboarding,
  type OnboardingStep,
} from '@/components/onboarding/OnboardingTour';
import { Analytics } from '@vercel/analytics/react';

export default function App() {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeParentNodeId, setActiveParentNodeId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [showTour, setShowTour] = useState(() => !hasCompletedOnboarding());
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const restored = useRef(false);

  // Boot: restore the autosaved working canvas exactly once per session.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    usePersistenceStore.getState().restoreAutosave();
  }, []);

  // Autosave the working canvas on any change.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => usePersistenceStore.getState().autosave(), 400);
    };
    const unsubscribeTopology = useTopologyStore.subscribe(schedule);
    const unsubscribeSimulation = useSimulationStore.subscribe(schedule);
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribeTopology();
      unsubscribeSimulation();
    };
  }, []);

  const finishTour = () => {
    markOnboardingCompleted();
    setShowTour(false);
  };

  const replayTour = () => {
    resetOnboarding();
    setShowTour(true);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#f3ede2] text-[#211e1a]">
      <LiveAnnouncer />
      <ToastViewport />
      <HelpModal
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
        openerRef={helpButtonRef}
        onReplayTour={replayTour}
      />
      {showTour && (
        <OnboardingTour steps={ONBOARDING_STEPS} onFinish={finishTour} onSkip={finishTour} />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2 border-b border-[#5b5347]/15 bg-[#fffaf2] px-5 py-2">
          <div data-tour="brand" className="min-w-0">
            <p className="text-sm font-semibold">Analysys</p>
            <p className="text-xs text-[#5b5347]">Architecture simulation</p>
          </div>
          <PresetSelector />
          <div className="hidden h-6 w-px bg-[#5b5347]/20 sm:block" />
          <SimulationToolbar />
          <div className="hidden h-6 w-px bg-[#5b5347]/20 sm:block" />
          <PersistenceToolbar />
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <ActiveChaosStrip />
            <ChaosPanel />
            <button
              type="button"
              ref={helpButtonRef}
              onClick={() => setHelpOpen(true)}
              aria-label="How to use Analysys"
              title="How to use Analysys"
              className="grid size-8 place-items-center rounded-md border border-[#5b5347]/20 text-[#b8402e] transition hover:border-[#b8402e]/50 hover:bg-[#b8402e]/10"
              data-tour="help"
            >
              <HelpIcon />
            </button>
          </div>
        </header>
        <CanvasWorkspace
          activeParentNodeId={activeParentNodeId}
          setActiveParentNodeId={setActiveParentNodeId}
          selectedNodeId={selectedNodeId}
          setSelectedNodeId={setSelectedNodeId}
        />
      </div>
      <Analytics />
    </div>
  );
}

function CanvasWorkspace({
  activeParentNodeId,
  setActiveParentNodeId,
  selectedNodeId,
  setSelectedNodeId,
}: {
  activeParentNodeId: string | null;
  setActiveParentNodeId: (id: string | null) => void;
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
}) {
  const nodes = useTopologyStore((s) => s.nodes);
  const [contextMenu, setContextMenu] = useState<{ nodeId: string; x: number; y: number } | null>(
    null,
  );
  const current = nodes.find((node) => node.id === activeParentNodeId);
  const parentId = current?.data.parentNodeId ?? null;
  const label = current && 'label' in current.data ? current.data.label : 'System overview';
  const layerChildren = activeParentNodeId
    ? nodes.filter((node) => (node.data.parentNodeId ?? null) === activeParentNodeId).length
    : nodes.length;
  return (
    <main className="relative flex min-h-0 flex-1 overflow-hidden">
      <aside
        data-tour="palette"
        className="z-10 w-60 overflow-y-auto border-r border-[#5b5347]/15 bg-[#fffaf2] p-4"
      >
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#b8402e]">
          Build system
        </p>
        <h2 className="mt-1 text-sm font-semibold">Components</h2>
        <NodePalette />
        <button
          type="button"
          onClick={() => {
            const hadContent =
              useTopologyStore.getState().nodes.length > 0 ||
              useTopologyStore.getState().edges.length > 0;
            useTopologyStore.getState().clearCanvas();
            // Clear the telemetry dashboard alongside the canvas.
            useSimulationStore.getState().resetMetrics();
            setSelectedNodeId(null);
            setActiveParentNodeId(null);
            setContextMenu(null);
            if (hadContent) showToast('Canvas cleared');
          }}
          className="mt-4 w-full rounded-md border border-[#b8402e]/30 px-3 py-1.5 text-xs font-semibold text-[#b8402e] transition hover:border-[#b8402e]/60 hover:bg-[#b8402e]/10"
        >
          Clear canvas
        </button>
      </aside>
      <section className="relative min-w-0 flex-1">
        <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-lg border border-[#5b5347]/15 bg-[#fffaf2]/95 px-3 py-2 text-xs shadow-sm">
          <button onClick={() => setActiveParentNodeId(null)} className="font-medium underline">
            System
          </button>
          {activeParentNodeId && (
            <>
              <span>/</span>
              {parentId && (
                <button
                  onClick={() => setActiveParentNodeId(parentId)}
                  className="font-medium underline"
                >
                  Up
                </button>
              )}
              <span className="font-semibold">{label}</span>
            </>
          )}
        </div>
        <CanvasEditor
          activeParentNodeId={activeParentNodeId}
          onEnterComponent={(id) => {
            const parent = nodes.find((node) => node.id === id);
            const nodeType = parent && 'nodeType' in parent.data ? parent.data.nodeType : null;
            if (parent && (nodeType === null || !canBeParent(nodeType))) {
              const parentLabel = 'label' in parent.data ? parent.data.label : nodeType;
              showToast(
                `${parentLabel} can't hold a component layer — only services (gateways, app servers, worker pools, auth services) decompose into internals.`,
              );
              return;
            }
            setSelectedNodeId(null);
            setActiveParentNodeId(id);
          }}
          onNodeContextMenu={(nodeId, position) =>
            setContextMenu({ nodeId, x: position.x, y: position.y })
          }
          onNodeSelect={(nodeId) => {
            setContextMenu(null);
            if (!nodeId) {
              setSelectedNodeId(null);
              return;
            }
            // Transfer the selection ring to the clicked node.
            useTopologyStore
              .getState()
              .onNodesChange([{ type: 'select', id: nodeId, selected: true }]);
            const node = nodes.find((candidate) => candidate.id === nodeId);
            setSelectedNodeId(node && !isVisualNode(node) ? nodeId : null);
          }}
          onBackgroundClick={() => {
            setSelectedNodeId(null);
            setContextMenu(null);
            useTopologyStore.getState().clearSelection();
          }}
        />
        {contextMenu && (
          <NodeContextMenu
            nodeId={contextMenu.nodeId}
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            onDetails={(id) => {
              const node = nodes.find((candidate) => candidate.id === id);
              setSelectedNodeId(node && !isVisualNode(node) ? id : null);
              useTopologyStore.getState().onNodesChange([{ type: 'select', id, selected: true }]);
            }}
            onDelete={(id) => {
              useTopologyStore.getState().removeNode(id);
              if (selectedNodeId === id) setSelectedNodeId(null);
            }}
          />
        )}
        {activeParentNodeId && layerChildren === 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-20 z-10 flex justify-center">
            <div className="rounded-lg border border-dashed border-[#b8402e]/40 bg-[#fffaf2]/95 px-4 py-3 text-sm text-[#5b5347] shadow-sm">
              This component layer is empty — drag components from the palette to build it.
            </div>
          </div>
        )}
      </section>
      {selectedNodeId && (
        <NodeConfigPanel selectedNodeId={selectedNodeId} onClose={() => setSelectedNodeId(null)} />
      )}
      <AnalysisPanelWrapper />
      <div className="absolute bottom-0 left-60 right-0 z-10">
        <TelemetryDashboard />
      </div>
    </main>
  );
}

function AnalysisPanelWrapper() {
  const open = useAnalysisPanelStore((s) => s.isOpen);
  const close = useAnalysisPanelStore((s) => s.close);
  const ref = useRef<HTMLElement | null>(null);
  return open ? <AnalysisPanel openerRef={ref} onClose={close} /> : null;
}

// ─── Onboarding tour steps ────────────────────────────────────────

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    target: '[data-tour="brand"]',
    title: 'Welcome to Analysys',
    body: 'An architecture simulator that runs entirely in your browser — no servers, no accounts. This short tour shows you the essentials.',
  },
  {
    target: '[data-tour="help"]',
    title: 'Get help anytime',
    body: 'The «?» button in the header opens the help panel — a full walkthrough of every feature, and the place to replay this tour whenever you need it.',
  },
  {
    target: '[data-tour="presets"]',
    title: 'Start from a reference',
    body: 'Load a pre-built architecture to explore, or start from an empty canvas. Presets come with a simulation seed, load level, and baked-in chaos timeline ready to run.',
  },
  {
    target: '[data-tour="sim"]',
    title: 'Run the simulation',
    body: 'Set a duration, speed multiplier (up to 50×), and a reproducible seed, then press Start. Space toggles play/pause and R resets the run at any time.',
  },
  {
    target: '[data-tour="persist"]',
    title: 'Save & export',
    body: 'Save keeps a topology in this browser for later. Export downloads your work as JSON so you can re-import it or share it with a teammate.',
  },
  {
    target: '[data-tour="palette"]',
    title: 'Build your architecture',
    body: 'Drag nodes onto the canvas and connect them by their handles — traffic generators, app servers, caches, queues, databases, and more. Only valid connections are accepted.',
  },
  {
    target: '[data-testid="canvas-engine"]',
    title: 'Shape the canvas',
    body: 'Click a node to select it, drag to move it, and right-click it for a Details or Delete menu. The «⌄» chip on a node opens its nested component layer.',
  },
  {
    target: '[data-tour="chaos"]',
    title: 'Test resilience',
    body: 'Inject latency spikes, error rates, or full outages to see how the system degrades and recovers. Results replay into the metrics so you can compare impact over time.',
  },
  {
    target: '[aria-label="Telemetry dashboard"]',
    title: 'Watch it live',
    body: 'The dashboard streams throughput, latency, error rates, queue depth, and terminal statuses. Once a run has real data, open Analysis for findings and single-point-of-failure checks.',
  },
];
