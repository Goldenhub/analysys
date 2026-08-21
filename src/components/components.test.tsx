// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NodePalette } from './canvas/NodePalette';
import { EventLog } from './telemetry/EventLog';
import type { SimEventLogEntry } from '@/types/messages';

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

  it('renders "No events yet" when entries is empty', () => {
    render(<EventLog entries={[]} />);
    expect(screen.getByText('No events yet')).toBeDefined();
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
