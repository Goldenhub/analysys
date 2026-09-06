import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateAnalysysSchema,
  serialize,
  deserialize,
  migrateSchema,
  getLocalStorageUsageBytes,
  formatStorageSize,
  CURRENT_SCHEMA_VERSION,
  type AnalysysFileSchema,
} from './localStorage';
import { NodeType, RoutingPolicy, Distribution } from '@/types/nodes';

// ─── Helpers ─────────────────────────────────────────────────────

function validTopology() {
  return {
    nodes: [
      {
        id: 'n1',
        nodeType: 'TRAFFIC_GENERATOR',
        label: 'Traffic',
        position: { x: 0, y: 0 },
        routingPolicy: 'FIRST',
        config: { rps: 100, distribution: 'POISSON', spikeMultiplier: 1, spikeDurationSec: 10 },
      },
    ],
    edges: [
      {
        id: 'e1',
        source: 'n1',
        target: 'n2',
        protocol: 'SYNC',
        weight: 1.0,
      },
    ],
  };
}

function validSchema(): AnalysysFileSchema {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    name: 'test-topology',
    createdAt: '2024-01-01T00:00:00.000Z',
    topology: validTopology() as unknown as AnalysysFileSchema['topology'],
  };
}

function v1Schema(): AnalysysFileSchema {
  return {
    schemaVersion: 1,
    name: 'v1-topology',
    createdAt: '2024-01-01T00:00:00.000Z',
    topology: {
      nodes: [
        {
          id: 'n1',
          nodeType: NodeType.TrafficGenerator,
          label: 'Traffic',
          position: { x: 10, y: 20 },
          config: {
            rps: 100,
            distribution: Distribution.Poisson,
            spikeMultiplier: 1,
            spikeDurationSec: 10,
          },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'n1',
          target: 'n2',
          protocol: 'SYNC',
        },
      ],
    } as unknown as AnalysysFileSchema['topology'],
  };
}

function v3SchemaFull(): AnalysysFileSchema {
  return {
    schemaVersion: 3,
    name: 'v3-topology',
    createdAt: '2024-01-01T00:00:00.000Z',
    topology: {
      nodes: [
        {
          id: 'n1',
          nodeType: NodeType.TrafficGenerator,
          label: 'Traffic Gen',
          position: { x: 10, y: 20 },
          routingPolicy: RoutingPolicy.RoundRobin,
          config: {
            rps: 200,
            distribution: Distribution.Uniform,
            spikeMultiplier: 2,
            spikeDurationSec: 5,
          },
        },
        {
          id: 'n2',
          nodeType: NodeType.AppServer,
          label: 'App Server',
          position: { x: 100, y: 50 },
          routingPolicy: RoutingPolicy.First,
          config: {
            workerThreadPoolSize: 32,
            requestQueueDepth: 200,
            processingTimeMeanMs: 25,
            processingTimeStdDevMs: 10,
          },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'n1',
          target: 'n2',
          protocol: 'SYNC',
          weight: 2.5,
        },
      ],
    } as unknown as AnalysysFileSchema['topology'],
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe('validateAnalysysSchema', () => {
  it('accepts a valid v2 schema object', () => {
    const result = validateAnalysysSchema(validSchema());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects non-object input', () => {
    const result = validateAnalysysSchema(null);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('not a valid JSON object');
  });

  it('rejects missing schemaVersion (R34.9)', () => {
    const { schemaVersion: _, ...rest } = validSchema();
    void _;
    const result = validateAnalysysSchema(rest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('schemaVersion') && e.includes('absent'))).toBe(
      true,
    );
  });

  it('rejects non-integer schemaVersion (R34.9)', () => {
    const schema = { ...validSchema(), schemaVersion: 1.5 };
    const result = validateAnalysysSchema(schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('not an integer'))).toBe(true);
  });

  it('rejects schemaVersion below 1 (R34.9)', () => {
    const schema = { ...validSchema(), schemaVersion: 0 };
    const result = validateAnalysysSchema(schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('at least 1'))).toBe(true);
  });

  it('rejects schemaVersion string (R34.9)', () => {
    const schema = { ...validSchema(), schemaVersion: 'two' };
    const result = validateAnalysysSchema(schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('not an integer'))).toBe(true);
  });

  it('rejects schemaVersion above 2 with version info (R34.6)', () => {
    const schema = { ...validSchema(), schemaVersion: 99 };
    const result = validateAnalysysSchema(schema);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('99');
    expect(result.errors[0]).toContain(`${CURRENT_SCHEMA_VERSION}`);
  });

  it('rejects missing topology', () => {
    const schema = { schemaVersion: 2, name: 'test', createdAt: 'x' };
    const result = validateAnalysysSchema(schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('topology'))).toBe(true);
  });

  it('rejects invalid node entries', () => {
    const schema = {
      ...validSchema(),
      topology: {
        nodes: [{ id: '', nodeType: 'INVALID', label: '', position: null, config: null }],
        edges: [],
      },
    };
    const result = validateAnalysysSchema(schema);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects invalid edge entries', () => {
    const schema = {
      ...validSchema(),
      topology: {
        nodes: [],
        edges: [{ id: '', source: '', target: '', protocol: 'INVALID' }],
      },
    };
    const result = validateAnalysysSchema(schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('protocol'))).toBe(true);
  });

  it('accepts all 15 valid node types (Task 422)', () => {
    for (const nodeType of Object.values(NodeType)) {
      const schema = {
        ...validSchema(),
        topology: {
          nodes: [{ id: 'n1', nodeType, label: 'Test', position: { x: 0, y: 0 }, config: {} }],
          edges: [],
        },
      };
      const result = validateAnalysysSchema(schema);
      // Should not have nodeType errors for any of the 15 types
      const nodeTypeErrors = result.errors.filter((e) => e.includes('nodeType'));
      expect(nodeTypeErrors).toHaveLength(0);
    }
  });
});

