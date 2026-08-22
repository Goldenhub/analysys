import { create } from 'zustand';
import { MarkerType } from '@xyflow/react';
import { useTopologyStore } from './topologyStore';
import { validateEdgeConnection } from '@/validation';
import type { AnalysysNode, SimulationNode } from '@/types/nodes';
import type { AnalysysEdge, EdgeData } from '@/types/edges';

// ─── Constants ───────────────────────────────────────────────────

const STORAGE_KEY = 'analysys_saved_topologies';
const SCHEMA_VERSION = 1;
const STORAGE_WARNING_BYTES = 4 * 1024 * 1024; // 4MB

// ─── Serialized Topology Format ──────────────────────────────────

export interface SerializedTopology {
  schemaVersion: number;
  nodes: SimulationNode[];
  edges: EdgeData[];
}

export interface SavedTopologyEntry {
  name: string;
  timestamp: string;
  data: string; // JSON-serialized SerializedTopology
}

// ─── Store State ─────────────────────────────────────────────────

interface PersistenceState {
  savedTopologies: SavedTopologyEntry[];
}

// ─── Store Actions ───────────────────────────────────────────────

interface PersistenceActions {
  saveTopology: (name: string) => void;
  loadSavedTopology: (name: string) => void;
  deleteSavedTopology: (name: string) => void;
  exportJSON: () => void;
  importJSON: (file: File) => Promise<void>;
  getStorageUsage: () => { bytes: number; warning: boolean };
}

// ─── Helpers ─────────────────────────────────────────────────────

function loadFromLocalStorage(): SavedTopologyEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as SavedTopologyEntry[];
  } catch {
    return [];
  }
}

