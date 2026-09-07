import { describe, it, expect } from 'vitest';
import {
  migrateV1ToV2,
  applyV2Defaults,
  parseSimulationText,
  measureUtf8Bytes,
  CURRENT_SCHEMA_VERSION,
  type SerializedTopology,
  type SerializedTopologyV2,
  type SerializedTopologyV3,
} from './persistenceStore';
import { NodeType, RoutingPolicy, Distribution, LBAlgorithm } from '@/types/nodes';

// ─── Helpers ─────────────────────────────────────────────────────

function v1Record(): SerializedTopology {
  return {
    schemaVersion: 1,
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
      } as any,
      {
        id: 'n2',
        nodeType: NodeType.LoadBalancer,
        label: 'LB',
        position: { x: 50, y: 60 },
        config: {
          algorithm: LBAlgorithm.RoundRobin,
          healthCheckIntervalMs: 5000,
          evictionThreshold: 3,
        },
      } as any,
    ],
    edges: [
      {
        id: 'e1',
        source: 'n1',
        target: 'n2',
        protocol: 'SYNC',
      } as any,
    ],
  };
}

function v2Record(): SerializedTopologyV2 {
  return {
    schemaVersion: 2,
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
    subsystemGroups: [{ id: 'g1', name: 'Backend', memberNodeIds: ['n1', 'n2'], collapsed: false }],
  } as any;
}

// ─── Tests ───────────────────────────────────────────────────────

describe('CURRENT_SCHEMA_VERSION', () => {
  it('is 4', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(4);
  });
});

describe('migrateV1ToV2', () => {
  it('produces a v2 topology with schemaVersion 2', () => {
    const { topology } = migrateV1ToV2(v1Record());
    expect(topology.schemaVersion).toBe(2);
  });

  it('sets routingPolicy to First for every node', () => {
    const { topology } = migrateV1ToV2(v1Record());
    for (const node of topology.nodes) {
      expect(node.routingPolicy).toBe(RoutingPolicy.First);
    }
  });

  it('sets edge weight to 1.0 for every edge', () => {
    const { topology } = migrateV1ToV2(v1Record());
    for (const edge of topology.edges) {
      expect(edge.weight).toBe(1.0);
    }
  });

  it('sets subsystemGroups to empty', () => {
    const { topology } = migrateV1ToV2(v1Record());
    expect(topology.subsystemGroups).toEqual([]);
  });

  it('preserves existing node positions', () => {
    const { topology } = migrateV1ToV2(v1Record());
    expect(topology.nodes[0].position).toEqual({ x: 10, y: 20 });
    expect(topology.nodes[1].position).toEqual({ x: 50, y: 60 });
  });

  it('preserves existing config values', () => {
    const { topology } = migrateV1ToV2(v1Record());
    const config = topology.nodes[0].config as Record<string, unknown>;
    expect(config.rps).toBe(100);
    expect(config.distribution).toBe(Distribution.Poisson);
  });

  it('produces one warning per applied default naming label, field, and value', () => {
    const { warnings } = migrateV1ToV2(v1Record());
    expect(warnings.length).toBeGreaterThan(0);
    for (const w of warnings) {
      expect(w.label).toBeTruthy();
      expect(w.field).toBeTruthy();
      expect(w.appliedValue).toBeDefined();
    }
  });

  it('includes routingPolicy warning for each node', () => {
    const { warnings } = migrateV1ToV2(v1Record());
    const rpWarnings = warnings.filter((w) => w.field === 'routingPolicy');
    expect(rpWarnings).toHaveLength(2); // two nodes
  });

  it('includes edge weight warning', () => {
    const { warnings } = migrateV1ToV2(v1Record());
    const weightWarnings = warnings.filter((w) => w.field === 'weight');
    expect(weightWarnings).toHaveLength(1);
  });
});

