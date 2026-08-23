import React, { useState, useRef } from 'react';
import { useBaselineStore } from '@/store/baselineStore';
import { useTopologyStore } from '@/store/topologyStore';
import { useSimulationStore } from '@/store/simulationStore';
import { SimState } from '@/simulation/types';
import type { SimulationNode } from '@/types/nodes';
import type { AnalysysNode } from '@/types/nodes';
import type { AnalysysEdge, EdgeData } from '@/types/edges';
import { MarkerType } from '@xyflow/react';

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
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 16,
      height: 16,
      color: '#6b7280',
    },
    data: edgeData as AnalysysEdge['data'],
  }));
}

// ─── BaselineManager Component (Task 529) ────────────────────────

export interface BaselineManagerProps {
  /** Called after successful reuse to close the panel if needed. */
  onReuse?: () => void;
}

/**
 * Offers retain, list, delete, and reuse of baseline runs.
 * Fully operable by keyboard alone (Tab, Enter, Space, Escape).
 */
export function BaselineManager({ onReuse }: BaselineManagerProps) {
  const baselines = useBaselineStore((s) => s.baselines);
  const deleteBaseline = useBaselineStore((s) => s.deleteBaseline);
  const getBaseline = useBaselineStore((s) => s.getBaseline);
  const loadTopology = useTopologyStore((s) => s.loadTopology);
  const simState = useSimulationStore((s) => s.simState);
  const topologyNodes = useTopologyStore((s) => s.nodes);

  const [confirmingReuse, setConfirmingReuse] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const hasUnsavedChanges = topologyNodes.length > 0;

  function handleDelete(name: string) {
    deleteBaseline(name);
    setError(null);
  }

  function performReuse(name: string) {
    const baseline = getBaseline(name);
    if (!baseline) {
      setError(`Baseline "${name}" not found.`);
      return;
    }

    // Restore topology (Task 528): positions, configs, routing policies, protocols, weights, groups
    const topo = baseline.topology;
    const rfNodes = simulationNodesToRFNodes(topo.nodes);
    const rfEdges = edgeDataToRFEdges(topo.edges);
    loadTopology(rfNodes, rfEdges, topo.subsystemGroups);

    setConfirmingReuse(null);
    setError(null);
    onReuse?.();
  }

  function initiateReuse(name: string) {
    if (simState === SimState.Running) {
      setError('Cannot reuse a baseline while a simulation is running.');
      return;
    }
    if (hasUnsavedChanges) {
      setConfirmingReuse(name);
    } else {
      performReuse(name);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent, name: string, action: 'delete' | 'reuse') {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (action === 'delete') handleDelete(name);
      else initiateReuse(name);
    }
  }

  return (
    <section aria-label="Baseline Manager" className="flex flex-col gap-2 p-4">
      <h2 className="text-sm font-semibold text-zinc-300">Stored Baselines</h2>

      {error && (
        <div role="alert" className="text-xs text-red-400 py-1">
          {error}
        </div>
      )}

      {baselines.length === 0 ? (
        <p className="text-xs text-zinc-500">No baselines stored.</p>
      ) : (
        <ul ref={listRef} role="list" aria-label="Baseline list" className="flex flex-col gap-1">
          {baselines.map((b) => (
            <li
              key={b.name}
              className="flex items-center justify-between gap-2 rounded px-2 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 focus-within:ring-1 focus-within:ring-blue-400"
            >
              <span className="flex-1 truncate">
                <span className="font-medium text-zinc-200">{b.name}</span>
                <span className="ml-2 text-zinc-500">
                  {new Date(b.createdAt).toLocaleDateString()}
                </span>
              </span>
              <button
                type="button"
                className="px-2 py-0.5 rounded text-zinc-400 hover:text-blue-300 hover:bg-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-400"
                aria-label={`Reuse baseline "${b.name}"`}
                onClick={() => initiateReuse(b.name)}
                onKeyDown={(e) => handleKeyDown(e, b.name, 'reuse')}
              >
                Reuse
              </button>
              <button
                type="button"
                className="px-2 py-0.5 rounded text-zinc-400 hover:text-red-300 hover:bg-zinc-600 focus:outline-none focus:ring-1 focus:ring-red-400"
                aria-label={`Delete baseline "${b.name}"`}
                onClick={() => handleDelete(b.name)}
                onKeyDown={(e) => handleKeyDown(e, b.name, 'delete')}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Confirmation dialog for reuse with unsaved changes (Task 528) */}
      {confirmingReuse && (
        <div
          role="alertdialog"
          aria-label="Confirm baseline reuse"
          className="mt-2 p-3 rounded bg-zinc-900 border border-zinc-600 text-xs"
        >
          <p className="text-zinc-300 mb-2">
            Unsaved changes exist. Reusing baseline &ldquo;{confirmingReuse}&rdquo; will replace the
            current topology. Continue?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-400"
              onClick={() => performReuse(confirmingReuse)}
              autoFocus
            >
              Confirm
            </button>
            <button
              type="button"
              className="px-3 py-1 rounded bg-zinc-700 text-zinc-300 hover:bg-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-400"
              onClick={() => setConfirmingReuse(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
