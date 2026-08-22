import { useState, useCallback } from 'react';
import { MarkerType } from '@xyflow/react';
import { presets, type PresetTopology, type ChaosTimelineEntry } from '@/presets';
import { useTopologyStore } from '@/store/topologyStore';
import { useSimulationStore } from '@/store/simulationStore';
import { usePersistenceStore } from '@/store/persistenceStore';
import { SimState } from '@/simulation/types';
import type { AnalysysNode } from '@/types/nodes';
import type { AnalysysEdge } from '@/types/edges';
import type { SimulationNode } from '@/types/nodes';
import type { EdgeData } from '@/types/edges';
import {
  DEFAULT_MAX_HOPS_PER_REQUEST,
  DEFAULT_METRICS_INTERVAL_MS,
} from '@/types/messages';

// ─── Helpers ─────────────────────────────────────────────────────

function simulationNodesToRFNodes(nodes: SimulationNode[]): AnalysysNode[] {
  return nodes.map((simNode) => ({
    id: simNode.id,
    type: simNode.nodeType,
    position: simNode.position,
    data: simNode as AnalysysNode['data'],
  }));
}

function edgeDataToRFEdges(edges: EdgeData[]): AnalysysEdge[] {
  return edges.map((edgeData) => ({
    id: edgeData.id,
    source: edgeData.source,
    target: edgeData.target,
    // `type` selects the registered custom edge renderer (SyncEdge / AsyncEdge).
    // Without it React Flow falls back to the default edge and packet dots never render.
    type: edgeData.protocol,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 16,
      height: 16,
      color: '#6b7280',
    },
    data: edgeData as AnalysysEdge['data'],
  }));
}

function scheduleChaosTimeline(timeline: ChaosTimelineEntry[]): void {
  const { sendToWorker } = useSimulationStore.getState();
  for (const entry of timeline) {
    setTimeout(() => {
      sendToWorker({ type: 'CHAOS_EVENT', payload: entry.event });
    }, entry.timeMs);
  }
}

// ─── Component ───────────────────────────────────────────────────

export function PresetSelector() {
  const [isOpen, setIsOpen] = useState(false);
  const [showNameDialog, setShowNameDialog] = useState(false);
  const [customName, setCustomName] = useState('');

  const nodes = useTopologyStore((s) => s.nodes);
  const loadTopology = useTopologyStore((s) => s.loadTopology);
  const savedTopologies = usePersistenceStore((s) => s.savedTopologies);
  const saveTopology = usePersistenceStore((s) => s.saveTopology);
  const simState = useSimulationStore((s) => s.simState);
  const sendToWorker = useSimulationStore((s) => s.sendToWorker);
  const initWorker = useSimulationStore((s) => s.initWorker);
  const setSimState = useSimulationStore((s) => s.setSimState);
  const resetMetrics = useSimulationStore((s) => s.resetMetrics);

  const hasCanvasChanges = nodes.length > 0;

  const loadPreset = useCallback(
    (preset: PresetTopology) => {
      if (hasCanvasChanges) {
        const confirmed = window.confirm(
          'Loading a preset will replace your current topology. Continue?',
        );
        if (!confirmed) return;
      }

      // Stop any running simulation
      if (simState === SimState.Running || simState === SimState.Paused) {
        sendToWorker({ type: 'RESET' });
        resetMetrics();
      }

      // Load topology
      const rfNodes = simulationNodesToRFNodes(preset.topology.nodes);
      const rfEdges = edgeDataToRFEdges(preset.topology.edges);
      loadTopology(rfNodes, rfEdges);

      // Auto-start simulation with chaos timeline
      initWorker();
      const { getTopologySnapshot } = useTopologyStore.getState();
      const snapshot = getTopologySnapshot();

      sendToWorker({
        type: 'INIT',
        payload: {
          topology: snapshot,
          seed: Date.now(),
          speedMultiplier: 1,
          maxSimulatedTimeMs: 120000,
          metricsIntervalMs: DEFAULT_METRICS_INTERVAL_MS,
          maxHopsPerRequest: DEFAULT_MAX_HOPS_PER_REQUEST,
        },
      });

      sendToWorker({ type: 'START', payload: { speedMultiplier: 1 } });
      setSimState(SimState.Running);

      // Schedule chaos events
      if (preset.chaosTimeline.length > 0) {
        scheduleChaosTimeline(preset.chaosTimeline);
      }

      setIsOpen(false);
    },
    [
      hasCanvasChanges,
      simState,
      sendToWorker,
      resetMetrics,
      loadTopology,
      initWorker,
      setSimState,
    ],
  );

  const handleSaveCustom = useCallback(() => {
    if (!customName.trim()) return;
    saveTopology(customName.trim());
    setCustomName('');
    setShowNameDialog(false);
  }, [customName, saveTopology]);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 transition-colors"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        Presets
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-gray-700 bg-gray-800 shadow-xl">
          {/* Built-in Presets */}
          <div className="border-b border-gray-700 px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              Demo Scenarios
            </span>
          </div>
          <ul role="listbox" className="max-h-60 overflow-y-auto">
            {presets.map((preset) => (
              <li key={preset.name}>
                <button
                  className="w-full px-3 py-2 text-left hover:bg-gray-700/50 transition-colors"
                  onClick={() => loadPreset(preset)}
                >
                  <span className="block text-sm font-medium text-gray-200">
                    {preset.name}
                  </span>
                  <span className="block text-xs text-gray-500 mt-0.5">
                    {preset.description}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {/* Custom Scenarios */}
          {savedTopologies.length > 0 && (
            <>
              <div className="border-t border-gray-700 px-3 py-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  Custom Scenarios
                </span>
              </div>
              <ul className="max-h-40 overflow-y-auto">
                {savedTopologies.map((entry) => (
                  <li key={entry.name}>
                    <button
                      className="w-full px-3 py-2 text-left hover:bg-gray-700/50 transition-colors"
                      onClick={() => {
                        if (hasCanvasChanges) {
                          const confirmed = window.confirm(
                            'Loading a saved topology will replace your current canvas. Continue?',
                          );
                          if (!confirmed) return;
                        }
                        usePersistenceStore.getState().loadSavedTopology(entry.name);
                        setIsOpen(false);
                      }}
                    >
                      <span className="block text-sm font-medium text-gray-200">
                        {entry.name}
                      </span>
                      <span className="block text-xs text-gray-500 mt-0.5">
                        {new Date(entry.timestamp).toLocaleDateString()}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* Save As Custom */}
          <div className="border-t border-gray-700 p-2">
            {showNameDialog ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveCustom()}
                  placeholder="Scenario name..."
                  className="flex-1 rounded border border-gray-600 bg-gray-900 px-2 py-1 text-xs text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
                  autoFocus
                />
                <button
                  onClick={handleSaveCustom}
                  disabled={!customName.trim()}
                  className="rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-500 disabled:opacity-40"
                >
                  Save
                </button>
                <button
                  onClick={() => setShowNameDialog(false)}
                  className="rounded bg-gray-600 px-2 py-1 text-xs text-white hover:bg-gray-500"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowNameDialog(true)}
                disabled={nodes.length === 0}
                className="w-full rounded bg-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-600 disabled:opacity-40 transition-colors"
              >
                Save as Custom Scenario
              </button>
            )}
          </div>
        </div>
      )}

      {/* Click outside to close */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Name dialog is inline in the dropdown above */}
    </div>
  );
}
