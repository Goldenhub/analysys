import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ChaosPanel } from './ChaosPanel';
import { useSimulationStore } from '@/store/simulationStore';
import type { ActiveChaosEffect } from '@/store/simulationStore';
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
