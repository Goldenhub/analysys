import type { SimulationNode } from '@/types/nodes';
import type { EdgeData } from '@/types/edges';
import type { SubsystemGroup } from '@/types/groups';
import type { MigrationWarning } from '@/types/migration';
import { NodeType } from '@/types/nodes';
import { migrateV1ToV2, type SerializedTopology } from '@/store/schemaMigration';

// ─── Schema Interface ────────────────────────────────────────────

export interface AnalysysFileSchema {
  schemaVersion: number;
  name: string;
  createdAt: string;
  topology: {
    nodes: SimulationNode[];
    edges: EdgeData[];
    subsystemGroups?: SubsystemGroup[];
  };
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  data?: AnalysysFileSchema;
  warnings?: MigrationWarning[];
}

// ─── Constants ───────────────────────────────────────────────────

export const CURRENT_SCHEMA_VERSION = 2;

/**
 * All valid node types — derived from the NodeType enum so that new members
 * added to the enum are automatically accepted by the validator.
 * Replaces the former hard-coded 6-element array that rejected new types.
 */
const VALID_NODE_TYPES: string[] = Object.values(NodeType);

const VALID_EDGE_PROTOCOLS = ['SYNC', 'ASYNC'];

// ─── Runtime Validator ───────────────────────────────────────────

