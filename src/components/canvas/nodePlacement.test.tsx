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

    const pane = container.querySelector('[data-testid="canvas-engine"]');
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
    fireEvent.drop(container.querySelector('[data-testid="canvas-engine"]')!, {
      dataTransfer: dataTransferCarrying(NodeType.Database),
    });
    const fromDrop = placedNode();

    expect(fromDrop.config).toEqual(fromPalette.config);
    expect(fromDrop.label).toBe(fromPalette.label);
    expect(fromDrop.routingPolicy).toBe(fromPalette.routingPolicy);
  });
});

// ─── Dangling edge must not break hook order ─────────────────────

describe('edge rendering hook-order stability', () => {
  // Regression: when an edge's source or target node is missing (a dangling
  // edge), the prior code returned `null` instead of rendering the edge renderer
  // (SyncEdge/AsyncEdge), which call React hooks. As a node was added/removed the
  // number of hook-calling children shifted across renders, throwing
  // "Rendered more hooks than during the previous render." Every edge must now
  // always render a stable element so hook order never changes.
  it('does not throw when an edge target node is removed then re-added', () => {
    const gen = createDefaultNodeData(NodeType.TrafficGenerator, { x: 0, y: 0 });
    const app = createDefaultNodeData(NodeType.AppServer, { x: 200, y: 0 });
    const edge = {
      id: 'e1',
      source: gen.id,
      target: app.id,
      type: 'SYNC' as const,
      data: { id: 'e1', source: gen.id, target: app.id, protocol: 'SYNC' as const, weight: 1 },
    };

    const canvasNodes = (nodes: SimulationNode[]) =>
      nodes.map((n) => ({
        id: n.id,
        type: n.nodeType as unknown as string,
        position: n.position,
        data: n,
      }));

    useTopologyStore.setState({
      nodes: canvasNodes([gen, app]),
      edges: [edge],
      past: [],
      future: [],
    });

    const { container } = render(<CanvasEditor />);
    expect(container.querySelector('[data-testid="canvas-engine"]')).not.toBeNull();

    // Remove the target node -> the edge becomes dangling.
    useTopologyStore.setState({
      nodes: canvasNodes([gen]),
      edges: [edge],
      past: [],
      future: [],
    });

    // Re-add the target node -> the edge renderer mounts again. Before the fix
    // this toggle shifted the hook order and crashed.
    expect(() =>
      useTopologyStore.setState({
        nodes: canvasNodes([gen, app]),
        edges: [edge],
        past: [],
        future: [],
      }),
    ).not.toThrow();

    cleanup();
    useTopologyStore.setState({ nodes: [], edges: [], past: [], future: [] });
  });
});
