import { useState, useEffect, useCallback, useRef } from 'react';
import { CanvasEditor } from '@/components/canvas/CanvasEditor';
import { NodePalette } from '@/components/canvas/NodePalette';
import { NodeConfigPanel } from '@/components/config/NodeConfigPanel';
import {
  SimulationToolbar,
  ChaosPanel,
  PersistenceToolbar,
  ActiveChaosStrip,
} from '@/components/controls';
import { ThemeSwitcher } from '@/components/controls/ThemeSwitcher';
import { PresetSelector } from '@/components/presets';
import { TelemetryDashboard } from '@/components/telemetry';
import { LiveAnnouncer } from '@/components/a11y/LiveAnnouncer';
import { AnalysisPanel } from '@/components/analysis/AnalysisPanel';
import { ToastViewport } from '@/components/ui/toast';
import { useAnalysisPanelStore } from '@/store/analysisPanelStore';

function App() {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Task 232: Escape closes config panel and deselects node
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape' && selectedNodeId) {
        setSelectedNodeId(null);
      }
    },
    [selectedNodeId],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-950 text-white max-xl:flex-col">
      {/* Aria-live announcement regions (Tasks 233-234) */}
      <LiveAnnouncer />

      {/* Application-wide rejection/notification toasts */}
      <ToastViewport />

      {/* Left Sidebar — Node Palette (tabIndex 1) */}
      <aside
        className="flex w-60 flex-col overflow-y-auto min-h-0 border-r border-gray-800 bg-gray-900/50 p-4 transition-all duration-300 max-xl:w-full max-xl:flex-row max-xl:items-center max-xl:gap-4 max-xl:border-b max-xl:border-r-0 max-xl:py-2"
        tabIndex={1}
        aria-label="Node palette sidebar"
      >
        <h1 className="text-lg font-bold">Analysys</h1>
        <span className="mb-3 text-xs text-gray-500">Architecture Simulator</span>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-400 max-xl:mb-0">
          Node Palette
        </h2>
        <p className="mb-4 text-xs text-gray-500 max-xl:mb-0 max-xl:hidden">
          Drag nodes onto the canvas to build your topology.
        </p>
        <NodePalette />
      </aside>

      {/* Main Content Area — Canvas + Dashboard */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header / Toolbar (tabIndex 4) */}
        <header
          className="flex flex-wrap items-center gap-4 border-b border-gray-800 px-4 py-2"
          tabIndex={4}
          aria-label="Simulation toolbar"
        >
          {/* Preset Selector */}
          <div>
            <PresetSelector />
          </div>

          {/* Simulation Controls */}
          <div className="ml-4 border-l border-gray-700 pl-4">
            <SimulationToolbar />
          </div>

          {/* Persistence Controls */}
          <div className="ml-4 border-l border-gray-700 pl-4">
            <PersistenceToolbar />
          </div>

          {/* Theme Switcher */}
          <div className="ml-4 border-l border-gray-700 pl-4">
            <ThemeSwitcher />
          </div>

          {/* Chaos Controls (tabIndex 5) */}
          <div className="ml-auto flex items-center gap-4" tabIndex={5} aria-label="Chaos controls">
            <ActiveChaosStrip />
            <ChaosPanel />
          </div>
        </header>

        {/* Canvas Area (tabIndex 2) — with Analysis Panel and Config Panel alongside */}
        <main
          className="relative flex flex-1 overflow-hidden"
          tabIndex={2}
          aria-label="Topology canvas"
        >
          <div className="flex-1 relative">
            <CanvasEditor onNodeSelect={setSelectedNodeId} />
          </div>
          {/* Analysis Panel (Task 536): renders alongside Canvas, Canvas pan/zoom/selection unchanged */}
          <AnalysisPanelWrapper />
          {/* Node Config Panel: overlays canvas below header so header width is unaffected */}
          {selectedNodeId && (
            <NodeConfigPanel
              selectedNodeId={selectedNodeId}
              onClose={() => setSelectedNodeId(null)}
            />
          )}
        </main>

        {/* Bottom Dashboard Panel — Telemetry (tabIndex 6) */}
        <TelemetryDashboard />
      </div>
    </div>
  );
}

export default App;

// ─── Analysis Panel Wrapper (Task 536) ───────────────────────────

function AnalysisPanelWrapper() {
  const isOpen = useAnalysisPanelStore((s) => s.isOpen);
  const close = useAnalysisPanelStore((s) => s.close);
  const openerRef = useRef<HTMLElement | null>(null);

  if (!isOpen) return null;

  return <AnalysisPanel openerRef={openerRef} onClose={close} />;
}
