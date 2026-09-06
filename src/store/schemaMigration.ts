/**
 * Schema migration logic for the persistence layer.
 *
 * Extracted to a separate module to avoid circular dependencies between
 * `persistenceStore.ts` and `utils/localStorage.ts`.
 */

import type { SimulationNode } from '@/types/nodes';
import type { EdgeData } from '@/types/edges';
import type { SubsystemGroup } from '@/types/groups';
import type { CanvasNodeData } from '@/canvas/types';
import type { MigrationWarning } from '@/types/migration';
import { RoutingPolicy } from '@/types/nodes';
import { createDefaultNodeData } from '@/types/nodeDefaults';

// ─── Serialized Topology Formats ─────────────────────────────────

/** The v1 format — no routingPolicy at the base level, no weight, no groups. */
export interface SerializedTopology {
  schemaVersion: number;
  nodes: SimulationNode[];
  edges: EdgeData[];
}

/**
 * The v2 format: nodes carry routingPolicy and every R23–R28 parameter,
 * edges carry weight in stored order, and subsystemGroups is present.
 * Kept for reading/migrating legacy records.
 */
export interface SerializedTopologyV2 {
  schemaVersion: 2;
  nodes: SimulationNode[];
  edges: EdgeData[];
  subsystemGroups: SubsystemGroup[];
}

/**
 * The v3 format: carries routingPolicy, edge weight, and also persists
 * visual-only canvas nodes (sections and text notes) alongside simulation
 * nodes. The group system was removed in v3.
 */
export interface SerializedTopologyV3 {
  schemaVersion: 3;
  nodes: CanvasNodeData[];
  edges: EdgeData[];
}

/**
 * Run settings captured alongside a topology (schema v4) so an exported
 * bundle / shared link recreates the exact run, not just the canvas.
 */
export interface SimulationRunSettings {
  /** Simulation horizon in ms — mirrors the toolbar Duration selector. */
  durationMs: number;
  /** Speed multiplier at run time. */
  speedMultiplier: number;
  /**
   * Explicit PRNG seed for reproducibility. Absent when the sharer never
   * captured one (e.g. a legacy import) — the recipient rolls a fresh seed.
   */
  seed?: number;
}

/**
 * The v4 format: v3 plus an optional `settings` block. Existing v1–v3 files
 * migrate to v4 with defaulted settings, so one payload serves both the file
 * and the URL-share transports.
 */
export interface SerializedTopologyV4 {
  schemaVersion: 4;
  nodes: CanvasNodeData[];
  edges: EdgeData[];
  settings?: SimulationRunSettings;
}

// ─── Type guards ─────────────────────────────────────────────────

/** True if the persisted node data is a simulation node (processes in the engine). */
function isSimulationData(data: CanvasNodeData): data is SimulationNode {
  return 'nodeType' in data;
}

// ─── Default-field helper (shared by v2/v3 migration) ────────────

/** Applies absent-field defaulting to a single simulation node (R34.8). */
function defaultSimulationNode(node: SimulationNode, warnings: MigrationWarning[]): SimulationNode {
  const patched = { ...node } as Record<string, unknown>;

  // routingPolicy → First (R32.13)
  if (!('routingPolicy' in patched) || patched.routingPolicy === undefined) {
    warnings.push({
      label: node.label,
      field: 'routingPolicy',
      importedValue: undefined,
      appliedValue: RoutingPolicy.First,
    });
    patched.routingPolicy = RoutingPolicy.First;
  }

  // Fill absent R23–R28 parameters from createDefaultNodeData
  const defaults = createDefaultNodeData(node.nodeType, node.position);
  const defaultConfig = defaults.config as unknown as Record<string, unknown>;
  const patchedConfig = { ...(patched.config as unknown as Record<string, unknown>) };

  for (const [key, defaultValue] of Object.entries(defaultConfig)) {
    if (!(key in patchedConfig) || patchedConfig[key] === undefined) {
      warnings.push({
        label: node.label,
        field: key,
        importedValue: undefined,
        appliedValue: defaultValue,
      });
      patchedConfig[key] = defaultValue;
    }
  }

  patched.config = patchedConfig;
  return patched as unknown as SimulationNode;
}

/** Defaults edge weights if absent (R32.4). */
function defaultEdgeWeight(edges: EdgeData[], warnings: MigrationWarning[]): EdgeData[] {
  return edges.map((edge) => {
    if (!('weight' in edge) || (edge as unknown as Record<string, unknown>).weight === undefined) {
      warnings.push({
        label: `${edge.source} → ${edge.target}`,
        field: 'weight',
        importedValue: undefined,
        appliedValue: 1.0,
      });
      return { ...edge, weight: 1.0 };
    }
    return edge;
  });
}

// ─── Migration (R34.4, R34.8) ────────────────────────────────────

/**
 * Migrates a v1 record to v2. Pure function — returns a new record plus
 * the warnings to surface to the user.
 */
