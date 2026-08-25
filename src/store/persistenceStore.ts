import { create } from 'zustand';
import { MarkerType } from '@xyflow/react';
import { useTopologyStore } from './topologyStore';
import { validateEdgeConnection } from '@/validation';
import { detectCycles } from '@/validation/cycleDetection';
import { downloadTextFile } from '@/utils/download';
import type { AnalysysNode, SimulationNode } from '@/types/nodes';
import type { AnalysysEdge, EdgeData } from '@/types/edges';
import type { MigrationWarning } from '@/types/migration';
import {
  migrateV1ToV2,
  applyV2Defaults,
  type SerializedTopology,
  type SerializedTopologyV2,
} from './schemaMigration';

// Re-export for backward compatibility and test access
export { migrateV1ToV2, applyV2Defaults };
export type { SerializedTopology, SerializedTopologyV2 };

// ─── Constants ───────────────────────────────────────────────────

const STORAGE_KEY = 'analysys_saved_topologies';
export const CURRENT_SCHEMA_VERSION = 2;
const STORAGE_WARNING_BYTES = 4_194_304; // 4 MiB

// ─── Types ───────────────────────────────────────────────────────

export interface SavedTopologyEntry {
  name: string;
  timestamp: string;
  data: string; // JSON-serialized SerializedTopology or SerializedTopologyV2
}

// ─── Store State ─────────────────────────────────────────────────

interface PersistenceState {
  savedTopologies: SavedTopologyEntry[];
}

// ─── Store Actions ───────────────────────────────────────────────

interface PersistenceActions {
  saveTopology: (name: string) => { warnings: string[] };
  loadSavedTopology: (name: string) => MigrationWarning[];
  deleteSavedTopology: (name: string) => void;
  exportJSON: () => void;
  importJSON: (file: File) => Promise<MigrationWarning[]>;
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
  const subsystemGroups = useTopologyStore.getState().subsystemGroups;

  // R34.3 — always write v2 (simplifies reading, and a topology without v2 features
  // is a strict subset of v2 anyway).
  const payload: SerializedTopologyV2 = {
    schemaVersion: 2,
    nodes,
    edges,
    subsystemGroups,
  };
  return JSON.stringify(payload);
}

function deserializeAndMigrate(data: string): {
  topology: SerializedTopologyV2;
  warnings: MigrationWarning[];
} {
  const parsed = JSON.parse(data) as Record<string, unknown>;
  const version = parsed.schemaVersion;

  if (version === 1) {
    return migrateV1ToV2(parsed as unknown as SerializedTopology);
  }

  // v2 — apply absent-field defaults
  const v2 = parsed as unknown as SerializedTopologyV2;
  return applyV2Defaults(v2);
}

