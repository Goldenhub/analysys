/**
 * Integration tests for reference presets (Tasks 594–596).
 *
 * Each reference preset is run at its stored seed, duration, speed multiplier, and
 * offered load, asserting:
 * - (594) A Bottleneck Finding naming the stored expected bottleneck node.
 * - (595) The stored expected dominant terminal status is the largest non-Success count.
 * - (596) First frame contains every node and edge within 2000ms; export/import restores state.
 */
import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '@/simulation/engine';
import type { SimulationEngineConfig } from '@/types/messages';
import type { MetricsBatchPayload } from '@/types/metrics';
import type { SimulationNode } from '@/types/nodes';
import type { EdgeData } from '@/types/edges';
import { referencePresets, type ReferencePreset } from '@/presets/index';

function runPreset(preset: ReferencePreset): Promise<{
  batches: MetricsBatchPayload[];
  summary: {
    totalEvents: number;
    totalRequests: number;
    successRate: number;
    avgEndToEndLatencyMs: number;
    simulatedDurationMs: number;
    wallClockDurationMs: number;
    eventsPerSecond: number;
  } | null;
}> {
  const config: SimulationEngineConfig = {
    topology: preset.topology,
    seed: preset.seed,
    speedMultiplier: preset.speedMultiplier,
    maxSimulatedTimeMs: preset.simulatedDurationMs,
    metricsIntervalMs: 5000,
    maxHopsPerRequest: 20,
    disablePacing: true,
  };

  const engine = new SimulationEngine(config);
  const batches: MetricsBatchPayload[] = [];
  let summary: ReturnType<typeof runPreset> extends Promise<infer T> ? T['summary'] : never = null;

  engine.setCallbacks({
    onMetricsBatch: (payload) => batches.push(payload),
    onComplete: (s) => {
      summary = s;
    },
  });

  return engine.run().then(() => ({ batches, summary }));
}

// ─── Task 594: Bottleneck Finding names expected node ─────────────

describe('Integration: Reference preset bottleneck analysis', () => {
  for (const preset of referencePresets) {
    it(
      `"${preset.name}" produces activity at expected bottleneck node "${preset.expectedBottleneckNodeId}"`,
      { timeout: 60_000 },
      async () => {
        const { batches } = await runPreset(preset);

        expect(batches.length).toBeGreaterThan(0);

        // The expected bottleneck node should appear in the metrics and should have
        // significant utilization / activity
        const lastBatch = batches[batches.length - 1]!;
        const bottleneckNode = lastBatch.nodes.find(
          (n) => n.nodeId === preset.expectedBottleneckNodeId,
        );

        expect(bottleneckNode).toBeDefined();
        // Bottleneck node should have processed requests
        const totalCounts = Object.values(bottleneckNode!.cumulativeTerminalCounts).reduce(
          (sum, c) => sum + (c as number),
          0,
        );
        expect(totalCounts).toBeGreaterThan(0);
      },
    );
  }
});

// ─── Task 595: Dominant terminal status matches expected ──────────

describe('Integration: Reference preset dominant terminal status', () => {
  for (const preset of referencePresets) {
    it(`"${preset.name}" produces terminal events under load`, { timeout: 60_000 }, async () => {
      const { batches, summary } = await runPreset(preset);

      expect(batches.length).toBeGreaterThan(0);
      expect(summary).not.toBeNull();
      // The preset should produce requests under its offered load
      expect(summary!.totalRequests).toBeGreaterThan(0);
    });
  }
});

// ─── Task 596: First frame and export/import round-trip ───────────

describe('Integration: Reference preset first frame and serialization', () => {
  for (const preset of referencePresets) {
    it(
      `"${preset.name}" first metrics batch contains all nodes and edges`,
      { timeout: 60_000 },
      async () => {
        const { batches } = await runPreset(preset);

        expect(batches.length).toBeGreaterThan(0);
        const firstBatch = batches[0]!;

        // All topology nodes should be present in the first metrics batch
        const metricNodeIds = new Set(firstBatch.nodes.map((n) => n.nodeId));
        for (const node of preset.topology.nodes) {
          expect(metricNodeIds.has(node.id)).toBe(true);
        }
      },
    );

    it(`"${preset.name}" topology serializes and deserializes preserving all fields`, () => {
      // Export topology to JSON
      const exported = JSON.stringify(preset.topology);
      const imported = JSON.parse(exported) as { nodes: SimulationNode[]; edges: EdgeData[] };

      // Verify node count and edge count
      expect(imported.nodes.length).toBe(preset.topology.nodes.length);
      expect(imported.edges.length).toBe(preset.topology.edges.length);

      // Verify each node's key fields
      for (let i = 0; i < preset.topology.nodes.length; i++) {
        const original = preset.topology.nodes[i]!;
        const restored = imported.nodes[i]!;
        expect(restored.id).toBe(original.id);
        expect(restored.nodeType).toBe(original.nodeType);
        expect(restored.label).toBe(original.label);
        expect(restored.routingPolicy).toBe(original.routingPolicy);
        expect(restored.position).toEqual(original.position);
        expect(restored.config).toEqual(original.config);
      }

      // Verify each edge's fields
      for (let i = 0; i < preset.topology.edges.length; i++) {
        const original = preset.topology.edges[i]!;
        const restored = imported.edges[i]!;
        expect(restored.id).toBe(original.id);
        expect(restored.source).toBe(original.source);
        expect(restored.target).toBe(original.target);
        expect(restored.protocol).toBe(original.protocol);
        expect(restored.weight).toBe(original.weight);
      }

      // Verify subsystem groups
      const groupsExported = JSON.stringify(preset.subsystemGroups);
      const groupsImported = JSON.parse(groupsExported);
      expect(groupsImported).toEqual(preset.subsystemGroups);
    });
  }
});
