import { useCallback } from 'react';
import { presets } from '@/presets';
import { useTopologyStore } from '@/store/topologyStore';
import { useSimulationStore } from '@/store/simulationStore';
import { SimState } from '@/simulation/types';
import type { AnalysysNode, SimulationNode } from '@/types/nodes';
import type { AnalysysEdge, EdgeData } from '@/types/edges';

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
    data: edgeData as AnalysysEdge['data'],
  }));
}

// ─── Component ───────────────────────────────────────────────────

export function WelcomeOverlay() {
  const loadTopology = useTopologyStore((s) => s.loadTopology);
  const initWorker = useSimulationStore((s) => s.initWorker);
  const sendToWorker = useSimulationStore((s) => s.sendToWorker);
  const setSimState = useSimulationStore((s) => s.setSimState);

  const loadPreset = useCallback(
    (presetName: string) => {
      const preset = presets.find((p) => p.name === presetName);
      if (!preset) return;

      const rfNodes = simulationNodesToRFNodes(preset.topology.nodes);
      const rfEdges = edgeDataToRFEdges(preset.topology.edges);
      loadTopology(rfNodes, rfEdges);

      // Auto-start simulation
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
          metricsIntervalMs: 1000,
          maxHopsPerRequest: 10,
        },
      });

      sendToWorker({ type: 'START', payload: { speedMultiplier: 1 } });
      setSimState(SimState.Running);
    },
    [loadTopology, initWorker, sendToWorker, setSimState],
  );

  // Find specific presets by name
  const dbExhaustion = presets.find((p) => p.name.toLowerCase().includes('exhaustion'));
  const cacheStampede = presets.find((p) => p.name.toLowerCase().includes('stampede') || p.name.toLowerCase().includes('cache'));

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-950/80 backdrop-blur-sm">
      <div className="mx-4 max-w-lg rounded-xl border border-gray-700 bg-gray-900 p-8 text-center shadow-2xl">
        <h2 className="mb-2 text-2xl font-bold text-white">Welcome to Analysys</h2>
        <p className="mb-6 text-sm leading-relaxed text-gray-400">
          Drag nodes from the palette on the left to design your architecture,
          or select a preset scenario below to get started instantly.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3">
          {dbExhaustion && (
            <button
              onClick={() => loadPreset(dbExhaustion.name)}
              className="rounded-lg border border-indigo-600 bg-indigo-600/20 px-4 py-2 text-sm font-medium text-indigo-300 transition-colors hover:bg-indigo-600/40"
            >
              Load &ldquo;{dbExhaustion.name}&rdquo;
            </button>
          )}
          {cacheStampede && (
            <button
              onClick={() => loadPreset(cacheStampede.name)}
              className="rounded-lg border border-amber-600 bg-amber-600/20 px-4 py-2 text-sm font-medium text-amber-300 transition-colors hover:bg-amber-600/40"
            >
              Load &ldquo;{cacheStampede.name}&rdquo;
            </button>
          )}
        </div>

        <p className="mt-6 text-[11px] text-gray-500">
          Or open <span className="text-gray-400">Presets</span> in the toolbar for more scenarios.
        </p>
      </div>
    </div>
  );
}
