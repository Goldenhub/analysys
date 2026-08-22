// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { NodePalette } from './NodePalette';
import { CanvasEditor } from './CanvasEditor';
import { useTopologyStore } from '@/store/topologyStore';
import { NodeType } from '@/types/nodes';
import type { SimulationNode } from '@/types/nodes';
import { createDefaultNodeData } from '@/types/nodeDefaults';

// React Flow observes its container on mount; jsdom ships no ResizeObserver.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', NoopResizeObserver);

// ─── Helpers ─────────────────────────────────────────────────────

function placedNode(): SimulationNode {
  const { nodes } = useTopologyStore.getState();
  expect(nodes).toHaveLength(1);
  return nodes[0]!.data as SimulationNode;
}

/** A DataTransfer stand-in: jsdom does not implement one. */
function dataTransferCarrying(nodeType: NodeType) {
  return {
    getData: (format: string) =>
      format === 'application/analysys-node-type' ? String(nodeType) : '',
    setData: () => {},
    dropEffect: 'move',
    effectAllowed: 'move',
  };
}

afterEach(() => {
  cleanup();
  useTopologyStore.setState({ nodes: [], edges: [], past: [], future: [] });
});

// ─── R29.4: the two placement paths cannot drift ─────────────────

describe('node placement paths', () => {
  it('places a node from the palette keyboard path at createDefaultNodeData values', () => {
    render(<NodePalette />);

    fireEvent.keyDown(screen.getByRole('button', { name: /Add App Server node/ }), {
      key: 'Enter',
    });

    const placed = placedNode();
    const expected = createDefaultNodeData(NodeType.AppServer, placed.position);

    expect(placed.nodeType).toBe(expected.nodeType);
    expect(placed.label).toBe(expected.label);
    expect(placed.routingPolicy).toBe(expected.routingPolicy);
    expect(placed.config).toEqual(expected.config);
  });

  it('places a node from the canvas drop handler at the same values', () => {
    const { container } = render(<CanvasEditor />);

    const pane = container.querySelector('.react-flow');
    expect(pane).not.toBeNull();

    fireEvent.drop(pane!, { dataTransfer: dataTransferCarrying(NodeType.AppServer) });

    const placed = placedNode();
    const expected = createDefaultNodeData(NodeType.AppServer, placed.position);

    expect(placed.nodeType).toBe(expected.nodeType);
    expect(placed.label).toBe(expected.label);
    expect(placed.routingPolicy).toBe(expected.routingPolicy);
    expect(placed.config).toEqual(expected.config);
  });

  it('agrees on the configuration whichever path placed the node', () => {
    // Before both paths shared createDefaultNodeData, the drop handler and the palette's
    // keyboard path each carried their own literal and drifted apart.
    render(<NodePalette />);
    fireEvent.keyDown(screen.getByRole('button', { name: /Add Database node/ }), {
      key: 'Enter',
    });
    const fromPalette = placedNode();

    cleanup();
    useTopologyStore.setState({ nodes: [], edges: [], past: [], future: [] });

    const { container } = render(<CanvasEditor />);
    fireEvent.drop(container.querySelector('.react-flow')!, {
      dataTransfer: dataTransferCarrying(NodeType.Database),
    });
    const fromDrop = placedNode();

    expect(fromDrop.config).toEqual(fromPalette.config);
    expect(fromDrop.label).toBe(fromPalette.label);
    expect(fromDrop.routingPolicy).toBe(fromPalette.routingPolicy);
  });
});
