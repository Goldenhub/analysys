// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NodePalette } from './canvas/NodePalette';
import { EventLog } from './telemetry/EventLog';
import { QueueGauge } from './telemetry/QueueGauge';
import { MetricsSummary } from './telemetry/MetricsSummary';
import { useTopologyStore } from '@/store/topologyStore';
import { NodeType } from '@/types/nodes';
import type { AnalysysNode } from '@/types/nodes';
import type { SimEventLogEntry } from '@/types/messages';
import type { MetricsBatchPayload, NodeMetricsSnapshot } from '@/types/metrics';

// ─── Task 250: NodePalette renders all 6 node types ──────────────

describe('NodePalette', () => {
  it('renders all 6 node type items', () => {
    render(<NodePalette />);

    expect(screen.getByRole('button', { name: /traffic generator/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /load balancer/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /app server/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /cache/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /database/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /message queue/i })).toBeDefined();
  });

  it('renders category headings', () => {
    render(<NodePalette />);

    expect(screen.getByText('Sources')).toBeDefined();
    expect(screen.getByText('Compute')).toBeDefined();
    expect(screen.getByText('Storage')).toBeDefined();
    expect(screen.getByText('Messaging')).toBeDefined();
  });
});

// ─── Task 255: EventLog renders entries ──────────────────────────

describe('EventLog', () => {
  const mockEntries: SimEventLogEntry[] = [
    { id: 1, timestamp: 1000, type: 'REQUEST_ARRIVAL', nodeId: 'node-abc123', message: 'Request arrived' },
    { id: 2, timestamp: 2000, type: 'REQUEST_PROCESS', nodeId: 'node-def456', message: 'Processing request' },
    { id: 3, timestamp: 3000, type: 'REQUEST_COMPLETE', nodeId: 'node-abc123', message: 'Request completed' },
  ];

  it('renders log entries', () => {
    render(<EventLog entries={mockEntries} />);

    expect(screen.getByText('Request arrived')).toBeDefined();
    expect(screen.getByText('Processing request')).toBeDefined();
    expect(screen.getByText('Request completed')).toBeDefined();
  });

  it('renders descriptive placeholder when entries is empty', () => {
    render(<EventLog entries={[]} />);
    expect(screen.getByText(/Events will appear here during simulation/)).toBeDefined();
  });

  it('displays event count', () => {
    render(<EventLog entries={mockEntries} />);
    expect(screen.getByText('3 events')).toBeDefined();
  });

  it('has a log role for accessibility', () => {
    render(<EventLog entries={mockEntries} />);
    expect(screen.getByRole('log')).toBeDefined();
  });
});

// ─── QueueGauge peak lifecycle ───────────────────────────────────

describe('QueueGauge', () => {
  function makeNode(nodeId: string, queueDepth: number): NodeMetricsSnapshot {
    return {
      nodeId,
      timestamp: 1000,
      throughput: 10,
      errorRate: 0,
      latencyPercentiles: { p50: 1, p90: 2, p99: 3 },
      queueDepth,
      activeConnections: 0,
      bufferOccupancy: 0,
      utilization: 0.5,
      littlesLaw: { nodeId, L: 1, lambda: 1, W: 1, deviation: 0, isStable: true },
      healthStatus: 'green',
    };
  }

  function makeBatch(nodes: NodeMetricsSnapshot[]): MetricsBatchPayload {
    return {
      simulatedTimeMs: 1000,
      nodes,
      systemWide: {
        totalThroughput: 10,
        endToEndLatency: { p50: 1, p90: 2, p99: 3 },
        totalErrorRate: 0,
        activeRequests: 1,
      },
    };
  }

  it('drops peaks for nodes no longer in the topology', () => {
    const first = render(<QueueGauge metrics={makeBatch([makeNode('node-old1', 40)])} />);
    expect(screen.getByText(/node-old/)).toBeDefined();
    first.unmount();

    // A different topology is loaded — the old node must not linger
    render(<QueueGauge metrics={makeBatch([makeNode('node-new1', 25)])} />);
    expect(screen.queryByText(/node-old/)).toBeNull();
    expect(screen.getByText(/node-new/)).toBeDefined();
  });

  it('clears accumulated peaks when the simulation is reset', () => {
    const first = render(<QueueGauge metrics={makeBatch([makeNode('node-abc1', 40)])} />);
    expect(screen.getByText(/node-abc/)).toBeDefined();
    first.unmount();

    // resetMetrics() sets metrics back to null
    const reset = render(<QueueGauge metrics={null} />);
    expect(screen.getByText(/Awaiting queue data/)).toBeDefined();
    reset.unmount();

    // New run starts with an idle node: no stale peak should resurrect a gauge
    render(<QueueGauge metrics={makeBatch([makeNode('node-abc1', 0)])} />);
    expect(screen.getByText(/No active queues or pools/)).toBeDefined();
  });
});

// ─── MetricsSummary resolves node labels ─────────────────────────

describe('MetricsSummary node identification', () => {
  const NODE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  function seedTopology(label: string) {
    const node = {
      id: NODE_ID,
      type: 'default',
      position: { x: 0, y: 0 },
      data: {
        id: NODE_ID,
        nodeType: NodeType.AppServer,
        label,
        position: { x: 0, y: 0 },
        config: {
          workerThreadPoolSize: 10,
          requestQueueDepth: 100,
          processingTimeMeanMs: 50,
          processingTimeStdDevMs: 10,
        },
      },
    } as AnalysysNode;
    useTopologyStore.setState({ nodes: [node], edges: [], past: [], future: [] });
  }

  function makeMetrics(nodeId: string): MetricsBatchPayload {
    return {
      simulatedTimeMs: 5000,
      nodes: [
        {
          nodeId,
          timestamp: 5000,
          throughput: 42,
          errorRate: 0.01,
          latencyPercentiles: { p50: 10, p90: 20, p99: 30 },
          queueDepth: 3,
          activeConnections: 5,
          bufferOccupancy: 0,
          utilization: 0.5,
          littlesLaw: { nodeId, L: 2, lambda: 1, W: 2000, deviation: 0.01, isStable: true },
          healthStatus: 'green',
        },
      ],
      systemWide: {
        totalThroughput: 42,
        endToEndLatency: { p50: 10, p90: 20, p99: 30 },
        totalErrorRate: 0.01,
        activeRequests: 2,
      },
    };
  }

  afterEach(() => {
    useTopologyStore.setState({ nodes: [], edges: [], past: [], future: [] });
  });

  it('renders the node label instead of its identifier', () => {
    seedTopology('Checkout App Server');
    render(<MetricsSummary metrics={makeMetrics(NODE_ID)} />);

    expect(screen.getByText('Checkout App Server')).toBeDefined();
    // The raw UUID (or a truncated form of it) must not be the visible node cell
    expect(screen.queryByText(/a1b2c3d4/)).toBeNull();
  });

  it('keeps the full identifier discoverable as hover text', () => {
    seedTopology('Checkout App Server');
    render(<MetricsSummary metrics={makeMetrics(NODE_ID)} />);

    expect(screen.getByText('Checkout App Server').getAttribute('title')).toBe(NODE_ID);
  });

  it('falls back to a short identifier fragment for unknown nodes', () => {
    render(<MetricsSummary metrics={makeMetrics(NODE_ID)} />);
    expect(screen.getByText('a1b2c3d4…')).toBeDefined();
  });
});
