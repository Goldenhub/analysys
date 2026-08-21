import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateAnalysysSchema,
  serialize,
  deserialize,
  migrateSchema,
  getLocalStorageUsageBytes,
  formatStorageSize,
  type AnalysysFileSchema,
} from './localStorage';

// ─── Helpers ─────────────────────────────────────────────────────

function validTopology() {
  return {
    nodes: [
      {
        id: 'n1',
        nodeType: 'TRAFFIC_GENERATOR',
        label: 'Traffic',
        position: { x: 0, y: 0 },
        config: { rps: 100 },
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
  };
}

function validSchema(): AnalysysFileSchema {
  return {
    schemaVersion: 1,
    name: 'test-topology',
    createdAt: '2024-01-01T00:00:00.000Z',
    topology: validTopology() as AnalysysFileSchema['topology'],
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe('validateAnalysysSchema', () => {
  it('accepts a valid schema object', () => {
    const result = validateAnalysysSchema(validSchema());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects non-object input', () => {
    const result = validateAnalysysSchema(null);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('not a valid JSON object');
  });

  it('rejects missing schemaVersion', () => {
    const { schemaVersion: _, ...rest } = validSchema();
    void _;
    const result = validateAnalysysSchema(rest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('schemaVersion'))).toBe(true);
  });

  it('rejects unsupported schema version', () => {
    const schema = { ...validSchema(), schemaVersion: 99 };
    const result = validateAnalysysSchema(schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('not supported'))).toBe(true);
  });

  it('rejects missing topology', () => {
    const schema = { schemaVersion: 1, name: 'test', createdAt: 'x' };
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
});

describe('serialize', () => {
  it('produces valid JSON with schemaVersion 1', () => {
    const topo = validTopology() as AnalysysFileSchema['topology'];
    const json = serialize(topo, 'my-topology');
    const parsed = JSON.parse(json);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.name).toBe('my-topology');
    expect(parsed.topology.nodes).toHaveLength(1);
    expect(parsed.topology.edges).toHaveLength(1);
    expect(parsed.createdAt).toBeDefined();
  });
});

describe('deserialize', () => {
  it('parses and validates valid JSON', () => {
    const json = JSON.stringify(validSchema());
    const result = deserialize(json);
    expect(result.valid).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.name).toBe('test-topology');
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
});

describe('migrateSchema', () => {
  it('returns data with current schema version', () => {
    const data = validSchema();
    const migrated = migrateSchema(data, 1);
    expect(migrated.schemaVersion).toBe(1);
    expect(migrated.name).toBe(data.name);
  });

  it('preserves topology data during migration', () => {
    const data = validSchema();
    const migrated = migrateSchema(data, 1);
    expect(migrated.topology.nodes).toEqual(data.topology.nodes);
    expect(migrated.topology.edges).toEqual(data.topology.edges);
  });
});

describe('getLocalStorageUsageBytes', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns 0 for empty localStorage', () => {
    expect(getLocalStorageUsageBytes()).toBe(0);
  });

  it('calculates bytes from stored items', () => {
    localStorage.setItem('key1', 'value1');
    const expected = 'key1'.length + 'value1'.length;
    expect(getLocalStorageUsageBytes()).toBe(expected);
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