function validateSchemaVersion(obj: Record<string, unknown>): void {
  const version = obj.schemaVersion;

  if (version === undefined || version === null || !('schemaVersion' in obj)) {
    throw new Error(
      `Import rejected: schemaVersion field is absent (found: ${JSON.stringify(version)}).`,
    );
  }

  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw new Error(
      `Import rejected: schemaVersion is not an integer (found: ${JSON.stringify(version)}).`,
    );
  }

  if (version < 1) {
    throw new Error(`Import rejected: schemaVersion must be at least 1 (found: ${version}).`);
  }

  if (version > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Import rejected: schema version ${version} is not supported. This build supports up to version ${CURRENT_SCHEMA_VERSION}.`,
    );
  }
}

function validateStructure(obj: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (typeof obj !== 'object' || obj === null) {
    errors.push('File content is not a valid JSON object.');
    return { valid: false, errors };
  }

  const record = obj as Record<string, unknown>;

  if (!('nodes' in record) || !Array.isArray(record.nodes)) {
    errors.push('Missing or invalid required field: nodes');
  }

  if (!('edges' in record) || !Array.isArray(record.edges)) {
    errors.push('Missing or invalid required field: edges');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Runs the canvas edge validator over an imported edge set (R30.16), and
 * rejects any edge set that would introduce a routing cycle — mirroring the
 * canvas connect-time rule so imports cannot bypass it.
 */
function findFirstInvalidEdge(nodes: SimulationNode[], edges: EdgeData[]): string | null {
  const nodesById = new Map<string, SimulationNode>(nodes.map((n) => [n.id, n]));
  const accepted: EdgeData[] = [];

  for (const edge of edges) {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (!source || !target) {
      return `Edge "${edge.id}" references a node that is not in this file.`;
    }

    const result = validateEdgeConnection(source, target, edge.protocol, accepted, nodesById);
    if (!result.valid) {
      return `Edge from "${source.label}" to "${target.label}" is not permitted: ${result.reason}`;
    }
    accepted.push(edge);

    if (detectCycles(nodes, accepted).length > 0) {
      return (
        `Edge from "${source.label}" to "${target.label}" would create a routing cycle. ` +
        'Cycles are rejected because requests can only be caught by the max-hop guard at runtime.'
      );
    }
  }

  return null;
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

/**
 * Measures the UTF-8 byte length of a string (R34.7).
 * Replaces the old UTF-16 code-unit measurement that under-reports multi-byte content.
 */
export function measureUtf8Bytes(str: string): number {
  return new TextEncoder().encode(str).length;
}

// ─── Store ───────────────────────────────────────────────────────

export const usePersistenceStore = create<PersistenceState & PersistenceActions>()((set, get) => ({
  savedTopologies: loadFromLocalStorage(),

  // ─── Save Topology ───────────────────────────────────────────

  saveTopology: (name) => {
    const data = serializeCurrentTopology();
    const sizeBytes = measureUtf8Bytes(data);
    const storageWarnings: string[] = [];

    // R34.7 — warn above threshold, but still complete the save
    if (sizeBytes > STORAGE_WARNING_BYTES) {
      storageWarnings.push(
        `Topology "${name}" is ${sizeBytes} bytes, exceeding the ${STORAGE_WARNING_BYTES}-byte threshold.`,
      );
      console.warn(
        `[Persistence] Save warning: serialized size is ${sizeBytes} bytes (threshold: ${STORAGE_WARNING_BYTES}).`,
      );
    }

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

    return { warnings: storageWarnings };
  },

  // ─── Load Saved Topology ─────────────────────────────────────

  loadSavedTopology: (name) => {
    const { savedTopologies } = get();
    const entry = savedTopologies.find((t) => t.name === name);
    if (!entry) {
      console.warn(`[Persistence] Topology "${name}" not found.`);
      return [];
    }

    // R34.10 — migrate in-memory only; the stored record stays at its
    // original version. Version 2 is written on the next explicit save.
    const { topology, warnings } = deserializeAndMigrate(entry.data);
    const rfNodes = simulationNodesToRFNodes(topology.nodes);
    const rfEdges = edgeDataToRFEdges(topology.edges);

    useTopologyStore.getState().loadTopology(rfNodes, rfEdges, topology.subsystemGroups);
    return warnings;
  },

  // ─── Delete Saved Topology ───────────────────────────────────

  deleteSavedTopology: (name) => {
    set((state) => {
      const updated = state.savedTopologies.filter((t) => t.name !== name);
      saveToLocalStorage(updated);
      return { savedTopologies: updated };
    });
  },

  // ─── Export JSON ─────────────────────────────────────────────

  exportJSON: () => {
    const data = serializeCurrentTopology();
    downloadTextFile(data, 'topology.analysys.json', 'application/json');
  },

  // ─── Import JSON ─────────────────────────────────────────────

  importJSON: async (file: File) => {
    const text = await file.text();

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('Invalid JSON: file could not be parsed.');
    }

    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('File content is not a valid JSON object.');
    }

    const record = parsed as Record<string, unknown>;

    // R34.6, R34.9 — reject bad schema versions before any other validation
    validateSchemaVersion(record);

    const structureResult = validateStructure(parsed);
    if (!structureResult.valid) {
      throw new Error(`Import validation failed:\n${structureResult.errors.join('\n')}`);
    }

    const version = record.schemaVersion as number;
    let topology: SerializedTopologyV2;
    let migrationWarnings: MigrationWarning[];

    if (version === 1) {
      const result = migrateV1ToV2(parsed as unknown as SerializedTopology);
      topology = result.topology;
      migrationWarnings = result.warnings;
    } else {
      // v2 — apply absent-field defaults
      const result = applyV2Defaults(parsed as unknown as SerializedTopologyV2);
      topology = result.topology;
      migrationWarnings = result.warnings;
    }

    // R30.16 — reject the whole file on the first violating edge.
    const edgeViolation = findFirstInvalidEdge(topology.nodes, topology.edges);
    if (edgeViolation) {
      throw new Error(`Import validation failed:\n${edgeViolation}`);
    }

    const rfNodes = simulationNodesToRFNodes(topology.nodes);
    const rfEdges = edgeDataToRFEdges(topology.edges);

    useTopologyStore.getState().loadTopology(rfNodes, rfEdges, topology.subsystemGroups);
    return migrationWarnings;
  },

  // ─── Storage Usage Check ─────────────────────────────────────

  getStorageUsage: () => {
    let totalBytes = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const value = localStorage.getItem(key);
        if (value) {
          totalBytes += measureUtf8Bytes(key) + measureUtf8Bytes(value);
        }
      }
    }
    return {
      bytes: totalBytes,
      warning: totalBytes > STORAGE_WARNING_BYTES,
    };
  },
}));
