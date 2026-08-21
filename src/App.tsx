import { useState, useEffect, useCallback } from 'react';
import { CanvasEditor } from '@/components/canvas/CanvasEditor';
import { NodePalette } from '@/components/canvas/NodePalette';
import { NodeConfigPanel } from '@/components/config/NodeConfigPanel';
import { SimulationToolbar, ChaosPanel, PersistenceToolbar } from '@/components/controls';
import { PresetSelector } from '@/components/presets';
import { TelemetryDashboard } from '@/components/telemetry';
import { LiveAnnouncer } from '@/components/a11y/LiveAnnouncer';

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

      {/* Left Sidebar — Node Palette (tabIndex 1) */}
      <aside
        className="flex w-60 flex-col border-r border-gray-800 bg-gray-900/50 p-4 transition-all duration-300 max-xl:w-full max-xl:flex-row max-xl:items-center max-xl:gap-4 max-xl:border-b max-xl:border-r-0 max-xl:py-2"
        tabIndex={1}
        aria-label="Node palette sidebar"
      >
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
          <h1 className="text-lg font-bold">Analysys</h1>
          <span className="text-xs text-gray-500">Architecture Simulator</span>

          {/* Preset Selector */}
          <div className="ml-2">
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

          {/* Chaos Controls (tabIndex 5) */}
          <div className="ml-auto flex items-center gap-4" tabIndex={5} aria-label="Chaos controls">
            <ChaosPanel />
            {selectedNodeId && (
              <span className="text-xs text-gray-400">
                Selected: {selectedNodeId.slice(0, 8)}…
              </span>
            )}
          </div>
        </header>

        {/* Canvas Area (tabIndex 2) */}
        <main className="relative flex-1" tabIndex={2} aria-label="Topology canvas">
          <CanvasEditor onNodeSelect={setSelectedNodeId} />
        </main>

        {/* Bottom Dashboard Panel — Telemetry (tabIndex 6) */}
        <TelemetryDashboard />
      </div>

      {/* Right Sidebar — Node Configuration Panel (tabIndex 3) */}
      {selectedNodeId && (
        <NodeConfigPanel
          selectedNodeId={selectedNodeId}
          onClose={() => setSelectedNodeId(null)}
        />
      )}
    </div>
  );
}

export default App;