describe('applyV2Defaults', () => {
  it('returns a complete v2 topology unchanged when all fields are present', () => {
    const record = v2Record();
    const { topology, warnings } = applyV2Defaults(record);
    expect(topology.schemaVersion).toBe(2);
    expect(warnings).toHaveLength(0);
    expect(topology.nodes).toEqual(record.nodes);
    expect(topology.edges).toEqual(record.edges);
    expect(topology.subsystemGroups).toEqual(record.subsystemGroups);
  });

  it('defaults missing routingPolicy to First with warning', () => {
    const record: any = {
      schemaVersion: 2,
      nodes: [
        {
          id: 'n1',
          nodeType: NodeType.AppServer,
          label: 'Server',
          position: { x: 0, y: 0 },
          // routingPolicy intentionally absent
          config: {
            workerThreadPoolSize: 16,
            requestQueueDepth: 100,
            processingTimeMeanMs: 50,
            processingTimeStdDevMs: 15,
          },
        },
      ],
      edges: [],
      subsystemGroups: [],
    };
    const { topology, warnings } = applyV2Defaults(record);
    expect(topology.nodes[0].routingPolicy).toBe(RoutingPolicy.First);
    expect(warnings.some((w) => w.field === 'routingPolicy')).toBe(true);
  });

  it('defaults missing edge weight to 1.0 with warning', () => {
    const record: any = {
      schemaVersion: 2,
      nodes: [],
      edges: [{ id: 'e1', source: 'n1', target: 'n2', protocol: 'SYNC' }],
      subsystemGroups: [],
    };
    const { topology, warnings } = applyV2Defaults(record);
    expect(topology.edges[0].weight).toBe(1.0);
    expect(warnings.some((w) => w.field === 'weight')).toBe(true);
  });

  it('defaults absent subsystemGroups to empty array', () => {
    const record: any = {
      schemaVersion: 2,
      nodes: [],
      edges: [],
      // subsystemGroups intentionally absent
    };
    const { topology } = applyV2Defaults(record);
    expect(topology.subsystemGroups).toEqual([]);
  });

  it('defaults absent R23-R28 config params from createDefaultNodeData', () => {
    const record: any = {
      schemaVersion: 2,
      nodes: [
        {
          id: 'n1',
          nodeType: NodeType.ObjectStore,
          label: 'Store',
          position: { x: 0, y: 0 },
          routingPolicy: RoutingPolicy.First,
          config: {
            objectSizeMeanKB: 256,
            // transferQueueDepth intentionally absent
          },
        },
      ],
      edges: [],
      subsystemGroups: [],
    };
    const { topology, warnings } = applyV2Defaults(record);
    const config = topology.nodes[0].config as Record<string, unknown>;
    expect(config.transferQueueDepth).toBe(100); // default from createDefaultNodeData
    expect(warnings.some((w) => w.field === 'transferQueueDepth')).toBe(true);
  });
});

describe('v2 round-trip (Task 421)', () => {
  it('export then import of v2 record preserves positions, configs, routingPolicies, protocols, weights, and groups', () => {
    const original = v2Record();
    const serialized = JSON.stringify(original);
    const parsed = JSON.parse(serialized) as SerializedTopologyV2;
    const { topology } = applyV2Defaults(parsed);

    // Positions
    for (let i = 0; i < original.nodes.length; i++) {
      expect(topology.nodes[i].position).toEqual(original.nodes[i].position);
    }
    // Configs
    for (let i = 0; i < original.nodes.length; i++) {
      expect(topology.nodes[i].config).toEqual(original.nodes[i].config);
    }
    // Routing policies
    for (let i = 0; i < original.nodes.length; i++) {
      expect(topology.nodes[i].routingPolicy).toEqual(original.nodes[i].routingPolicy);
    }
    // Protocols and weights
    for (let i = 0; i < original.edges.length; i++) {
      expect(topology.edges[i].protocol).toEqual(original.edges[i].protocol);
      expect(topology.edges[i].weight).toEqual(original.edges[i].weight);
    }
    // Groups
    expect(topology.subsystemGroups).toEqual(original.subsystemGroups);
  });
});

describe('measureUtf8Bytes', () => {
  it('measures ASCII correctly', () => {
    expect(measureUtf8Bytes('hello')).toBe(5);
  });

  it('measures multi-byte characters correctly', () => {
    // Each CJK character is 3 bytes in UTF-8
    expect(measureUtf8Bytes('日本語')).toBe(9);
  });

  it('measures emoji correctly', () => {
    // Most emojis are 4 bytes in UTF-8
    const bytes = measureUtf8Bytes('😀');
    expect(bytes).toBe(4);
  });

  it('returns 0 for empty string', () => {
    expect(measureUtf8Bytes('')).toBe(0);
  });
});

// ─── v4 + unified parse path ───────────────────────────────────────

