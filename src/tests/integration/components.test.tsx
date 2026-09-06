// @vitest-environment jsdom
/**
 * Component tests (Task 597): New config forms, 15-item palette,
 * group toolbar, and terminal status table.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NodePalette } from '@/components/canvas/NodePalette';
import { TerminalStatusTable } from '@/components/telemetry/TerminalStatusTable';
import type { NodeMetricsSnapshot } from '@/types/metrics';
import { RequestStatus } from '@/simulation/types';

// ─── NodePalette: renders all 15 node types ──────────────────────

describe('NodePalette renders all 15 node types', () => {
  it('renders the original 9 node type items', () => {
    render(<NodePalette />);
    expect(screen.getByRole('button', { name: /traffic generator/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /api gateway/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /rate limiter/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /load balancer/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /circuit breaker/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /app server/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /cache/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /database/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /message queue/i })).toBeDefined();
  });

  it('renders the 6 new node type items', () => {
    render(<NodePalette />);
    expect(screen.getByRole('button', { name: /auth service/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /authz service/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /worker pool/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /dead letter queue/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /object store/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /scheduler/i })).toBeDefined();
  });

  it('renders category headings for grouped palette', () => {
    render(<NodePalette />);
    expect(screen.getByText('Sources')).toBeDefined();
    expect(screen.getByText('Admission')).toBeDefined();
    expect(screen.getByText('Compute')).toBeDefined();
    expect(screen.getByText('Data')).toBeDefined();
    expect(screen.getByText('Messaging')).toBeDefined();
  });
});

// ─── TerminalStatusTable: renders all nine statuses ──────────────

describe('TerminalStatusTable', () => {
  function makeMetricsNode(nodeId: string, counts: Record<string, number>): NodeMetricsSnapshot {
    return {
      nodeId,
      label: nodeId,
      nodeType: 'APP_SERVER',
      throughput: 100,
      errorRate: 0.1,
      latencyP50: 10,
      latencyP90: 50,
      latencyP99: 100,
      queueDepth: 5,
      activeConnections: 3,
      bufferedMessages: 0,
      utilization: { kind: 'value', value: 0.5 },
      terminalCounts: counts,
      cumulativeTerminalCounts: counts,
      healthStatus: 'green',
    } as unknown as NodeMetricsSnapshot;
  }

  it('shows all nine terminal status labels', () => {
    const nodes = [
      makeMetricsNode('node-1', {
        [RequestStatus.Success]: 100,
        [RequestStatus.Timeout]: 5,
        [RequestStatus.Dropped]: 3,
        [RequestStatus.LoopDetected]: 0,
        [RequestStatus.NoRoute]: 0,
        [RequestStatus.Unauthenticated]: 2,
        [RequestStatus.Forbidden]: 1,
        [RequestStatus.RetryExhausted]: 4,
        [RequestStatus.DeadLettered]: 2,
      }),
    ];

    render(<TerminalStatusTable nodes={nodes} windowDurationSec={5} />);

    expect(screen.getByText('Success')).toBeDefined();
    expect(screen.getByText('Timeout')).toBeDefined();
    expect(screen.getByText('Dropped')).toBeDefined();
    expect(screen.getByText('Loop Detected')).toBeDefined();
    expect(screen.getByText('No Route')).toBeDefined();
    expect(screen.getByText('Unauthenticated')).toBeDefined();
    expect(screen.getByText('Forbidden')).toBeDefined();
    expect(screen.getByText('Retry Exhausted')).toBeDefined();
    expect(screen.getByText('Dead Lettered')).toBeDefined();
  });

  it('shows "No terminated requests yet" when all counts are zero', () => {
    const nodes = [
      makeMetricsNode('node-1', {
        [RequestStatus.Success]: 0,
        [RequestStatus.Timeout]: 0,
        [RequestStatus.Dropped]: 0,
        [RequestStatus.LoopDetected]: 0,
        [RequestStatus.NoRoute]: 0,
        [RequestStatus.Unauthenticated]: 0,
        [RequestStatus.Forbidden]: 0,
        [RequestStatus.RetryExhausted]: 0,
        [RequestStatus.DeadLettered]: 0,
      }),
    ];

    render(<TerminalStatusTable nodes={nodes} windowDurationSec={5} />);
    expect(screen.getAllByText(/no terminated requests yet/i).length).toBeGreaterThan(0);
  });
});

// ─── GroupToolbar removed (group system deleted) ─────────────────

