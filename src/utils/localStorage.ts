import type { SimulationNode } from '@/types/nodes';
import type { EdgeData } from '@/types/edges';

// ─── Schema Interface ────────────────────────────────────────────

export interface AnalysysFileSchema {
  schemaVersion: number;
  name: string;
  createdAt: string;
  topology: {
    nodes: SimulationNode[];
    edges: EdgeData[];
  };
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  data?: AnalysysFileSchema;
}

// ─── Constants ───────────────────────────────────────────────────

const CURRENT_SCHEMA_VERSION = 1;

const VALID_NODE_TYPES = [
  'TRAFFIC_GENERATOR',
  'LOAD_BALANCER',
  'APP_SERVER',
  'CACHE',
  'DATABASE',
  'MESSAGE_QUEUE',
];

const VALID_EDGE_PROTOCOLS = ['SYNC', 'ASYNC'];

// ─── Runtime Validator ───────────────────────────────────────────

/** Validates an unknown object against the .analysys.json file schema. */
export function validateAnalysysSchema(obj: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof obj !== 'object' || obj === null) {
    return { valid: false, errors: ['File content is not a valid JSON object.'] };
  }

  const record = obj as Record<string, unknown>;

  // Schema version
  if (!('schemaVersion' in record) || typeof record.schemaVersion !== 'number') {
    errors.push('Missing or invalid required field: schemaVersion');
  } else if (record.schemaVersion > CURRENT_SCHEMA_VERSION) {
    errors.push(
      `Schema version ${record.schemaVersion} is not supported. Maximum: ${CURRENT_SCHEMA_VERSION}`,
    );
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
  topology: { nodes: SimulationNode[]; edges: EdgeData[] },
  name: string,
): string {
  const schema: AnalysysFileSchema = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    name,
    createdAt: new Date().toISOString(),
    topology,
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
  return { valid: true, errors: [], data: migrated };
}

// ─── Schema Migration ────────────────────────────────────────────

/** Migrates a schema from a previous version to the current version. */
export function migrateSchema(
  data: AnalysysFileSchema,
  fromVersion: number,
): AnalysysFileSchema {
  let current = { ...data };

  // Future migrations would go here:
  // if (fromVersion < 2) { current = migrateV1ToV2(current); }

  // Ensure schema version is current
  current.schemaVersion = CURRENT_SCHEMA_VERSION;

  // Suppress unused parameter lint (will be used when migrations are added)
  void fromVersion;

  return current;
}

// ─── Storage Usage ───────────────────────────────────────────────

/** Returns the total number of bytes stored in localStorage. */
export function getLocalStorageUsageBytes(): number {
  let totalBytes = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) {
      const value = localStorage.getItem(key);
      if (value) {
        totalBytes += key.length + value.length;
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
