/**
 * Schema migration logic for the persistence layer.
 *
 * Extracted to a separate module to avoid circular dependencies between
 * `persistenceStore.ts` and `utils/localStorage.ts`.
 */

import type { SimulationNode } from '@/types/nodes';
import type { EdgeData } from '@/types/edges';
import type { SubsystemGroup } from '@/types/groups';
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
 */
export interface SerializedTopologyV2 {
  schemaVersion: 2;
  nodes: SimulationNode[];
  edges: EdgeData[];
  subsystemGroups: SubsystemGroup[];
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

  const nodes: SimulationNode[] = v1.nodes.map((node) => {
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
  });

  // edge.weight → 1.0 (R32.4)
  const edges: EdgeData[] = v1.edges.map((edge) => {
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

  const nodes: SimulationNode[] = v2.nodes.map((node) => {
    const patched = { ...node } as Record<string, unknown>;

    // Default routingPolicy if absent
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
  });

  // Default edge weights if absent
  const edges: EdgeData[] = v2.edges.map((edge) => {
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

  // Default subsystemGroups if absent
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
