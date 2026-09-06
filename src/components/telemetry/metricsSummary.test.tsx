import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricsSummary } from './MetricsSummary';
import { useTopologyStore } from '@/store/topologyStore';
import { NodeType, RoutingPolicy } from '@/types/nodes';
import type { MetricsBatchPayload } from '@/types/metrics';

const batch: MetricsBatchPayload = {
  simulatedTimeMs: 2000,
  nodes: [
    {
      nodeId: 'gen-1',
      timestamp: 2000,
      throughput: 100,
      errorRate: 0,
      latencyPercentiles: { p50: 0, p90: 0, p99: 0 },
      queueDepth: 0,
      activeConnections: 0,
      bufferOccupancy: 0,
      utilization: { kind: 'value', value: 0, idle: true },
      littlesLaw: {
        nodeId: 'gen-1',
        L: 0,
        lambda: 100,
        W: 0,
        deviation: 0,
        isStable: true,
      },
      healthStatus: 'green',
      terminalCounts: {},
      cumulativeTerminalCounts: {},
      timeInSystemAtNodeMs: 0,
      pathTimeInSystemMs: 0,
      terminatedThroughNodeCount: 0,
      monitoredDepth: null,
      monitoredDepthBound: null,
      arrivalCount: 47,
      departureCount: 50,
      durationMs: 500,
    },
    {
      nodeId: 'app-1',
      timestamp: 2000,
      throughput: 95,
      errorRate: 0.02,
      latencyPercentiles: { p50: 5, p90: 8, p99: 12 },
      queueDepth: 2,
      activeConnections: 4,
      bufferOccupancy: 0,
      utilization: { kind: 'value', value: 0.4, idle: false },
      littlesLaw: {
        nodeId: 'app-1',
        L: 3,
        lambda: 95,
        W: 31,
        deviation: 0.01,
        isStable: true,
      },
      healthStatus: 'yellow',
      terminalCounts: {},
      cumulativeTerminalCounts: {},
      timeInSystemAtNodeMs: 300,
      pathTimeInSystemMs: 900,
      terminatedThroughNodeCount: 40,
      monitoredDepth: 2,
      monitoredDepthBound: 100,
      arrivalCount: 48,
      departureCount: 46,
      durationMs: 500,
    },
  ],
  systemWide: {
    totalThroughput: 90,
    endToEndLatency: { p50: 20, p90: 40, p99: 80 },
    totalErrorRate: 0.01,
    activeRequests: 5,
  },
};

describe('MetricsSummary per-node breakdown', () => {
  beforeEach(() => {
    useTopologyStore.setState({
      nodes: [
        {
          id: 'gen-1',
          type: NodeType.TrafficGenerator,
          position: { x: 0, y: 0 },
          data: {
            id: 'gen-1',
            nodeType: NodeType.TrafficGenerator,
            label: 'Generator',
            position: { x: 0, y: 0 },
            routingPolicy: RoutingPolicy.First,
            config: {},
          },
        },
        {
          id: 'app-1',
          type: NodeType.AppServer,
          position: { x: 1, y: 0 },
          data: {
            id: 'app-1',
            nodeType: NodeType.AppServer,
            label: 'App Server',
            position: { x: 1, y: 0 },
            routingPolicy: RoutingPolicy.First,
            config: {},
          },
        },
      ],
      // eslint-disable-next-line
    } as never);
  });

  it('renders one row per node snapshot', () => {
    render(<MetricsSummary metrics={batch} />);
    expect(screen.getByText('Generator')).toBeTruthy();
    expect(screen.getByText('App Server')).toBeTruthy();
    // Window labeling appears on both system-wide and per-node sections
    expect(screen.getAllByText(/trailing 5s window/i).length).toBeGreaterThanOrEqual(2);
  });
});