describe('serialize (version 3)', () => {
  it('produces valid JSON with the current schemaVersion', () => {
    const topo = validTopology() as unknown as AnalysysFileSchema['topology'];
    const json = serialize(topo, 'my-topology');
    const parsed = JSON.parse(json);
    expect(parsed.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(parsed.name).toBe('my-topology');
    expect(parsed.topology.nodes).toHaveLength(1);
    expect(parsed.topology.edges).toHaveLength(1);
    expect(parsed.createdAt).toBeDefined();
  });

  it('does not emit the removed subsystemGroups field (group system removed)', () => {
    const topo = validTopology() as unknown as AnalysysFileSchema['topology'];
    const json = serialize(topo, 'grouped');
    const parsed = JSON.parse(json);
    expect(parsed.topology.subsystemGroups).toBeUndefined();
  });
});

describe('deserialize (version 3)', () => {
  it('parses and validates valid v3 JSON', () => {
    const json = JSON.stringify(v3SchemaFull());
    const result = deserialize(json);
    expect(result.valid).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.data!.name).toBe('v3-topology');
  });

  it('rejects invalid JSON strings', () => {
    const result = deserialize('not valid json {{{');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Invalid JSON');
  });

  it('rejects valid JSON with schema errors', () => {
    const result = deserialize(JSON.stringify({ foo: 'bar' }));
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects schemaVersion above the current version', () => {
    const schema = { ...validSchema(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 };
    const result = deserialize(JSON.stringify(schema));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain(`${CURRENT_SCHEMA_VERSION + 1}`);
    expect(result.errors[0]).toContain(`${CURRENT_SCHEMA_VERSION}`);
  });

  it('rejects absent schemaVersion', () => {
    const schema = { name: 'x', createdAt: 'x', topology: validTopology() };
    const result = deserialize(JSON.stringify(schema));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('absent');
  });

  it('rejects negative schemaVersion', () => {
    const schema = { ...validSchema(), schemaVersion: -1 };
    const result = deserialize(JSON.stringify(schema));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('at least 1');
  });
});

describe('migrateSchema (v1 → v3)', () => {
  it('migrates v1 data to the current schema version', () => {
    const data = v1Schema();
    const { data: migrated } = migrateSchema(data, 1);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.name).toBe(data.name);
  });

  it('preserves node positions and existing config during v1→v3 migration', () => {
    const data = v1Schema();
    const { data: migrated } = migrateSchema(data, 1);
    expect(migrated.topology.nodes[0].position).toEqual({ x: 10, y: 20 });
    const config = migrated.topology.nodes[0].config as Record<string, unknown>;
    expect(config.rps).toBe(100);
    expect(config.distribution).toBe(Distribution.Poisson);
  });

  it('defaults routingPolicy to First on v1→v3 migration with a warning', () => {
    const data = v1Schema();
    const { data: migrated, warnings } = migrateSchema(data, 1);
    const node = migrated.topology.nodes[0] as Record<string, unknown>;
    expect(node.routingPolicy).toBe(RoutingPolicy.First);
    expect(warnings.some((w) => w.field === 'routingPolicy')).toBe(true);
  });

  it('defaults edge weight to 1.0 on v1→v3 migration with a warning', () => {
    const data = v1Schema();
    const { data: migrated, warnings } = migrateSchema(data, 1);
    const edge = migrated.topology.edges[0] as Record<string, unknown>;
    expect(edge.weight).toBe(1.0);
    expect(warnings.some((w) => w.field === 'weight')).toBe(true);
  });

  it('does not emit the removed subsystemGroups field', () => {
    const data = v1Schema();
    const { data: migrated } = migrateSchema(data, 1);
    expect(
      (migrated.topology as unknown as { subsystemGroups?: unknown }).subsystemGroups,
    ).toBeUndefined();
  });

  it('produces one warning per applied default', () => {
    const data = v1Schema();
    const { warnings } = migrateSchema(data, 1);
    // Should have warnings for routingPolicy and weight at minimum
    expect(warnings.length).toBeGreaterThanOrEqual(2);
    // Each warning names label, field, and value
    for (const w of warnings) {
      expect(w.label).toBeTruthy();
      expect(w.field).toBeTruthy();
      expect(w.appliedValue).toBeDefined();
    }
  });

  it('preserves current-version data unchanged', () => {
    const data = v3SchemaFull();
    const { data: migrated, warnings } = migrateSchema(data, CURRENT_SCHEMA_VERSION);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    // All fields present should generate no warnings
    expect(warnings).toHaveLength(0);
  });
});

