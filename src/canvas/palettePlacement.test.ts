// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { placePaletteNode } from './palettePlacement';
import { SECTION_NODE_TYPE, TEXT_NOTE_NODE_TYPE } from './types';
import { useTopologyStore } from '../store/topologyStore';
import { NodeType } from '../types/nodes';
import type { SimulationNode } from '../types/nodes';
import { createDefaultNodeData } from '../types/nodeDefaults';

afterEach(() => {
  useTopologyStore.setState({ nodes: [], edges: [], past: [], future: [] });
});

describe('placePaletteNode', () => {
  it('places a section node carrying the active parent id', () => {
    placePaletteNode(SECTION_NODE_TYPE, { x: 12, y: 34 }, 'parent-1');

    const { nodes } = useTopologyStore.getState();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.type).toBe(SECTION_NODE_TYPE);
    expect(nodes[0]!.position).toEqual({ x: 12, y: 34 });
    expect(nodes[0]!.data.parentNodeId).toBe('parent-1');
  });

  it('places a text note at the given position', () => {
    placePaletteNode(TEXT_NOTE_NODE_TYPE, { x: 5, y: 6 }, null);

    const { nodes } = useTopologyStore.getState();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.type).toBe(TEXT_NOTE_NODE_TYPE);
    expect(nodes[0]!.position).toEqual({ x: 5, y: 6 });
    expect(nodes[0]!.data.parentNodeId).toBeNull();
  });

  it('places a default simulation node that matches createDefaultNodeData', () => {
    placePaletteNode(String(NodeType.AppServer), { x: 100, y: 200 }, 'parent-2');

    const { nodes } = useTopologyStore.getState();
    expect(nodes).toHaveLength(1);
    const placed = nodes[0]!.data as SimulationNode;
    const expected = createDefaultNodeData(NodeType.AppServer, { x: 100, y: 200 });

    expect(placed.nodeType).toBe(expected.nodeType);
    expect(placed.label).toBe(expected.label);
    expect(placed.config).toEqual(expected.config);
    expect(placed.parentNodeId).toBe('parent-2');
  });

  it('ignores an unknown node type string', () => {
    placePaletteNode('definitely-not-a-node', { x: 0, y: 0 }, null);

    expect(useTopologyStore.getState().nodes).toHaveLength(0);
  });
});