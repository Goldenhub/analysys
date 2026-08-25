// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { CanvasEditor } from './CanvasEditor';
import { useTopologyStore } from '@/store/topologyStore';
import type { SubsystemGroup } from '@/types/groups';
import type { AnalysysNode, SimulationNode } from '@/types/nodes';
import { NodeType, RoutingPolicy } from '@/types/nodes';
import { EdgeProtocol } from '@/types/edges';
import type { AnalysysEdge } from '@/types/edges';

// React Flow observes its container on mount; jsdom ships no ResizeObserver.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', NoopResizeObserver);

function simNode(id: string): SimulationNode {
  return {
    id,
    nodeType: NodeType.AppServer,
    label: `Service ${id.toUpperCase()}`,
    position: { x: 0, y: 0 },
    routingPolicy: RoutingPolicy.First,
    config: {},
  };
}

afterEach(() => {
  cleanup();
  useTopologyStore.setState({ nodes: [], edges: [], subsystemGroups: [], past: [], future: [] });
});

describe('expanded group frame visibility', () => {
  it('renders a labelled, high-contrast frame behind grouped members', () => {
    const rfNodes: AnalysysNode[] = (['a', 'b'] as string[]).map((id) => ({
      id,
      type: NodeType.AppServer,
      position: { x: id === 'a' ? 0 : 200, y: 40 },
      data: simNode(id) as unknown as AnalysysNode['data'],
    }));
    const rfEdges: AnalysysEdge[] = [
      {
        id: 'e1',
        source: 'a',
        target: 'b',
        type: EdgeProtocol.Sync,
        data: { id: 'e1', source: 'a', target: 'b', protocol: EdgeProtocol.Sync, weight: 1 },
      },
    ];
    const group: SubsystemGroup = {
      id: 'g1',
      name: 'Checkout Service',
      memberNodeIds: ['a', 'b'],
      collapsed: false,
    };
    useTopologyStore.setState({
      nodes: rfNodes,
      edges: rfEdges,
      subsystemGroups: [group],
      past: [],
      future: [],
    });

    render(<CanvasEditor onNodeSelect={() => {}} />);

    // The frame must exist in the rendered DOM…
    const frame = document.querySelector('[aria-label^="Subsystem group: Checkout Service"]');
    expect(frame).not.toBeNull();
    // …and be actually visible against the dark canvas: an indigo-400-class
    // border plus a tinted fill, not the near-invisible indigo-800-on-gray-950
    // styling that motivated this test.
    expect(frame!.className).toContain('border-indigo-400');
    expect(frame!.className).toContain('bg-indigo-500/15');

    // The name chip is rendered inside the frame.
    expect(screen.getAllByText('Checkout Service').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2 nodes/).length).toBeGreaterThan(0);
  });
});
