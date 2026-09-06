import { create } from 'zustand';
import { useTopologyStore } from './topologyStore';
import { validateEdgeConnection } from '@/validation';
import { detectCycles } from '@/validation/cycleDetection';
import { downloadTextFile } from '@/utils/download';
import type { SimulationNode } from '@/types/nodes';
import type { AnalysysEdge, EdgeData } from '@/types/edges';
import type { CanvasNode, CanvasNodeData, SectionNodeData, TextNoteNodeData } from '@/canvas/types';
import { SECTION_NODE_TYPE, TEXT_NOTE_NODE_TYPE } from '@/canvas/types';
import type { MigrationWarning } from '@/types/migration';
import {
  migrateV1ToV2,
  migrateV2ToV3,
  migrateV3ToV4,
  applyV2Defaults,
  applyV3Defaults,
  applyV4Defaults,
  type SerializedTopology,
  type SerializedTopologyV2,
  type SerializedTopologyV3,
  type SerializedTopologyV4,
  type SimulationRunSettings,
} from './schemaMigration';
import { useSimulationStore } from './simulationStore';

// Re-export for backward compatibility and test access
export {
  migrateV1ToV2,
  migrateV2ToV3,
  migrateV3ToV4,
  applyV2Defaults,
  applyV3Defaults,
  applyV4Defaults,
};
export type {
  SerializedTopology,
  SerializedTopologyV2,
  SerializedTopologyV3,
  SerializedTopologyV4,
  SimulationRunSettings,
};

// ─── Constants ───────────────────────────────────────────────────

const STORAGE_KEY = 'analysys_saved_topologies';
const AUTOSAVE_KEY = 'analysys_autosave';
export const CURRENT_SCHEMA_VERSION = 4;
const STORAGE_WARNING_BYTES = 4_194_304; // 4 MiB

// ─── Types ───────────────────────────────────────────────────────

