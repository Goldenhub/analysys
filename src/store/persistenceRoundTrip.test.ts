import { describe, it, expect, beforeEach } from 'vitest';
import { usePersistenceStore } from './persistenceStore';
import { useTopologyStore } from './topologyStore';
import { useSimulationStore } from './simulationStore';
import { NodeType, RoutingPolicy, Distribution } from '@/types/nodes';
import { EdgeProtocol } from '@/types/edges';
import type { CanvasNode, SectionNodeData } from '@/canvas/types';
import { SECTION_NODE_TYPE } from '@/canvas/types';

// ─── Helpers ─────────────────────────────────────────────────────

function genNode(id: string, position: { x: number; y: number }): CanvasNode {
  return {
    id,
    type: NodeType.TrafficGenerator,
    position,
    data: {
      id,
      nodeType: NodeType.TrafficGenerator,
      label: `Traffic ${id}`,
      position,
      routingPolicy: RoutingPolicy.First,
      config: {
        rps: 100,
        distribution: Distribution.Poisson,
        spikeMultiplier: 1,
        spikeDurationSec: 10,
      },
    },
  } as CanvasNode;
}

function appNode(id: string, position: { x: number; y: number }): CanvasNode {
  return {
    id,
    type: NodeType.AppServer,
    position,
    data: {
      id,
      nodeType: NodeType.AppServer,
      label: `App ${id}`,
      position,
      routingPolicy: RoutingPolicy.First,
      config: {
        workerThreadPoolSize: 8,
        requestQueueDepth: 100,
        processingTimeMeanMs: 40,
        processingTimeStdDevMs: 10,
      },
    },
  } as CanvasNode;
}

function sectionNode(id: string, position: { x: number; y: number }, w: number, h: number): CanvasNode {
  const data: SectionNodeData = {
    kind: 'section',
    id,
    label: 'Section',
    position,
    width: w,
    height: h,
  };
  return { id, type: SECTION_NODE_TYPE, position, width: w, height: h, data } as CanvasNode;
}

// ─── Tests ───────────────────────────────────────────────────────

