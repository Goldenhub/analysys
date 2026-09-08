import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ChaosPanel } from './ChaosPanel';
import { useSimulationStore } from '@/store/simulationStore';
import type { ActiveChaosEffect } from '@/store/simulationStore';
import { useTopologyStore } from '@/store/topologyStore';
import { NodeType, RoutingPolicy } from '@/types/nodes';
import type { AnalysysNode } from '@/types/nodes';
import { SimState } from '@/simulation/types';
import type { MetricsBatchPayload } from '@/types/metrics';

function metricsBatch(simulatedTimeMs: number): MetricsBatchPayload {
  return {
    simulatedTimeMs,
    nodes: [],
    systemWide: {
      totalThroughput: 100,
      endToEndLatency: { p50: 10, p90: 20, p99: 40 },
      totalErrorRate: 0.02,
      activeRequests: 3,
    },
  };
}

const effect: ActiveChaosEffect = {
  id: 'drop-db-1',
  chaosType: 'DROP_DB',
  targetNodeId: 'db-1',
  label: 'DB Outage (db1)',
  description: 'test',
  startTimeMs: 1000,
  durationMs: 2000,
};

describe('ChaosPanel — effect expiry on simulated time', () => {
  beforeEach(() => {
    useSimulationStore.setState({
      simState: SimState.Running,
      metrics: metricsBatch(1200),
      activeChaosEffects: [effect],
      chaosMetricsSnapshots: [
        { effectId: 'drop-db-1', latencyP50: 10, latencyP99: 40, errorRate: 0.01, throughput: 90 },
      ],
    });
  });

  function openPanel() {
    render(<ChaosPanel />);
    fireEvent.click(screen.getByRole('button', { name: /chaos/i }));
  }

  it('keeps the effect chip while sim time is inside the duration', () => {
    openPanel();
    expect(screen.getByText(/Database is DOWN/i)).toBeTruthy();
  });

  it('removes the effect once sim time passes its expiry and shows impact', () => {
    openPanel();

    // Advance simulated time past startTimeMs + durationMs
    act(() => {
      useSimulationStore.setState({ metrics: metricsBatch(3500) });
    });

    expect(screen.queryByText(/Database is DOWN/i)).toBeNull();
    expect(useSimulationStore.getState().activeChaosEffects).toHaveLength(0);
    // Impact summary computed from the before-snapshot ("… Impact:" line)
    expect(screen.getByText(/Impact:/)).toBeTruthy();
  });
});

describe('ChaosPanel — DISABLE_NODE control gating', () => {
  const appServer: AnalysysNode = {
    id: 'app-1',
    type: NodeType.AppServer,
    position: { x: 0, y: 0 },
    data: {
      id: 'app-1',
      nodeType: NodeType.AppServer,
      label: 'Checkout Service',
      position: { x: 0, y: 0 },
      routingPolicy: RoutingPolicy.First,
      config: {
        workerThreadPoolSize: 10,
        requestQueueDepth: 100,
        processingTimeMeanMs: 20,
        processingTimeStdDevMs: 5,
      },
    },
  } as AnalysysNode;

  beforeEach(() => {
    useTopologyStore.setState({ nodes: [appServer], edges: [], past: [], future: [] });
    useSimulationStore.setState({
      metrics: metricsBatch(1000),
      activeChaosEffects: [],
      chaosMetricsSnapshots: [],
    });
  });

  function openPanel() {
    render(<ChaosPanel />);
    fireEvent.click(screen.getByRole('button', { name: /chaos/i }));
  }

  it('lets you pick a node and arm "Disable" while the sim is only Paused', () => {
    useSimulationStore.setState({ simState: SimState.Paused });
    openPanel();

    // This topology has no DB/DLQ nodes, so the node-failure select is the only combobox.
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.disabled).toBe(false);

    const disableButton = screen.getByRole('button', { name: /disable/i }) as HTMLButtonElement;
    expect(disableButton.disabled).toBe(true); // nothing selected yet

    fireEvent.change(select, { target: { value: 'app-1' } });
    expect(disableButton.disabled).toBe(false);

    fireEvent.click(disableButton);
    expect(
      useSimulationStore.getState().activeChaosEffects.some((e) => e.chaosType === 'DISABLE_NODE'),
    ).toBe(true);
  });

  it('disables every chaos control once the run is Complete', () => {
    useSimulationStore.setState({ simState: SimState.Complete });
    openPanel();

    expect(screen.getByText(/Chaos applies to a running system/i)).toBeTruthy();
    expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true);
  });

  it('stays open when the node <select> holds focus (native picker mid-interaction)', () => {
    useSimulationStore.setState({ simState: SimState.Running });
    openPanel();

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    select.focus();

    // A stray document-level pointer event (as iOS dispatches while dismissing a
    // native <select> popup) must NOT unmount the panel out from under the change.
    act(() => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(screen.getByText(/Chaos Engineering/i)).toBeTruthy();

    fireEvent.change(select, { target: { value: 'app-1' } });
    expect(
      (screen.getByRole('button', { name: /disable/i }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('closes on a genuine outside pointer-down', () => {
    useSimulationStore.setState({ simState: SimState.Running });
    openPanel();
    expect(screen.getByText(/Chaos Engineering/i)).toBeTruthy();

    act(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(screen.queryByText(/Chaos Engineering/i)).toBeNull();
  });
});
