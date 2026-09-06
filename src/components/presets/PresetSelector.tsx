import { useState, useCallback } from 'react';
import {
  failureModePresets,
  referencePresets,
  isReferencePreset,
  type PresetTopology,
  type ChaosTimelineEntry,
} from '@/presets';
import { useTopologyStore } from '@/store/topologyStore';
import { useSimulationStore } from '@/store/simulationStore';
import { usePersistenceStore } from '@/store/persistenceStore';
import { SimState } from '@/simulation/types';
import type { AnalysysNode } from '@/types/nodes';
import type { AnalysysEdge } from '@/types/edges';
import type { SimulationNode } from '@/types/nodes';
import type { EdgeData } from '@/types/edges';
import { DEFAULT_MAX_HOPS_PER_REQUEST, DEFAULT_METRICS_INTERVAL_MS } from '@/types/messages';

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
    type: edgeData.protocol,
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

      // Auto-start simulation
      initWorker();
      const { getTopologySnapshot } = useTopologyStore.getState();
      const snapshot = getTopologySnapshot();

      // Reference presets use their stored seed, duration, and speed multiplier
      const isRef = isReferencePreset(preset);
      const seed = isRef ? preset.seed : Date.now();
      const speedMultiplier = isRef ? preset.speedMultiplier : 1;

      // Surface the preset's run parameters in the toolbar so the selectors
      // reflect what actually ran. The run below uses the store's values — the
      // same single source of truth the toolbar drives.
      useSimulationStore.getState().setSeed(seed);
      useSimulationStore.getState().setSpeed(speedMultiplier);
      if (isRef) {
        useSimulationStore.getState().setDuration(preset.simulatedDurationMs);
      }
      const maxSimulatedTimeMs = useSimulationStore.getState().durationMs;

      sendToWorker({
        type: 'INIT',
        payload: {
          topology: snapshot,
          seed,
          speedMultiplier,
          maxSimulatedTimeMs,
          metricsIntervalMs: DEFAULT_METRICS_INTERVAL_MS,
          maxHopsPerRequest: DEFAULT_MAX_HOPS_PER_REQUEST,
        },
      });

      sendToWorker({ type: 'START', payload: { speedMultiplier } });
      setSimState(SimState.Running);

      // Schedule chaos events
      if (preset.chaosTimeline.length > 0) {
        scheduleChaosTimeline(preset.chaosTimeline);
      }

      setIsOpen(false);
    },
    [hasCanvasChanges, simState, sendToWorker, resetMetrics, loadTopology, initWorker, setSimState],
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
        className="rounded bg-[#b8402e] px-3 py-1.5 text-xs font-medium text-[#f3ede2] hover:bg-[#b8402e] transition-colors"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        Presets
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-80 rounded-lg border border-[#5b5347]/30 bg-[#5b5347]/80 shadow-xl">
          {/* Failure-Mode Presets */}
          <div className="border-b border-[#5b5347]/30 px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#f3ede2]/50">
              Failure-Mode Scenarios
            </span>
          </div>
          <ul role="listbox" className="max-h-60 overflow-y-auto">
            {failureModePresets.map((preset) => (
              <li key={preset.name}>
                <button
                  className="w-full px-3 py-2 text-left hover:bg-[#5b5347]/60/50 transition-colors"
                  onClick={() => loadPreset(preset)}
                >
                  <span className="block text-sm font-medium text-[#f3ede2]">{preset.name}</span>
                  <span className="block text-xs text-[#f3ede2]/50 mt-0.5">{preset.description}</span>
                </button>
              </li>
            ))}
          </ul>

          {/* Reference Architecture Presets */}
          <div className="border-t border-[#5b5347]/30 px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#f3ede2]/50">
              Reference Architectures
            </span>
          </div>
          <ul role="listbox" className="max-h-80 overflow-y-auto">
            {referencePresets.map((preset) => (
              <li key={preset.name}>
                <button
                  className="w-full px-3 py-2 text-left hover:bg-[#5b5347]/60/50 transition-colors"
                  onClick={() => loadPreset(preset)}
                >
                  <span className="block text-sm font-medium text-[#f3ede2]">{preset.name}</span>
                  <span className="block text-xs text-[#f3ede2]/50 mt-0.5">{preset.description}</span>
                  <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[#f3ede2]/60">
                    <span>
                      Bottleneck:{' '}
                      {preset.topology.nodes.find((n) => n.id === preset.expectedBottleneckNodeId)
                        ?.label ?? preset.expectedBottleneckNodeId}
                    </span>
                    <span>Status: {preset.expectedDominantTerminalStatus}</span>
                    <span>Duration: {preset.simulatedDurationMs / 1000}s</span>
                    <span>Load: {preset.totalOfferedRps} RPS</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {/* Custom Scenarios */}
          {savedTopologies.length > 0 && (
            <>
              <div className="border-t border-[#5b5347]/30 px-3 py-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[#f3ede2]/50">
                  Custom Scenarios
                </span>
              </div>
              <ul className="max-h-40 overflow-y-auto">
                {savedTopologies.map((entry) => (
                  <li key={entry.name}>
                    <button
                      className="w-full px-3 py-2 text-left hover:bg-[#5b5347]/60/50 transition-colors"
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
                      <span className="block text-sm font-medium text-[#f3ede2]">{entry.name}</span>
                      <span className="block text-xs text-[#f3ede2]/50 mt-0.5">
                        {new Date(entry.timestamp).toLocaleDateString()}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* Save As Custom */}
          <div className="border-t border-[#5b5347]/30 p-2">
            {showNameDialog ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveCustom()}
                  placeholder="Scenario name..."
                  className="flex-1 rounded border border-[#5b5347]/40 bg-[#5b5347] px-2 py-1 text-xs text-[#f3ede2] placeholder-[#f3ede2]/50 focus:border-[#b8402e] focus:outline-none"
                  autoFocus
                />
                <button
                  onClick={handleSaveCustom}
                  disabled={!customName.trim()}
                  className="rounded bg-[#6b8f71] px-2 py-1 text-xs text-[#f3ede2] hover:bg-[#6b8f71] disabled:opacity-40"
                >
                  Save
                </button>
                <button
                  onClick={() => setShowNameDialog(false)}
                  className="rounded bg-[#5b5347]/50 px-2 py-1 text-xs text-[#f3ede2] hover:bg-[#5b5347]/80"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowNameDialog(true)}
                disabled={nodes.length === 0}
                className="w-full rounded bg-[#5b5347]/60 px-3 py-1.5 text-xs text-[#f3ede2]/80 hover:bg-[#5b5347]/50 disabled:opacity-40 transition-colors"
              >
                Save as Custom Scenario
              </button>
            )}
          </div>
        </div>
      )}

      {/* Click outside to close */}
      {isOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} aria-hidden="true" />
      )}

      {/* Name dialog is inline in the dropdown above */}
    </div>
  );
}
