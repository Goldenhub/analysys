import { describe, it, expect, beforeEach } from 'vitest';
import { useTopologyStore } from '@/store/topologyStore';
import { NodeType, RoutingPolicy } from '@/types/nodes';
import { EdgeProtocol } from '@/types/edges';
import type { AnalysysNode } from '@/types/nodes';
import type { AnalysysEdge } from '@/types/edges';
import { computeCollapsedView } from './useCollapsedTopologyView';
import {
  validateGroupName,
  validateGroupCreation,
  normaliseImportedGroups,
} from '@/validation/groupValidation';
import type { SubsystemGroup } from '@/types/groups';

// ─── Helpers ─────────────────────────────────────────────────────

function createTestNode(id: string, label?: string): AnalysysNode {
  return {
    id,
    type: 'default',
    position: { x: Math.random() * 500, y: Math.random() * 500 },
    data: {
      id,
      nodeType: NodeType.AppServer,
      label: label ?? `Node ${id}`,
      position: { x: 100, y: 200 },
      routingPolicy: RoutingPolicy.First,
      config: {
        workerThreadPoolSize: 10,
        requestQueueDepth: 100,
        processingTimeMeanMs: 50,
        processingTimeStdDevMs: 10,
      },
    },
  } as AnalysysNode;
}

function createTestEdge(id: string, source: string, target: string): AnalysysEdge {
  return {
    id,
    source,
    target,
    data: {
      id,
      source,
      target,
      protocol: EdgeProtocol.Sync,
      weight: 1.0,
    },
  } as AnalysysEdge;
}

// ─── Tests ───────────────────────────────────────────────────────