/** Validates an unknown object against the .analysys.json file schema. */
export function validateAnalysysSchema(obj: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof obj !== 'object' || obj === null) {
    return { valid: false, errors: ['File content is not a valid JSON object.'] };
  }

  const record = obj as Record<string, unknown>;

  // Schema version — R34.9: reject absent, non-integer, or below 1
  if (!('schemaVersion' in record) || record.schemaVersion === undefined || record.schemaVersion === null) {
    return {
      valid: false,
      errors: [`Import rejected: schemaVersion field is absent (found: ${JSON.stringify(record.schemaVersion ?? null)}).`],
    };
  }

  if (typeof record.schemaVersion !== 'number' || !Number.isInteger(record.schemaVersion)) {
    return {
      valid: false,
      errors: [`Import rejected: schemaVersion is not an integer (found: ${JSON.stringify(record.schemaVersion)}).`],
    };
  }

  if (record.schemaVersion < 1) {
    return {
      valid: false,
      errors: [`Import rejected: schemaVersion must be at least 1 (found: ${record.schemaVersion}).`],
    };
  }

  // R34.6: reject schema version above current
  if (record.schemaVersion > CURRENT_SCHEMA_VERSION) {
    return {
      valid: false,
      errors: [
        `Import rejected: schema version ${record.schemaVersion} is not supported. This build supports up to version ${CURRENT_SCHEMA_VERSION}.`,
      ],
    };
  }

  // Topology
  if (!('topology' in record) || typeof record.topology !== 'object' || record.topology === null) {
    errors.push('Missing or invalid required field: topology');
  } else {
    const topo = record.topology as Record<string, unknown>;

    // Nodes
    if (!('nodes' in topo) || !Array.isArray(topo.nodes)) {
      errors.push('Missing or invalid field: topology.nodes');
    } else {
      for (let i = 0; i < topo.nodes.length; i++) {
        const node = topo.nodes[i] as Record<string, unknown>;
        if (!node.id || typeof node.id !== 'string') {
          errors.push(`Node at index ${i}: missing or invalid "id"`);
        }
        if (!node.nodeType || !VALID_NODE_TYPES.includes(node.nodeType as string)) {
          errors.push(
            `Node at index ${i}: invalid nodeType "${node.nodeType}". Expected one of: ${VALID_NODE_TYPES.join(', ')}`,
          );
        }
        if (!node.label || typeof node.label !== 'string') {
          errors.push(`Node at index ${i}: missing or invalid "label"`);
        }
        if (!node.position || typeof node.position !== 'object') {
          errors.push(`Node at index ${i}: missing or invalid "position"`);
        }
        if (!node.config || typeof node.config !== 'object') {
          errors.push(`Node at index ${i}: missing or invalid "config"`);
        }
      }
    }

    // Edges
    if (!('edges' in topo) || !Array.isArray(topo.edges)) {
      errors.push('Missing or invalid field: topology.edges');
    } else {
      for (let i = 0; i < topo.edges.length; i++) {
        const edge = topo.edges[i] as Record<string, unknown>;
        if (!edge.id || typeof edge.id !== 'string') {
          errors.push(`Edge at index ${i}: missing or invalid "id"`);
        }
        if (!edge.source || typeof edge.source !== 'string') {
          errors.push(`Edge at index ${i}: missing or invalid "source"`);
        }
        if (!edge.target || typeof edge.target !== 'string') {
          errors.push(`Edge at index ${i}: missing or invalid "target"`);
        }
        if (!edge.protocol || !VALID_EDGE_PROTOCOLS.includes(edge.protocol as string)) {
          errors.push(
            `Edge at index ${i}: invalid protocol "${edge.protocol}". Expected one of: ${VALID_EDGE_PROTOCOLS.join(', ')}`,
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, errors: [], data: obj as AnalysysFileSchema };
}

// ─── Serialize ───────────────────────────────────────────────────

/** Serializes a topology to a JSON string conforming to the .analysys.json schema. */
export function serialize(
  topology: { nodes: SimulationNode[]; edges: EdgeData[]; subsystemGroups?: SubsystemGroup[] },
  name: string,
): string {
  const schema: AnalysysFileSchema = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    name,
    createdAt: new Date().toISOString(),
    topology: {
      nodes: topology.nodes,
      edges: topology.edges,
      subsystemGroups: topology.subsystemGroups ?? [],
    },
  };
  return JSON.stringify(schema, null, 2);
}

// ─── Deserialize ─────────────────────────────────────────────────

/** Parses a JSON string and validates it against the .analysys.json schema. */
export function deserialize(json: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { valid: false, errors: ['Invalid JSON: could not parse file content.'] };
  }

  const result = validateAnalysysSchema(parsed);
  if (!result.valid) return result;

  // Apply migrations if needed
  const migrated = migrateSchema(result.data!, result.data!.schemaVersion);
  return { valid: true, errors: [], data: migrated.data, warnings: migrated.warnings };
}

// ─── Schema Migration ────────────────────────────────────────────

/** Migrates a schema from a previous version to the current version. */
export function migrateSchema(
  data: AnalysysFileSchema,
  fromVersion: number,
): { data: AnalysysFileSchema; warnings: MigrationWarning[] } {
  let current = { ...data };
  let allWarnings: MigrationWarning[] = [];

  if (fromVersion < 2) {
    // Build a SerializedTopology from the file schema and migrate to v2
    const v1Payload: SerializedTopology = {
      schemaVersion: 1,
      nodes: current.topology.nodes,
      edges: current.topology.edges,
    };
    const { topology: migrated, warnings } = migrateV1ToV2(v1Payload);
    current = {
      ...current,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      topology: {
        nodes: migrated.nodes,
        edges: migrated.edges,
        subsystemGroups: migrated.subsystemGroups,
      },
    };
    allWarnings = warnings;
  }

  // Ensure schema version is current
  current.schemaVersion = CURRENT_SCHEMA_VERSION;

  return { data: current, warnings: allWarnings };
}

// ─── Storage Usage ───────────────────────────────────────────────

/**
 * Returns the total number of UTF-8 bytes stored in localStorage.
 * Uses TextEncoder for accurate multi-byte measurement (R34.7).
 */
export function getLocalStorageUsageBytes(): number {
  const encoder = new TextEncoder();
  let totalBytes = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) {
      const value = localStorage.getItem(key);
      if (value) {
        totalBytes += encoder.encode(key).length + encoder.encode(value).length;
      }
    }
  }
  return totalBytes;
}

/** Formats a byte count into a human-readable string (B, KB, or MB). */
export function formatStorageSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