describe('v3 serialize/deserialize round-trip (Task 421)', () => {
  it('exporting a v3 record produces a record equal to the imported one', () => {
    const original = v3SchemaFull();
    const json = JSON.stringify(original);
    const deserialized = deserialize(json);
    expect(deserialized.valid).toBe(true);

    const data = deserialized.data!;
    // Re-serialize
    const reserialized = serialize(data.topology, data.name);
    const reparsed = JSON.parse(reserialized);

    // Verify equality across positions, configs, routing policies, protocols, weights
    const origNode = original.topology.nodes[0] as Record<string, unknown>;
    const roundNode = reparsed.topology.nodes[0];
    expect(roundNode.position).toEqual(origNode.position);
    expect(roundNode.config).toEqual(origNode.config);
    expect(roundNode.routingPolicy).toEqual(origNode.routingPolicy);

    const origEdge = original.topology.edges[0] as Record<string, unknown>;
    const roundEdge = reparsed.topology.edges[0];
    expect(roundEdge.protocol).toEqual(origEdge.protocol);
    expect(roundEdge.weight).toEqual(origEdge.weight);
  });
});

describe('getLocalStorageUsageBytes (UTF-8 measurement)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns 0 for empty localStorage', () => {
    expect(getLocalStorageUsageBytes()).toBe(0);
  });

  it('calculates correct UTF-8 bytes for ASCII content', () => {
    localStorage.setItem('key1', 'value1');
    // ASCII: 1 byte per character
    const expected =
      new TextEncoder().encode('key1').length + new TextEncoder().encode('value1').length;
    expect(getLocalStorageUsageBytes()).toBe(expected);
  });

  it('measures multi-byte characters accurately (Task 425)', () => {
    // '日本語' is 3 characters, each 3 bytes in UTF-8 = 9 bytes for the value
    localStorage.setItem('key', '日本語');
    const expectedKeyBytes = new TextEncoder().encode('key').length;
    const expectedValueBytes = new TextEncoder().encode('日本語').length;
    expect(getLocalStorageUsageBytes()).toBe(expectedKeyBytes + expectedValueBytes);
    // Verify it's more than the naive length-based approach would give
    expect(expectedValueBytes).toBeGreaterThan('日本語'.length);
  });
});

describe('formatStorageSize', () => {
  it('formats bytes', () => {
    expect(formatStorageSize(500)).toBe('500 B');
  });

  it('formats kilobytes', () => {
    expect(formatStorageSize(2048)).toBe('2.0 KB');
  });

  it('formats megabytes', () => {
    expect(formatStorageSize(2 * 1024 * 1024)).toBe('2.00 MB');
  });
});