export interface SavedTopologyEntry {
  name: string;
  timestamp: string;
  data: string; // JSON-serialized SerializedTopology, V2, or V3
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
  /** Parse, validate, and apply a full simulation bundle (file JSON text). */
  loadSimulationFromText: (text: string) => MigrationWarning[];
  /** Persist the current working canvas + run settings for reload recovery. */
  autosave: () => void;
  /** Restore the autosaved working session; false if there is nothing to restore. */
  restoreAutosave: () => boolean;
  /** Remove the autosaved working session. */
  clearAutosave: () => void;
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

/**
 * Persists every canvas node payload (simulation + visual sections/text notes).
 *
 * Node positions live on the engine node (`n.position`) and are updated live as
 * nodes are dragged; the mirrored `data.position` is kept in sync too, but
 * serialize from the engine node so an exported file always matches the canvas.
 */
function serializeCurrentTopology(): string {
  const { nodes } = useTopologyStore.getState();
  const nodeData: CanvasNodeData[] = nodes.map((n) => ({ ...n.data, position: n.position }));
  const edges = useTopologyStore.getState().edges.map((e) => e.data);

  // Always write v4 — the group system is gone, visual nodes are persisted,
  // and the run-settings block makes a saved bundle reproduce the run.
  const { durationMs, speedMultiplier, seed } = useSimulationStore.getState();
  const payload: SerializedTopologyV4 = {
    schemaVersion: 4,
    nodes: nodeData,
    edges,
    settings: {
      durationMs,
      speedMultiplier,
      seed,
    },
  };
  return JSON.stringify(payload);
}

function deserializeAndMigrate(data: string): {
  topology: SerializedTopologyV4;
  warnings: MigrationWarning[];
} {
  const parsed = JSON.parse(data) as Record<string, unknown>;
  const version = parsed.schemaVersion;

  if (version === 1) {
    const v2 = migrateV1ToV2(parsed as unknown as SerializedTopology);
    const v3 = migrateV2ToV3(v2.topology);
    const v4 = migrateV3ToV4(v3.topology);
    return { topology: v4.topology, warnings: [...v2.warnings, ...v3.warnings, ...v4.warnings] };
  }

  if (version === 2) {
    const defaults = applyV2Defaults(parsed as unknown as SerializedTopologyV2);
    const v3 = migrateV2ToV3(defaults.topology);
    const v4 = migrateV3ToV4(v3.topology);
    return {
      topology: v4.topology,
      warnings: [...defaults.warnings, ...v3.warnings, ...v4.warnings],
    };
  }

  if (version === 3) {
    const defaults = applyV3Defaults(parsed as unknown as SerializedTopologyV3);
    const v4 = migrateV3ToV4(defaults.topology);
    return { topology: v4.topology, warnings: [...defaults.warnings, ...v4.warnings] };
  }

  // v4 — apply absent-field defaults
  return applyV4Defaults(parsed as unknown as SerializedTopologyV4);
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
 * Canonical shared parse for a full simulation bundle (v1…v4 JSON text).
 * Used by file import so all import paths run identical
 * schema/version/edge validation and migration.
 */
export function parseSimulationText(
  text: string,
): { topology: SerializedTopologyV4; warnings: MigrationWarning[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON: content could not be parsed.');
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

  let migrated: SerializedTopologyV4;
  let warnings: MigrationWarning[] = [];
  if (version === 1) {
    const v2 = migrateV1ToV2(parsed as unknown as SerializedTopology);
    const v3 = migrateV2ToV3(v2.topology);
    const v4 = migrateV3ToV4(v3.topology);
    migrated = v4.topology;
    warnings = [...v2.warnings, ...v3.warnings, ...v4.warnings];
  } else if (version === 2) {
    const defaults = applyV2Defaults(parsed as unknown as SerializedTopologyV2);
    const v3 = migrateV2ToV3(defaults.topology);
    const v4 = migrateV3ToV4(v3.topology);
    migrated = v4.topology;
    warnings = [...defaults.warnings, ...v3.warnings, ...v4.warnings];
  } else if (version === 3) {
    const defaults = applyV3Defaults(parsed as unknown as SerializedTopologyV3);
    const v4 = migrateV3ToV4(defaults.topology);
    migrated = v4.topology;
    warnings = [...defaults.warnings, ...v4.warnings];
  } else {
    migrated = parsed as unknown as SerializedTopologyV4;
  }

  const result = applyV4Defaults(migrated);
  warnings = [...warnings, ...result.warnings];

  // R30.16 — reject the payload on the first violating edge (mirrors canvas rules).
  const edgeViolation = findFirstInvalidEdge(result.topology.nodes, result.topology.edges);
  if (edgeViolation) {
    throw new Error(`Import validation failed:\n${edgeViolation}`);
  }

  return { topology: result.topology, warnings };
}

/** Applies a bundle's run settings (duration/speed/seed) to the simulation store. */
export function applySimulationSettings(settings?: SimulationRunSettings): void {
  if (!settings) return;
  const sim = useSimulationStore.getState();
  sim.setDuration(settings.durationMs);
  sim.setSpeed(settings.speedMultiplier);
  if (typeof settings.seed === 'number') {
    sim.setSeed(settings.seed);
  }
}

function isSimulationData(data: CanvasNodeData): data is SimulationNode {
  return 'nodeType' in data;
}

/**
 * Runs the canvas edge validator over an imported edge set (R30.16), and
 * rejects any edge set that would introduce a routing cycle — mirroring the
 * canvas connect-time rule so imports cannot bypass it.
 */
function findFirstInvalidEdge(nodes: CanvasNodeData[], edges: EdgeData[]): string | null {
  const simulationNodes = nodes.filter(isSimulationData);
  const nodesById = new Map<string, SimulationNode>(simulationNodes.map((n) => [n.id, n]));
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

    if (detectCycles(simulationNodes, accepted).length > 0) {
      return (
        `Edge from "${source.label}" to "${target.label}" would create a routing cycle. ` +
        'Cycles are rejected because requests can only be caught by the max-hop guard at runtime.'
      );
    }
  }

  return null;
}

/** Rebuilds a `CanvasNode` (engine form) from persisted node data. */
function nodeDataToCanvasNode(data: CanvasNodeData): CanvasNode {
  if (isSimulationData(data)) {
    return {
      id: data.id,
      type: data.nodeType,
      position: data.position,
      data,
    };
  }
  const visual = data as SectionNodeData | TextNoteNodeData;
  return {
    id: visual.id,
    type: visual.kind === 'section' ? SECTION_NODE_TYPE : TEXT_NOTE_NODE_TYPE,
    position: visual.position,
    width: visual.width,
    height: visual.height,
    data: visual,
  };
}

function nodeDataToCanvasNodes(nodes: CanvasNodeData[]): CanvasNode[] {
  return nodes.map(nodeDataToCanvasNode);
}

function edgeDataToCanvasEdges(edges: EdgeData[]): AnalysysEdge[] {
  return edges.map((edgeData) => ({
    id: edgeData.id,
    source: edgeData.source,
    target: edgeData.target,
    type: edgeData.protocol,
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

    // Migrate in-memory only; the stored record stays at its original version.
    // The current version is written on the next explicit save.
    const { topology, warnings } = deserializeAndMigrate(entry.data);
    const nodes = nodeDataToCanvasNodes(topology.nodes);
    const edges = edgeDataToCanvasEdges(topology.edges);

    useTopologyStore.getState().loadTopology(nodes, edges);
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
    downloadTextFile(data, 'simulation.analysys.json', 'application/json');
  },

  // ─── Load Simulation Bundle ──────────────────────────────────

  loadSimulationFromText: (text) => {
    const { topology, warnings } = parseSimulationText(text);
    const nodes = nodeDataToCanvasNodes(topology.nodes);
    const edges = edgeDataToCanvasEdges(topology.edges);

    useTopologyStore.getState().loadTopology(nodes, edges);
    applySimulationSettings(topology.settings);
    return warnings;
  },

  // ─── Import JSON ─────────────────────────────────────────────

  importJSON: async (file: File) => {
    const text = await file.text();
    return get().loadSimulationFromText(text);
  },

  // ─── Autosave (reload recovery) ──────────────────────────────

  autosave: () => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, serializeCurrentTopology());
    } catch (err) {
      console.warn('[Persistence] Autosave failed (storage quota?).', err);
    }
  },

  restoreAutosave: () => {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return false;
    try {
      get().loadSimulationFromText(raw);
      return true;
    } catch (err) {
      // Unreadable/stale autosave — drop it so the app boots cleanly.
      localStorage.removeItem(AUTOSAVE_KEY);
      console.warn('[Persistence] Discarded an unreadable autosave.', err);
      return false;
    }
  },

  clearAutosave: () => {
    localStorage.removeItem(AUTOSAVE_KEY);
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