describe('persistence round-trip fidelity (live canvas → save/load)', () => {
  beforeEach(() => {
    localStorage.clear();
    useTopologyStore.setState({ nodes: [], edges: [], past: [], future: [] });
  });

  it('keeps a dragged node position in the saved file and restores it on load', () => {
    useTopologyStore.setState({
      nodes: [genNode('n1', { x: 10, y: 20 })],
      edges: [],
      past: [],
      future: [],
    });

    // User drags the node on the canvas — engine emits a position change.
    useTopologyStore
      .getState()
      .onNodesChange([{ type: 'position', id: 'n1', position: { x: 420, y: 330 } }]);

    usePersistenceStore.getState().saveTopology('t');
    const entry = usePersistenceStore.getState().savedTopologies.find((e) => e.name === 't')!;
    const saved = JSON.parse(entry.data) as { nodes: Array<{ id: string; position: { x: number; y: number } }> };
    expect(saved.nodes[0].position).toEqual({ x: 420, y: 330 });

    usePersistenceStore.getState().loadSavedTopology('t');
    const { nodes } = useTopologyStore.getState();
    expect(nodes[0].position).toEqual({ x: 420, y: 330 });
  });

  it('persists a resized section box through save and load', () => {
    useTopologyStore.setState({
      nodes: [sectionNode('sec-1', { x: 0, y: 0 }, 200, 120)],
      edges: [],
      past: [],
      future: [],
    });

    useTopologyStore.getState().onNodesChange([
      { type: 'dimensions', id: 'sec-1', dimensions: { width: 460, height: 80 } },
    ]);

    usePersistenceStore.getState().saveTopology('t');
    const entry = usePersistenceStore.getState().savedTopologies.find((e) => e.name === 't')!;
    const saved = JSON.parse(entry.data) as {
      nodes: Array<{ id: string; kind: string; width: number; height: number }>;
    };
    expect(saved.nodes[0].kind).toBe('section');
    expect(saved.nodes[0].width).toBe(460);
    expect(saved.nodes[0].height).toBe(80);

    usePersistenceStore.getState().loadSavedTopology('t');
    const { nodes } = useTopologyStore.getState();
    const loaded = nodes[0];
    expect(loaded.width).toBe(460);
    expect(loaded.height).toBe(80);
    const dta = loaded.data as { width?: number; height?: number };
    expect(dta.width).toBe(460);
    expect(dta.height).toBe(80);
  });

  it('preserves nodes and connections exactly through save and load', () => {
    useTopologyStore.setState({
      nodes: [
        genNode('gen', { x: 10, y: 20 }),
        genNode('app', { x: 300, y: 60 }),
        sectionNode('box', { x: 0, y: 0 }, 500, 140),
      ],
      edges: [
        {
          id: 'e1',
          source: 'gen',
          target: 'app',
          type: EdgeProtocol.Sync,
          data: { id: 'e1', source: 'gen', target: 'app', protocol: EdgeProtocol.Sync, weight: 1 },
        },
        {
          id: 'e2',
          source: 'gen',
          target: 'app',
          type: EdgeProtocol.Async,
          data: { id: 'e2', source: 'gen', target: 'app', protocol: EdgeProtocol.Async, weight: 0.5 },
        },
      ],
      past: [],
      future: [],
    });

    usePersistenceStore.getState().saveTopology('t');
    usePersistenceStore.getState().loadSavedTopology('t');

    const { nodes, edges } = useTopologyStore.getState();
    expect(nodes).toHaveLength(3);
    expect(nodes.map((n) => n.id).sort()).toEqual(['app', 'box', 'gen']);
    expect(nodes.find((n) => n.id === 'box')!.type).toBe(SECTION_NODE_TYPE);

    expect(edges.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(edges.map((e) => e.data.protocol)).toEqual([EdgeProtocol.Sync, EdgeProtocol.Async]);
    expect(edges.map((e) => e.data.weight)).toEqual([1, 0.5]);
  });

  it('autosaves and restores the working canvas + run settings across a reload', () => {
    useTopologyStore.setState({
      nodes: [genNode('gen', { x: 10, y: 20 }), appNode('app', { x: 300, y: 60 }), sectionNode('box', { x: 0, y: 0 }, 500, 140)],
      edges: [
        {
          id: 'e1',
          source: 'gen',
          target: 'app',
          type: EdgeProtocol.Sync,
          data: { id: 'e1', source: 'gen', target: 'app', protocol: EdgeProtocol.Sync, weight: 1 },
        },
      ],
      past: [],
      future: [],
    });
    useSimulationStore.getState().setDuration(90_000);
    useSimulationStore.getState().setSpeed(3);
    useSimulationStore.getState().setSeed(4242);

    // The user drags the generator before reloading.
    useTopologyStore
      .getState()
      .onNodesChange([{ type: 'position', id: 'gen', position: { x: 200, y: 150 } }]);

    usePersistenceStore.getState().autosave();
    expect(localStorage.getItem('analysys_autosave')).toBeTruthy();

    // ── Simulate a reload: everything resets to a fresh boot ──
    useTopologyStore.setState({ nodes: [], edges: [], past: [], future: [] });
    useSimulationStore.getState().setDuration(120_000);
    useSimulationStore.getState().setSpeed(1);
    useSimulationStore.getState().setSeed(1);

    expect(usePersistenceStore.getState().restoreAutosave()).toBe(true);

    const { nodes, edges } = useTopologyStore.getState();
    expect(nodes.map((n) => n.id).sort()).toEqual(['app', 'box', 'gen']);
    expect(nodes.find((n) => n.id === 'gen')!.position).toEqual({ x: 200, y: 150 });
    const box = nodes.find((n) => n.id === 'box')!;
    expect(box.width).toBe(500);
    expect(box.height).toBe(140);
    expect(edges.map((e) => e.id)).toEqual(['e1']);
    expect(edges[0].data.protocol).toBe(EdgeProtocol.Sync);

    const sim = useSimulationStore.getState();
    expect(sim.durationMs).toBe(90_000);
    expect(sim.speedMultiplier).toBe(3);
    expect(sim.seed).toBe(4242);
  });

  it('returns false and boots clean when there is no autosave', () => {
    expect(usePersistenceStore.getState().restoreAutosave()).toBe(false);
  });

  it('discards a corrupted autosave and boots clean', () => {
    localStorage.setItem('analysys_autosave', 'not json {');
    expect(usePersistenceStore.getState().restoreAutosave()).toBe(false);
    expect(localStorage.getItem('analysys_autosave')).toBeNull();
  });

  it('clearAutosave removes the stored session', () => {
    useTopologyStore.setState({ nodes: [genNode('gen', { x: 1, y: 2 })], edges: [], past: [], future: [] });
    usePersistenceStore.getState().autosave();
    expect(localStorage.getItem('analysys_autosave')).toBeTruthy();
    usePersistenceStore.getState().clearAutosave();
    expect(localStorage.getItem('analysys_autosave')).toBeNull();
  });
});