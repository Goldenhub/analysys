/**
 * Component-layer assertions for the Microservices E-Commerce reference preset.
 *
 * Unlike the flat presets, this one exercises `parentNodeId` nesting (component
 * layers). These tests pin the layer structure and edge legality, and confirm
 * the nested admission services actually receive traffic during a run.
 */
import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '@/simulation/engine';
import type { SimulationEngineConfig } from '@/types/messages';
import type { MetricsBatchPayload } from '@/types/metrics';
import type { SimulationNode } from '@/types/nodes';
import { validateEdgeConnection } from '@/validation';
import microservicesEcommerceData from '@/presets/microservicesEcommerce.json';
import type { ReferencePreset } from '@/presets/index';

const preset = microservicesEcommerceData as unknown as ReferencePreset;
const nodesById = new Map<string, SimulationNode>(
  preset.topology.nodes.map((n) => [n.id, n]),
);

function runPreset(): Promise<MetricsBatchPayload[]> {
  const config: SimulationEngineConfig = {
    topology: preset.topology,
    seed: preset.seed,
    speedMultiplier: preset.speedMultiplier,
    maxSimulatedTimeMs: Math.min(preset.simulatedDurationMs, 12_000),
    metricsIntervalMs: 5000,
    maxHopsPerRequest: 20,
    disablePacing: true,
  };
  const engine = new SimulationEngine(config);
  const batches: MetricsBatchPayload[] = [];
  engine.setCallbacks({ onMetricsBatch: (payload) => batches.push(payload) });
  return engine.run().then(() => batches);
}

// ─── Component layers ────────────────────────────────────────────

describe('Microservices E-Commerce preset: component layers', () => {
  it('declares an admission layer under the API Gateway', () => {
    const admissionChildren = preset.topology.nodes
      .filter((n) => n.parentNodeId === 'api-gw-1')
      .map((n) => n.id)
      .sort();
    expect(admissionChildren).toEqual(['auth-1', 'authz-1', 'cache-token-1']);
  });

  it('declares a checkout core layer under the Checkout Service', () => {
    const checkoutChildren = preset.topology.nodes
      .filter((n) => n.parentNodeId === 'checkout-1')
      .map((n) => n.id)
      .sort();
    expect(checkoutChildren).toEqual(['inventory-1', 'order-1', 'payment-1']);
  });

  it('keeps the request path at the root layer', () => {
    const rootNodes = preset.topology.nodes
      .filter((n) => n.parentNodeId == null)
      .map((n) => n.id)
      .sort();
    for (const expected of ['tg-1', 'api-gw-1', 'checkout-1', 'cache-1', 'db-1', 'mq-1', 'worker-1', 'dlq-1', 'obj-1']) {
      expect(rootNodes).toContain(expected);
    }
  });

  it('routes the gateway into its own layer with weighted splits', () => {
    const apiGw = nodesById.get('api-gw-1')!;
    expect(apiGw.routingPolicy).toBe('WEIGHTED');
    const splits = preset.topology.edges.filter((e) => e.source === 'api-gw-1');
    expect(splits.map((e) => e.target).sort()).toEqual(['auth-1', 'authz-1', 'checkout-1']);
    const totalWeight = splits.reduce((sum, e) => sum + e.weight, 0);
    expect(totalWeight).toBeCloseTo(1.0, 6);
  });
});

// ─── Edge legality ───────────────────────────────────────────────

describe('Microservices E-Commerce preset: edge legality', () => {
  it('every edge passes connection validation', () => {
    for (const edge of preset.topology.edges) {
      const source = nodesById.get(edge.source)!;
      const target = nodesById.get(edge.target)!;
      const otherEdges = preset.topology.edges.filter((e) => e.id !== edge.id);
      const result = validateEdgeConnection(source, target, edge.protocol, otherEdges, nodesById);
      expect(result.valid, `${edge.source} -> ${edge.target}: ${result.reason}`).toBe(true);
    }
  });
});

// ─── Runtime participation of layered children ───────────────────

describe('Microservices E-Commerce preset: layered nodes receive traffic', () => {
  it('admission-layer auth and authz services see real requests', { timeout: 60_000 }, async () => {
    const batches = await runPreset();
    const hasActivity = (nodeId: string): boolean =>
      batches.some((batch) => {
        const metric = batch.nodes.find((n) => n.nodeId === nodeId);
        if (!metric) return false;
        const hasTerminalActivity = Object.values(metric.cumulativeTerminalCounts).some(
          (c) => (c as number) > 0,
        );
        return (
          hasTerminalActivity || metric.arrivalCount > 0 || metric.throughput > 0 || metric.queueDepth > 0
        );
      });
    for (const nodeId of ['auth-1', 'authz-1', 'cache-token-1', 'order-1', 'inventory-1', 'payment-1']) {
      expect(hasActivity(nodeId), `node ${nodeId} should have live activity across the run`).toBe(true);
    }
  });

  it('produces the expected bottleneck activity', { timeout: 60_000 }, async () => {
    const batches = await runPreset();
    const hasThroughput = batches.some(
      (batch) => (batch.nodes.find((n) => n.nodeId === preset.expectedBottleneckNodeId)?.throughput ?? 0) > 0,
    );
    const hasQueue = batches.some(
      (batch) => (batch.nodes.find((n) => n.nodeId === preset.expectedBottleneckNodeId)?.queueDepth ?? 0) > 0,
    );
    expect(hasThroughput).toBe(true);
    expect(hasQueue).toBe(true);
  });
});