describe('Subsystem Grouping', () => {
  beforeEach(() => {
    useTopologyStore.setState({
      nodes: [],
      edges: [],
      subsystemGroups: [],
      past: [],
      future: [],
    });
  });

  describe('Store group actions', () => {
    it('createGroup creates a group with selected nodes', () => {
      const nodes = [createTestNode('a'), createTestNode('b'), createTestNode('c')];
      useTopologyStore.setState({ nodes, edges: [], subsystemGroups: [], past: [], future: [] });

      const result = useTopologyStore.getState().createGroup(['a', 'b']);
      expect(result).toBeNull();
      expect(useTopologyStore.getState().subsystemGroups).toHaveLength(1);
      expect(useTopologyStore.getState().subsystemGroups[0].memberNodeIds).toEqual(['a', 'b']);
    });

    it('createGroup rejects when fewer than 2 nodes selected', () => {
      const nodes = [createTestNode('a')];
      useTopologyStore.setState({ nodes, edges: [], subsystemGroups: [], past: [], future: [] });

      const result = useTopologyStore.getState().createGroup(['a']);
      expect(result).not.toBeNull();
      expect(result!.constraint).toContain('at least 2');
    });

    it('createGroup rejects when node already in a group', () => {
      const nodes = [createTestNode('a'), createTestNode('b'), createTestNode('c')];
      const group: SubsystemGroup = {
        id: 'g1', name: 'Group 1', memberNodeIds: ['a'], collapsed: false,
      };
      useTopologyStore.setState({ nodes, edges: [], subsystemGroups: [group], past: [], future: [] });

      const result = useTopologyStore.getState().createGroup(['a', 'b']);
      expect(result).not.toBeNull();
      expect(result!.nodeLabels).toContain('Node a');
    });

    it('createGroup rejects when max groups reached', () => {
      const nodes = Array.from({ length: 42 }, (_, i) => createTestNode(`n${i}`));
      const groups = Array.from({ length: 20 }, (_, i) => ({
        id: `g${i}`, name: `Group ${i}`, memberNodeIds: [`n${i * 2}`, `n${i * 2 + 1}`], collapsed: false,
      }));
      useTopologyStore.setState({ nodes, edges: [], subsystemGroups: groups, past: [], future: [] });

      const result = useTopologyStore.getState().createGroup(['n40', 'n41']);
      expect(result).not.toBeNull();
      expect(result!.constraint).toContain('20');
    });

    it('renameGroup validates name constraints', () => {
      const nodes = [createTestNode('a'), createTestNode('b')];
      useTopologyStore.setState({ nodes, edges: [], subsystemGroups: [], past: [], future: [] });
      useTopologyStore.getState().createGroup(['a', 'b']);
      const groupId = useTopologyStore.getState().subsystemGroups[0].id;

      // Empty name rejected
      const err1 = useTopologyStore.getState().renameGroup(groupId, '  ');
      expect(err1).toContain('empty');

      // Over 40 chars rejected
      const err2 = useTopologyStore.getState().renameGroup(groupId, 'a'.repeat(41));
      expect(err2).toContain('40');

      // Valid name accepted
      const err3 = useTopologyStore.getState().renameGroup(groupId, 'Backend Tier');
      expect(err3).toBeNull();
      expect(useTopologyStore.getState().subsystemGroups[0].name).toBe('Backend Tier');
    });

    it('renameGroup rejects case-insensitive duplicates', () => {
      const nodes = [createTestNode('a'), createTestNode('b'), createTestNode('c'), createTestNode('d')];
      useTopologyStore.setState({ nodes, edges: [], subsystemGroups: [], past: [], future: [] });
      useTopologyStore.getState().createGroup(['a', 'b']);
      useTopologyStore.getState().createGroup(['c', 'd']);
      const groups = useTopologyStore.getState().subsystemGroups;
      const err = useTopologyStore.getState().renameGroup(groups[1].id, groups[0].name.toUpperCase());
      expect(err).toContain('conflicts');
    });

    it('removeNode drops node from group and deletes group with < 2 members', () => {
      const nodes = [createTestNode('a'), createTestNode('b')];
      const group: SubsystemGroup = { id: 'g1', name: 'G', memberNodeIds: ['a', 'b'], collapsed: false };
      useTopologyStore.setState({ nodes, edges: [], subsystemGroups: [group], past: [], future: [] });

      useTopologyStore.getState().removeNode('a');
      // Group should be deleted (only 1 member left)
      expect(useTopologyStore.getState().subsystemGroups).toHaveLength(0);
      // Node b remains on canvas
      expect(useTopologyStore.getState().nodes.find((n) => n.id === 'b')).toBeTruthy();
    });

    it('deleteGroup retains all nodes and edges at their stored positions', () => {
      const nodes = [createTestNode('a'), createTestNode('b')];
      const edges = [createTestEdge('e1', 'a', 'b')];
      const group: SubsystemGroup = { id: 'g1', name: 'G', memberNodeIds: ['a', 'b'], collapsed: true };
      useTopologyStore.setState({ nodes, edges, subsystemGroups: [group], past: [], future: [] });

      const positionsBefore = nodes.map((n) => ({ id: n.id, pos: { ...n.position } }));
      useTopologyStore.getState().deleteGroup('g1');

      expect(useTopologyStore.getState().subsystemGroups).toHaveLength(0);
      expect(useTopologyStore.getState().nodes).toHaveLength(2);
      expect(useTopologyStore.getState().edges).toHaveLength(1);
      for (const { id, pos } of positionsBefore) {
        const node = useTopologyStore.getState().nodes.find((n) => n.id === id);
        expect(node!.position).toEqual(pos);
      }
    });

    it('removeNodesFromGroup retains nodes at positions', () => {
      const nodes = [createTestNode('a'), createTestNode('b'), createTestNode('c')];
      const edges = [createTestEdge('e1', 'a', 'b')];
      const group: SubsystemGroup = { id: 'g1', name: 'G', memberNodeIds: ['a', 'b', 'c'], collapsed: true };
      useTopologyStore.setState({ nodes, edges, subsystemGroups: [group], past: [], future: [] });

      useTopologyStore.getState().removeNodesFromGroup('g1', ['a']);
      expect(useTopologyStore.getState().subsystemGroups[0].memberNodeIds).toEqual(['b', 'c']);
      expect(useTopologyStore.getState().nodes).toHaveLength(3);
      expect(useTopologyStore.getState().edges).toHaveLength(1);
    });

    it('dragGroup moves all member positions by displacement', () => {
      const nodes = [
        { ...createTestNode('a'), position: { x: 100, y: 100 } },
        { ...createTestNode('b'), position: { x: 200, y: 200 } },
        { ...createTestNode('c'), position: { x: 300, y: 300 } },
      ] as AnalysysNode[];
      const group: SubsystemGroup = { id: 'g1', name: 'G', memberNodeIds: ['a', 'b'], collapsed: true };
      useTopologyStore.setState({ nodes, edges: [], subsystemGroups: [group], past: [], future: [] });

      useTopologyStore.getState().dragGroup('g1', 50, -30);

      const state = useTopologyStore.getState();
      expect(state.nodes.find((n) => n.id === 'a')!.position).toEqual({ x: 150, y: 70 });
      expect(state.nodes.find((n) => n.id === 'b')!.position).toEqual({ x: 250, y: 170 });
      // Non-member unchanged
      expect(state.nodes.find((n) => n.id === 'c')!.position).toEqual({ x: 300, y: 300 });
    });
  });

  describe('getTopologySnapshot is unchanged (CP-6)', () => {
    it('sends no group information on INIT', () => {
      const nodes = [createTestNode('a'), createTestNode('b')];
      const edges = [createTestEdge('e1', 'a', 'b')];
      const group: SubsystemGroup = { id: 'g1', name: 'G', memberNodeIds: ['a', 'b'], collapsed: true };
      useTopologyStore.setState({ nodes, edges, subsystemGroups: [group], past: [], future: [] });

      const snapshot = useTopologyStore.getState().getTopologySnapshot();
      expect(snapshot).toHaveProperty('nodes');
      expect(snapshot).toHaveProperty('edges');
      expect(Object.keys(snapshot)).toEqual(['nodes', 'edges']);
      expect(snapshot).not.toHaveProperty('subsystemGroups');
      expect(snapshot).not.toHaveProperty('groups');
    });

    it('produces identical snapshots regardless of group state', () => {
      const nodes = [createTestNode('a'), createTestNode('b')];
      const edges = [createTestEdge('e1', 'a', 'b')];

      // Without groups
      useTopologyStore.setState({ nodes, edges, subsystemGroups: [], past: [], future: [] });
      const snap1 = useTopologyStore.getState().getTopologySnapshot();

      // With collapsed group
      const group: SubsystemGroup = { id: 'g1', name: 'G', memberNodeIds: ['a', 'b'], collapsed: true };
      useTopologyStore.setState({ nodes, edges, subsystemGroups: [group], past: [], future: [] });
      const snap2 = useTopologyStore.getState().getTopologySnapshot();

      // With expanded group
      useTopologyStore.setState({
        nodes, edges,
        subsystemGroups: [{ ...group, collapsed: false }],
        past: [], future: [],
      });
      const snap3 = useTopologyStore.getState().getTopologySnapshot();

      expect(snap1).toEqual(snap2);
      expect(snap2).toEqual(snap3);
    });
  });

  describe('Collapsed topology view', () => {
    it('emits SUBSYSTEM_GROUP node at bounding-box centre for collapsed groups', () => {
      const nodes = [
        { ...createTestNode('a'), position: { x: 0, y: 0 } },
        { ...createTestNode('b'), position: { x: 100, y: 100 } },
      ] as AnalysysNode[];
      const group: SubsystemGroup = { id: 'g1', name: 'G', memberNodeIds: ['a', 'b'], collapsed: true };

      const result = computeCollapsedView(nodes, [], [group]);
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].id).toBe('grp:g1');
      expect(result.nodes[0].type).toBe('SUBSYSTEM_GROUP');
      expect(result.nodes[0].position).toEqual({ x: 50, y: 50 });
    });

    it('omits member nodes when collapsed', () => {
      const nodes = [createTestNode('a'), createTestNode('b'), createTestNode('c')];
      const group: SubsystemGroup = { id: 'g1', name: 'G', memberNodeIds: ['a', 'b'], collapsed: true };

      const result = computeCollapsedView(nodes, [], [group]);
      // 'c' is not in the group, plus the group node
      expect(result.nodes).toHaveLength(2);
      expect(result.nodes.find((n) => n.id === 'c')).toBeTruthy();
      expect(result.nodes.find((n) => n.id === 'grp:g1')).toBeTruthy();
    });

    it('omits internal edges (both endpoints in same group)', () => {
      const nodes = [createTestNode('a'), createTestNode('b')];
      const edges = [createTestEdge('e1', 'a', 'b')];
      const group: SubsystemGroup = { id: 'g1', name: 'G', memberNodeIds: ['a', 'b'], collapsed: true };

      const result = computeCollapsedView(nodes, edges, [group]);
      expect(result.edges).toHaveLength(0);
    });

    it('merges boundary edges sharing group, external node, and direction', () => {
      const nodes = [createTestNode('a'), createTestNode('b'), createTestNode('ext')];
      const edges = [
        createTestEdge('e1', 'a', 'ext'),
        createTestEdge('e2', 'b', 'ext'),
      ];
      const group: SubsystemGroup = { id: 'g1', name: 'G', memberNodeIds: ['a', 'b'], collapsed: true };

      const result = computeCollapsedView(nodes, edges, [group]);
      // Should be one merged edge
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].id).toBe('grp:g1:out:ext');
      const data = result.edges[0].data as unknown as { underlyingCount: number };
      expect(data.underlyingCount).toBe(2);
    });

    it('returns original topology when no groups are collapsed', () => {
      const nodes = [createTestNode('a'), createTestNode('b')];
      const edges = [createTestEdge('e1', 'a', 'b')];
      const group: SubsystemGroup = { id: 'g1', name: 'G', memberNodeIds: ['a', 'b'], collapsed: false };

      const result = computeCollapsedView(nodes, edges, [group]);
      expect(result.nodes).toBe(nodes);
      expect(result.edges).toBe(edges);
    });
  });

  describe('Group validation', () => {
    it('validateGroupName rejects empty name', () => {
      expect(validateGroupName('  ', [])).toContain('empty');
    });

    it('validateGroupName rejects over 40 chars', () => {
      expect(validateGroupName('a'.repeat(41), [])).toContain('40');
    });

    it('validateGroupName rejects case-insensitive duplicate', () => {
      const groups: SubsystemGroup[] = [{ id: 'g1', name: 'Backend', memberNodeIds: ['a', 'b'], collapsed: false }];
      expect(validateGroupName('BACKEND', groups)).toContain('conflicts');
    });

    it('validateGroupName allows same group to keep its own name', () => {
      const groups: SubsystemGroup[] = [{ id: 'g1', name: 'Backend', memberNodeIds: ['a', 'b'], collapsed: false }];
      expect(validateGroupName('Backend', groups, 'g1')).toBeNull();
    });

    it('validateGroupCreation rejects fewer than 2 nodes', () => {
      const result = validateGroupCreation(['a'], [], new Map());
      expect(result!.constraint).toContain('at least 2');
    });

    it('validateGroupCreation rejects more than 50 nodes', () => {
      const ids = Array.from({ length: 51 }, (_, i) => `n${i}`);
      const result = validateGroupCreation(ids, [], new Map());
      expect(result!.constraint).toContain('50');
    });
  });

  describe('Import normalisation', () => {
    it('truncates name past 40 characters', () => {
      const groups: SubsystemGroup[] = [{
        id: 'g1', name: 'a'.repeat(50), memberNodeIds: ['a', 'b'], collapsed: false,
      }];
      const { groups: result, warnings } = normaliseImportedGroups(groups, new Set(['a', 'b']));
      expect(result[0].name.length).toBe(40);
      expect(warnings.some((w) => w.violation.includes('exceeds'))).toBe(true);
    });

    it('suffixes duplicate names', () => {
      const groups: SubsystemGroup[] = [
        { id: 'g1', name: 'API', memberNodeIds: ['a', 'b'], collapsed: false },
        { id: 'g2', name: 'API', memberNodeIds: ['c', 'd'], collapsed: false },
      ];
      const { groups: result } = normaliseImportedGroups(groups, new Set(['a', 'b', 'c', 'd']));
      expect(result[0].name).toBe('API');
      expect(result[1].name).toBe('API 2');
    });

    it('drops absent member identifiers', () => {
      const groups: SubsystemGroup[] = [{
        id: 'g1', name: 'G', memberNodeIds: ['a', 'b', 'missing'], collapsed: false,
      }];
      const { groups: result, warnings } = normaliseImportedGroups(groups, new Set(['a', 'b']));
      expect(result[0].memberNodeIds).toEqual(['a', 'b']);
      expect(warnings.some((w) => w.violation.includes('absent'))).toBe(true);
    });

    it('drops group with fewer than 2 valid members', () => {
      const groups: SubsystemGroup[] = [{
        id: 'g1', name: 'G', memberNodeIds: ['a', 'missing1', 'missing2'], collapsed: false,
      }];
      const { groups: result, warnings } = normaliseImportedGroups(groups, new Set(['a']));
      expect(result).toHaveLength(0);
      expect(warnings.some((w) => w.appliedChange === 'Dropped group')).toBe(true);
    });

    it('keeps first 50 members in stored order', () => {
      const ids = Array.from({ length: 60 }, (_, i) => `n${i}`);
      const groups: SubsystemGroup[] = [{ id: 'g1', name: 'G', memberNodeIds: ids, collapsed: false }];
      const { groups: result } = normaliseImportedGroups(groups, new Set(ids));
      expect(result[0].memberNodeIds).toHaveLength(50);
      expect(result[0].memberNodeIds[0]).toBe('n0');
      expect(result[0].memberNodeIds[49]).toBe('n49');
    });

    it('drops duplicate member identifiers', () => {
      const groups: SubsystemGroup[] = [{
        id: 'g1', name: 'G', memberNodeIds: ['a', 'a', 'b', 'b'], collapsed: false,
      }];
      const { groups: result } = normaliseImportedGroups(groups, new Set(['a', 'b']));
      expect(result[0].memberNodeIds).toEqual(['a', 'b']);
    });

    it('enforces disjoint membership across groups during import', () => {
      const groups: SubsystemGroup[] = [
        { id: 'g1', name: 'G1', memberNodeIds: ['a', 'b'], collapsed: false },
        { id: 'g2', name: 'G2', memberNodeIds: ['b', 'c'], collapsed: false },
      ];
      const { groups: result, warnings } = normaliseImportedGroups(groups, new Set(['a', 'b', 'c']));
      // 'b' should be dropped from second group since it's already in first
      expect(result[0].memberNodeIds).toContain('b');
      // Second group might be dropped (only 'c' left = 1 member)
      if (result.length > 1) {
        expect(result[1].memberNodeIds).not.toContain('b');
      } else {
        // group dropped since < 2 members
        expect(warnings.some((w) => w.appliedChange === 'Dropped group')).toBe(true);
      }
    });
  });
});
