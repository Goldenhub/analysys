// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { SimulationEngine } from '@/simulation/engine';
import type { SimulationEngineConfig } from '@/types/messages';
import presetJson from '@/presets/authenticatedWebApi.json';
import { handleWorkerMessage } from './simulationStore';
import { useSimulationStore } from './simulationStore';
import { useTopologyStore } from './topologyStore';
import { SimState } from '@/simulation/types';
import { MetricsSummary } from '@/components/telemetry/MetricsSummary';
import type { MetricsBatchPayload } from '@/types/metrics';

/**
 * Closes the last seam that had no test coverage: a REAL engine running the REAL
 * reference-preset topology produces METRICS_BATCH payloads, which flow through
 * the worker-message handler into the store, and must arrive with non-zero
 * per-node values. This is the exact chain behind "per-node breakdown shows all
 * zeros" reports.
 */
describe('metrics pipeline: real preset engine → worker handler → store → UI', () => {
  beforeEach(() => {
    const preset = presetJson as unknown as {
      topology: {
        nodes: Array<{ id: string; nodeType: string; position: { x: number; y: number } }>;
        edges: Array<{
          id: string;
          source: string;
          target: string;
          protocol: string;
          position?: never;
        }>;
      };
      seed: number;
      speedMultiplier: number;
    };
    // Mirror the canvas store shape exactly as PresetSelector loads it:
    // RF nodes/edges wrap the simulation records in `.data`.
    useTopologyStore.setState({
      nodes: preset.topology.nodes.map((n) => ({
        id: n.id,
        type: n.nodeType,
        position: n.position,
        data: n,
      })) as never[],
      edges: preset.topology.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.protocol,
        data: e,
      })) as never[],
      subsystemGroups: [],
      past: [],
      future: [],
    });
    useSimulationStore.setState({
      simState: SimState.Running,
      metrics: null,
      runSummary: null,
      workerError: null,
    });
  });

  it('delivers non-zero per-node metrics from an authentic preset run', async () => {
    const config: SimulationEngineConfig = {
      topology: presetJson.topology,
      seed: (presetJson as unknown as { seed: number }).seed,
      speedMultiplier: 50,
      maxSimulatedTimeMs: 2500,
      metricsIntervalMs: 500,
      maxHopsPerRequest: 20,
      disablePacing: true,
    };
    const engine = new SimulationEngine(config);

    const batches: MetricsBatchPayload[] = [];
    engine.setCallbacks({
      onMetricsBatch: (payload) => {
        batches.push(payload);
        handleWorkerMessage({ type: 'METRICS_BATCH', payload });
      },
    });

    await engine.run();

    // Sanity: the engine itself produced live traffic…
    expect(batches.length).toBeGreaterThan(2);
    const livelyBatch = batches.find(
      (b) => b.systemWide.totalThroughput > 0 && b.nodes.some((n) => n.throughput > 0),
    );
    expect(livelyBatch).toBeDefined();

    // …and the store holds a batch whose per-node values are non-zero.
    const stored = useSimulationStore.getState().metrics;
    expect(stored).not.toBeNull();
    expect(stored!.nodes.length).toBeGreaterThan(0);
    expect(stored!.nodes.some((n) => n.throughput > 0)).toBe(true);
    expect(stored!.systemWide.totalThroughput).toBeGreaterThan(0);

    // The rendered Per-node table shows those non-zero numbers, not zeros.
    render(<MetricsSummary metrics={stored!} />);
    const tableText = document.body.textContent ?? '';
    expect(tableText).toMatch(/[1-9]\d*\.\d+/); // at least one non-zero decimal reading
  });
});