export function migrateV1ToV2(v1: SerializedTopology): {
  topology: SerializedTopologyV2;
  warnings: MigrationWarning[];
} {
  const warnings: MigrationWarning[] = [];

  const nodes: SimulationNode[] = v1.nodes.map((node) =>
    defaultSimulationNode(node, warnings),
  );

  const edges: EdgeData[] = defaultEdgeWeight(v1.edges, warnings);

  return {
    topology: {
      schemaVersion: 2,
      nodes,
      edges,
      subsystemGroups: [],
    },
    warnings,
  };
}

/**
 * Applies absent-field defaulting to a v2 record (R34.8). An absent field of
 * the set {routingPolicy, edge weight, subsystemGroups, R23–R28 params} is
 * defaulted rather than treated as a validation failure.
 */
export function applyV2Defaults(v2: SerializedTopologyV2): {
  topology: SerializedTopologyV2;
  warnings: MigrationWarning[];
} {
  const warnings: MigrationWarning[] = [];

  const nodes: SimulationNode[] = v2.nodes.map((node) =>
    defaultSimulationNode(node, warnings),
  );

  const edges: EdgeData[] = defaultEdgeWeight(v2.edges, warnings);

  // Default subsystemGroups if absent (group data is discarded on v3 migration)
  const subsystemGroups = v2.subsystemGroups ?? [];

  return {
    topology: {
      schemaVersion: 2,
      nodes,
      edges,
      subsystemGroups,
    },
    warnings,
  };
}

/**
 * Migrates a v2 record to v3: discards the removed group system and keeps all
 * existing simulation nodes. Visual canvas nodes were not representable in v2.
 */
export function migrateV2ToV3(v2: SerializedTopologyV2): {
  topology: SerializedTopologyV3;
  warnings: MigrationWarning[];
} {
  return {
    topology: {
      schemaVersion: 3,
      nodes: v2.nodes,
      edges: v2.edges,
    },
    warnings: [],
  };
}

/**
 * Applies absent-field defaulting to a v3 record. Visual node payloads
 * (sections / text notes) are passed through untouched; simulation nodes are
 * defaulted exactly as in v2.
 */
export function applyV3Defaults(v3: SerializedTopologyV3): {
  topology: SerializedTopologyV3;
  warnings: MigrationWarning[];
} {
  const warnings: MigrationWarning[] = [];
  const nodes: CanvasNodeData[] = v3.nodes.map((node) => {
    if (isSimulationData(node)) return defaultSimulationNode(node, warnings);
    if (node.kind === 'text_note' && typeof node.color !== 'string') {
      return { ...node, color: '#211e1a' };
    }
    return node;
  });
  const edges: EdgeData[] = defaultEdgeWeight(v3.edges, warnings);

  return {
    topology: {
      schemaVersion: 3,
      nodes,
      edges,
    },
    warnings,
  };
}

/**
 * Migrates a v3 record to v4: nodes/edges are carried over untouched and the
 * run-settings block is left absent (defaults are applied on hydration by
 * applyV4Defaults), so legacy files gain sharing support without fabricating
 * run parameters that were never captured.
 */
export function migrateV3ToV4(v3: SerializedTopologyV3): {
  topology: SerializedTopologyV4;
  warnings: MigrationWarning[];
} {
  return {
    topology: {
      schemaVersion: 4,
      nodes: v3.nodes,
      edges: v3.edges,
    },
    warnings: [],
  };
}

/**
 * Applies absent-field defaulting to a v4 record. Node/edge defaults are
 * identical to v3; the run-settings block is defaulted to
 * { durationMs: 120_000, speedMultiplier: 1 } (no seed) when absent or partial.
 */
export function applyV4Defaults(v4: SerializedTopologyV4): {
  topology: SerializedTopologyV4;
  warnings: MigrationWarning[];
} {
  const base = applyV3Defaults({ schemaVersion: 3, nodes: v4.nodes, edges: v4.edges });
  const warnings: MigrationWarning[] = [...base.warnings];

  const raw = v4.settings as Partial<SimulationRunSettings> | undefined;
  const settings: SimulationRunSettings = { durationMs: 120_000, speedMultiplier: 1 };

  if (raw) {
    for (const field of ['durationMs', 'speedMultiplier'] as const) {
      const value = raw[field];
      if (typeof value === 'number' && Number.isFinite(value)) {
        settings[field] = value;
      } else {
        warnings.push({
          label: 'Run Settings',
          field,
          importedValue: value,
          appliedValue: field === 'durationMs' ? 120_000 : 1,
        });
      }
    }
    if (typeof raw.seed === 'number' && Number.isInteger(raw.seed)) {
      settings.seed = raw.seed;
    }
  } else {
    warnings.push({
      label: 'Run Settings',
      field: 'settings',
      importedValue: undefined,
      appliedValue: { ...settings },
    });
  }

  return {
    topology: {
      schemaVersion: 4,
      nodes: base.topology.nodes,
      edges: base.topology.edges,
      settings,
    },
    warnings,
  };
}
