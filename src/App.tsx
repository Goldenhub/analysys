import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
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
import { Menu } from 'lucide-react';

/** Reactive height of the floating header, so side panels start below it. */
function useHeaderHeight(ref: React.RefObject<HTMLDivElement | null>): number {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof ResizeObserver === 'undefined') return () => {};
      const el = ref.current;
      if (!el) return () => {};
      const observer = new ResizeObserver(onStoreChange);
      observer.observe(el);
      return () => observer.disconnect();
    },
    () => ref.current?.offsetHeight ?? 0,
    () => 0,
  );
}

export default function App() {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeParentNodeId, setActiveParentNodeId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  // Off-canvas components palette for small screens; the desktop column is always visible.
  const [paletteOpen, setPaletteOpen] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 768,
  );
  const [showTour, setShowTour] = useState(() => !hasCompletedOnboarding());
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const headerHeight = useHeaderHeight(headerRef);
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
    <div className="flex h-dvh w-screen overflow-hidden overscroll-none bg-[#f3ede2] text-[#211e1a]">
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
        <header
          ref={headerRef}
          className="absolute inset-x-0 top-0 z-40 flex min-h-16 flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#5b5347]/15 bg-transparent px-3 py-2 shadow-sm backdrop-blur-sm sm:gap-x-4 sm:px-5"
        >
          <button
            type="button"
            onClick={() => setPaletteOpen((v) => !v)}
            aria-label={paletteOpen ? 'Close components palette' : 'Open components palette'}
            aria-expanded={paletteOpen}
            title="Toggle the components palette"
            className="grid size-8 shrink-0 place-items-center rounded-md border border-[#5b5347]/20 text-[#b8402e] transition hover:border-[#b8402e]/50 hover:bg-[#b8402e]/10"
          >
            <Menu className="size-4" />
          </button>
          <div data-tour="brand" className="min-w-0">
            <p className="text-sm font-semibold">Analysys</p>
            <p className="max-sm:hidden text-xs text-[#5b5347]">Architecture simulation</p>
          </div>
          <div
            className="max-md:order-3 max-md:flex max-md:w-full max-md:flex-wrap max-md:items-center max-md:gap-x-3 max-md:gap-y-1.5 max-md:rounded-lg max-md:border max-md:border-[#5b5347]/15 max-md:bg-[#f3ede2]/70 max-md:px-2 max-md:py-1.5 md:contents"
            aria-label="Toolbar"
          >
            <PresetSelector />
            <div className="hidden h-6 w-px bg-[#5b5347]/20 sm:block" />
            <SimulationToolbar />
            <div className="hidden h-6 w-px bg-[#5b5347]/20 sm:block" />
            <PersistenceToolbar />
          </div>
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
          paletteOpen={paletteOpen}
          onClosePalette={() => setPaletteOpen(false)}
          headerHeight={headerHeight}
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
  paletteOpen,
  onClosePalette,
  headerHeight,
}: {
  activeParentNodeId: string | null;
  setActiveParentNodeId: (id: string | null) => void;
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  paletteOpen: boolean;
  onClosePalette: () => void;
  headerHeight: number;
}) {
  const nodes = useTopologyStore((s) => s.nodes);
  const [contextMenu, setContextMenu] = useState<{ nodeId: string; x: number; y: number } | null>(
    null,
  );
  const layerChildren = activeParentNodeId
    ? nodes.filter((node) => (node.data.parentNodeId ?? null) === activeParentNodeId).length
    : nodes.length;
  const activeLayerNode = nodes.find((node) => node.id === activeParentNodeId);
  const layerParentId = activeLayerNode?.data.parentNodeId ?? null;
  const layerLabel =
    activeLayerNode && 'label' in activeLayerNode.data
      ? activeLayerNode.data.label
      : 'System overview';
  return (
    <main className="absolute inset-0 overflow-hidden">
      <div
        className={`absolute left-4 z-20 mt-1.5 flex items-center gap-2 rounded-lg border border-[#5b5347]/15 bg-[#fffaf2]/95 px-3 py-2 text-xs shadow-sm ${paletteOpen ? 'md:left-64' : 'md:left-4'}`}
        style={{ top: headerHeight }}
      >
        <button onClick={() => setActiveParentNodeId(null)} className="font-medium underline">
          System
        </button>
        {activeParentNodeId && (
          <>
            <span>/</span>
            {layerParentId && (
              <button
                onClick={() => setActiveParentNodeId(layerParentId)}
                className="font-medium underline"
              >
                Up
              </button>
            )}
            <span className="font-semibold">{layerLabel}</span>
          </>
        )}
      </div>
      <aside
        data-tour="palette"
        style={{ top: headerHeight }}
        className={[
          'z-30 absolute bottom-0 left-0 w-60 max-w-[85vw] overflow-y-auto border-r border-[#5b5347]/15 bg-[#fffaf2] p-4 shadow-2xl transition-transform duration-300',
          paletteOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <button
          type="button"
          onClick={onClosePalette}
          aria-label="Close components palette"
          className="absolute right-3 top-3 grid size-7 shrink-0 place-items-center rounded-md border border-[#5b5347]/20 text-[#5b5347]/70 transition hover:border-[#b8402e]/50 hover:text-[#b8402e]"
        >
          ✕
        </button>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#b8402e]">
          Build system
        </p>
        <h2 className="mt-1 text-sm font-semibold">Components</h2>
        <NodePalette parentNodeId={activeParentNodeId} />
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
      <section className="absolute inset-0">
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
          <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 flex -translate-y-1/2 justify-center">
            <div className="rounded-lg border border-dashed border-[#b8402e]/40 bg-[#fffaf2]/95 px-4 py-3 text-sm text-[#5b5347] shadow-sm">
              This component layer is empty — drag components from the palette to build it.
            </div>
          </div>
        )}
      </section>
      {selectedNodeId && (
        <div className="absolute bottom-0 right-0 z-[9999]" style={{ top: headerHeight }}>
          <NodeConfigPanel
            selectedNodeId={selectedNodeId}
            onClose={() => setSelectedNodeId(null)}
          />
        </div>
      )}
      <AnalysisPanelWrapper topOffset={headerHeight} />
      <div className="absolute inset-x-3 bottom-3 z-10 md:left-52">
        <div className="overflow-hidden rounded-lg shadow-2xl ring-1 ring-[#211e1a]/20">
          <TelemetryDashboard />
        </div>
      </div>
    </main>
  );
}

function AnalysisPanelWrapper({ topOffset }: { topOffset: number }) {
  const open = useAnalysisPanelStore((s) => s.isOpen);
  const close = useAnalysisPanelStore((s) => s.close);
  const ref = useRef<HTMLElement | null>(null);
  // Desktop: a sidebar under the header (z-20). Mobile: a full-screen overlay
  // that must sit above every other layer — the header (z-40), palette (z-30)
  // and the node config panel (z-[9999]). This wrapper is the stacking context
  // the panel lives in, so the bump has to be here, not on the inner <aside>.
  return open ? (
    <div
      className="absolute bottom-0 right-0 z-20 max-md:z-[10000]"
      style={{ top: topOffset }}
    >
      <AnalysisPanel openerRef={ref} onClose={close} />
    </div>
  ) : null;
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