function saveToLocalStorage(entries: SavedTopologyEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function serializeCurrentTopology(): string {
  const { nodes, edges } = useTopologyStore.getState().getTopologySnapshot();
  const payload: SerializedTopology = {
    schemaVersion: SCHEMA_VERSION,
    nodes,
    edges,
  };
  return JSON.stringify(payload);
}

function deserializeTopology(data: string): SerializedTopology {
  return JSON.parse(data) as SerializedTopology;
}

function validateSchema(obj: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (typeof obj !== 'object' || obj === null) {
    errors.push('File content is not a valid JSON object.');
    return { valid: false, errors };
  }

  const record = obj as Record<string, unknown>;

  if (!('schemaVersion' in record) || typeof record.schemaVersion !== 'number') {
    errors.push('Missing or invalid required field: schemaVersion');
  }

  if (!('nodes' in record) || !Array.isArray(record.nodes)) {
    errors.push('Missing or invalid required field: nodes');
  }

  if (!('edges' in record) || !Array.isArray(record.edges)) {
    errors.push('Missing or invalid required field: edges');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Runs the canvas edge validator over an imported edge set (R30.16).
 *
 * Returns the message for the first violating edge, or `null` when every edge is
 * permitted. Edges are fed to the validator one at a time against the edges already
 * accepted, so a duplicate or a second Worker_Pool → Dead_Letter_Queue edge *within the
 * file* is caught the same way it would be on the canvas. Reporting only the first
 * violation is deliberate: the whole file is rejected either way, and naming one edge is
 * more actionable than a list.
 */
function findFirstInvalidEdge(
  nodes: SimulationNode[],
  edges: EdgeData[],
): string | null {
  const nodesById = new Map<string, SimulationNode>(nodes.map((n) => [n.id, n]));
  const accepted: EdgeData[] = [];

  for (const edge of edges) {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (!source || !target) {
      return `Edge "${edge.id}" references a node that is not in this file.`;
    }

    const result = validateEdgeConnection(
      source,
      target,
      edge.protocol,
      accepted,
      nodesById,
    );
    if (!result.valid) {
      return `Edge from "${source.label}" to "${target.label}" is not permitted: ${result.reason}`;
    }
    accepted.push(edge);
  }

  return null;
}

function migrateIfNeeded(data: SerializedTopology): SerializedTopology {
  // Currently at schema version 1 — no migrations needed.
  // Future migrations would be handled here:
  // if (data.schemaVersion < 2) { /* migrate v1 → v2 */ }
  return { ...data, schemaVersion: SCHEMA_VERSION };
}

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

function triggerDownload(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ─── Store ───────────────────────────────────────────────────────

export const usePersistenceStore = create<PersistenceState & PersistenceActions>()(
  (set, get) => ({
    savedTopologies: loadFromLocalStorage(),

    // ─── Task 45: Save Topology ──────────────────────────────────

    saveTopology: (name) => {
      const data = serializeCurrentTopology();
      const entry: SavedTopologyEntry = {
        name,
        timestamp: new Date().toISOString(),
        data,
      };

      set((state) => {
        // Overwrite if same name exists, otherwise append
        const existing = state.savedTopologies.filter((t) => t.name !== name);
        const updated = [...existing, entry];
        saveToLocalStorage(updated);
        return { savedTopologies: updated };
      });

      // Check storage usage and warn
      const { warning } = get().getStorageUsage();
      if (warning) {
        console.warn(
          '[Persistence] localStorage usage exceeds 4MB. Consider deleting unused topologies.',
        );
      }
    },

    // ─── Task 46: Load Saved Topology ────────────────────────────

    loadSavedTopology: (name) => {
      const { savedTopologies } = get();
      const entry = savedTopologies.find((t) => t.name === name);
      if (!entry) {
        console.warn(`[Persistence] Topology "${name}" not found.`);
        return;
      }

      const serialized = deserializeTopology(entry.data);
      const migrated = migrateIfNeeded(serialized);
      const rfNodes = simulationNodesToRFNodes(migrated.nodes);
      const rfEdges = edgeDataToRFEdges(migrated.edges);

      useTopologyStore.getState().loadTopology(rfNodes, rfEdges);
    },

    // ─── Task 47: Delete Saved Topology ──────────────────────────

    deleteSavedTopology: (name) => {
      set((state) => {
        const updated = state.savedTopologies.filter((t) => t.name !== name);
        saveToLocalStorage(updated);
        return { savedTopologies: updated };
      });
    },

    // ─── Task 48: Export JSON ────────────────────────────────────

    exportJSON: () => {
      const data = serializeCurrentTopology();
      triggerDownload(data, 'topology.analysys.json');
    },

    // ─── Task 49 & 50: Import JSON ──────────────────────────────

    importJSON: async (file: File) => {
      const text = await file.text();

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('Invalid JSON: file could not be parsed.');
      }

      const validation = validateSchema(parsed);
      if (!validation.valid) {
        throw new Error(
          `Import validation failed:\n${validation.errors.join('\n')}`,
        );
      }

      const serialized = parsed as SerializedTopology;

      // Reject future schema versions
      if (serialized.schemaVersion > SCHEMA_VERSION) {
        throw new Error(
          `This file requires Analysys v${serialized.schemaVersion}.0 or later.`,
        );
      }

      const migrated = migrateIfNeeded(serialized);

      // R30.16 — reject the whole file on the first violating edge. This runs before
      // `loadTopology`, so the Canvas node set and edge set are left untouched.
      const edgeViolation = findFirstInvalidEdge(migrated.nodes, migrated.edges);
      if (edgeViolation) {
        throw new Error(`Import validation failed:\n${edgeViolation}`);
      }

      const rfNodes = simulationNodesToRFNodes(migrated.nodes);
      const rfEdges = edgeDataToRFEdges(migrated.edges);

      useTopologyStore.getState().loadTopology(rfNodes, rfEdges);
    },

    // ─── Task 51: Storage Usage Check ────────────────────────────

    getStorageUsage: () => {
      let totalBytes = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          const value = localStorage.getItem(key);
          if (value) {
            // Each char in JS string is 2 bytes (UTF-16), but localStorage typically stores UTF-8
            totalBytes += key.length + value.length;
          }
        }
      }
      return {
        bytes: totalBytes,
        warning: totalBytes > STORAGE_WARNING_BYTES,
      };
    },
  }),
);