describe('parseSimulationText (v4 migration chain)', () => {
  it('migrates a v1 file all the way to v4 with defaulted run settings', () => {
    const { topology, warnings } = parseSimulationText(JSON.stringify(v1Record()));
    expect(topology.schemaVersion).toBe(4);
    expect(topology.settings).toEqual({ durationMs: 120_000, speedMultiplier: 1 });
    expect(warnings.some((w) => w.field === 'settings')).toBe(true);
  });

  it('migrates a v3 file to v4 with defaulted run settings', () => {
    const v3: SerializedTopologyV3 = {
      schemaVersion: 3,
      nodes: [],
      edges: [],
    };
    const { topology, warnings } = parseSimulationText(JSON.stringify(v3));
    expect(topology.schemaVersion).toBe(4);
    expect(topology.settings).toEqual({ durationMs: 120_000, speedMultiplier: 1 });
    expect(warnings.some((w) => w.field === 'settings')).toBe(true);
  });

  it('preserves a v4 bundle with a captured seed', () => {
    const v4 = {
      schemaVersion: 4,
      nodes: [],
      edges: [],
      settings: { durationMs: 90_000, speedMultiplier: 3, seed: 4242 },
    };
    const { topology, warnings } = parseSimulationText(JSON.stringify(v4));
    expect(topology.schemaVersion).toBe(4);
    expect(topology.settings).toEqual({ durationMs: 90_000, speedMultiplier: 3, seed: 4242 });
    expect(warnings.length).toBe(0);
  });

  it('defaults a partial v4 settings block field-by-field with warnings', () => {
    const v4 = {
      schemaVersion: 4,
      nodes: [],
      edges: [],
      settings: { durationMs: 30_000 } as Partial<Record<string, unknown>>,
    };
    const { topology, warnings } = parseSimulationText(JSON.stringify(v4));
    expect(topology.settings).toEqual({ durationMs: 30_000, speedMultiplier: 1 });
    expect(warnings.some((w) => w.field === 'speedMultiplier')).toBe(true);
    expect(warnings.some((w) => w.field === 'durationMs')).toBe(false);
  });

  it('drops a non-integer seed instead of defaulting', () => {
    const v4 = {
      schemaVersion: 4,
      nodes: [],
      edges: [],
      settings: { durationMs: 30_000, speedMultiplier: 1, seed: 12.5 },
    };
    const { topology } = parseSimulationText(JSON.stringify(v4));
    expect(topology.settings!.seed).toBeUndefined();
  });

  it('defaults architecture metadata on nodes that predate it', () => {
    const v4 = {
      schemaVersion: 4,
      nodes: [
        {
          id: 'n1',
          nodeType: NodeType.TrafficGenerator,
          label: 'Traffic',
          position: { x: 10, y: 20 },
          routingPolicy: RoutingPolicy.First,
          config: {
            rps: 100,
            distribution: Distribution.Poisson,
            spikeMultiplier: 1,
            spikeDurationSec: 10,
          },
        },
        {
          id: 'n2',
          nodeType: NodeType.AppServer,
          label: 'App',
          position: { x: 100, y: 50 },
          routingPolicy: RoutingPolicy.First,
          config: {
            workerThreadPoolSize: 8,
            requestQueueDepth: 100,
            processingTimeMeanMs: 40,
            processingTimeStdDevMs: 10,
          },
        },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2', protocol: 'SYNC', weight: 1 }],
    };
    const { topology, warnings } = parseSimulationText(JSON.stringify(v4));
    expect(topology.nodes[0].parentNodeId).toBeNull();
    expect(topology.nodes[1].parentNodeId).toBeNull();
    expect(warnings.some((w) => w.field === 'parentNodeId')).toBe(true);
  });

  it('preserves architecture metadata unchanged when already present', () => {
    const v4 = {
      schemaVersion: 4,
      nodes: [
        {
          id: 'n1',
          nodeType: NodeType.TrafficGenerator,
          label: 'Traffic',
          position: { x: 10, y: 20 },
          routingPolicy: RoutingPolicy.First,
          parentNodeId: null,
          config: {
            rps: 100,
            distribution: Distribution.Poisson,
            spikeMultiplier: 1,
            spikeDurationSec: 10,
          },
        },
        {
          id: 'n2',
          nodeType: NodeType.AppServer,
          label: 'App',
          position: { x: 100, y: 50 },
          routingPolicy: RoutingPolicy.First,
          parentNodeId: 'n1',
          config: {
            workerThreadPoolSize: 8,
            requestQueueDepth: 100,
            processingTimeMeanMs: 40,
            processingTimeStdDevMs: 10,
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', protocol: 'SYNC', weight: 1 },
      ],
      settings: { durationMs: 90_000, speedMultiplier: 3, seed: 4242 },
    };
    const { topology, warnings } = parseSimulationText(JSON.stringify(v4));
    expect(topology.nodes[0].parentNodeId).toBeNull();
    expect(topology.nodes[1].parentNodeId).toBe('n1');
    expect(warnings).toHaveLength(0);
  });
});
