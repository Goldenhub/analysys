// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import App from '@/App';
import { useTopologyStore } from '@/store/topologyStore';
import { useSimulationStore } from '@/store/simulationStore';
import { NodeType } from '@/types/nodes';
import { createDefaultNodeData } from '@/types/nodeDefaults';
import { createTextNoteNode } from '@/canvas';
import type { CanvasNode } from '@/canvas/types';
import type { EdgeData } from '@/types/edges';
import type { MetricsBatchPayload } from '@/types/metrics';
import type { SimEventLogEntry } from '@/types/messages';

// React Flow + time-series charts observe their containers; jsdom ships no ResizeObserver.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', NoopResizeObserver);

// CanvasEngine calls setPointerCapture on pointer-down; jsdom doesn't implement it.
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};

/** A ready-to-render React Flow node for use on the canvas layer. */
function rfNode(id: string, nodeType: NodeType, parentNodeId: string | null, label: string): CanvasNode {
  const data = createDefaultNodeData(nodeType, { x: 120, y: 120 });
  data.id = id;
  data.label = label;
  data.parentNodeId = parentNodeId;
  return { id, type: nodeType, position: { x: 120, y: 120 }, data };
}

/** Seed a v4 bundle under the autosave key to emulate a previous session. */
function seedAutosave(nodes: CanvasNode[], edges: EdgeData[]) {
  const payload = {
    schemaVersion: 4,
    nodes: nodes.map((n) => ({ ...n.data, position: n.position })),
    edges,
    settings: { durationMs: 60_000, speedMultiplier: 1, seed: 7 },
  };
  localStorage.setItem('analysys_autosave', JSON.stringify(payload));
}

describe('Onboarding tour', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    useTopologyStore.setState({ nodes: [], edges: [], past: [], future: [] });
  });

  const tourTitles = [
    'Welcome to Analysys',
    'Get help anytime',
    'Start from a reference',
    'Run the simulation',
    'Save & export',
    'Build your architecture',
    'Shape the canvas',
    'Test resilience',
    'Watch it live',
  ];

  it('shows the tour on first visit and walks through every step', () => {
    render(<App />);

    expect(screen.getByRole('dialog', { name: 'Onboarding tour' })).toBeDefined();

    for (let i = 0; i < tourTitles.length; i++) {
      expect(screen.getByText(tourTitles[i])).toBeDefined();
      expect(screen.getByText(`${i + 1} of ${tourTitles.length}`)).toBeDefined();
      if (i < tourTitles.length - 1) {
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      }
    }

    expect(screen.getByRole('button', { name: 'Done' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(screen.queryByRole('dialog', { name: 'Onboarding tour' })).toBeNull();
    expect(localStorage.getItem('analysys_onboarding_completed')).toBe('true');
  }, 10000);

  it('does not show the tour once completed', () => {
    localStorage.setItem('analysys_onboarding_completed', 'true');

    render(<App />);

    expect(screen.queryByRole('dialog', { name: 'Onboarding tour' })).toBeNull();
  });

  it('skip dismisses the tour and records completion', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));

    expect(screen.queryByRole('dialog', { name: 'Onboarding tour' })).toBeNull();
    expect(localStorage.getItem('analysys_onboarding_completed')).toBe('true');
  });

  it('Escape dismisses the tour and records completion', () => {
    render(<App />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Onboarding tour' })).toBeNull();
    expect(localStorage.getItem('analysys_onboarding_completed')).toBe('true');
  });

  it('navigates steps with the arrow keys', () => {
    render(<App />);

    expect(screen.getByText('1 of 9')).toBeDefined();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText('2 of 9')).toBeDefined();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByText('1 of 9')).toBeDefined();
  });

  it('replays the tour from the help modal', () => {
    localStorage.setItem('analysys_onboarding_completed', 'true');

    render(<App />);

    expect(screen.queryByRole('dialog', { name: 'Onboarding tour' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /how to use analysys/i }));
    fireEvent.click(screen.getByRole('button', { name: /restart the onboarding tour/i }));

    expect(screen.getByRole('dialog', { name: 'Onboarding tour' })).toBeDefined();
    expect(localStorage.getItem('analysys_onboarding_completed')).toBeNull();
  });
});

describe('Application shell', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    useTopologyStore.setState({ nodes: [], edges: [], past: [], future: [] });
  });

  it('boots straight into the simulation workspace', () => {
    render(<App />);

    expect(screen.getByText('Analysys')).toBeDefined();
    expect(screen.getByText('Components')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Presets' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Export' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Import' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Load' })).toBeDefined();
  });

  it('opens the how-to modal from the header', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /how to use analysys/i }));
    expect(screen.getByRole('dialog', { name: /how to use analysys/i })).toBeDefined();
  });

  it('restores the autosaved working canvas on boot', () => {
    const edgeAi = rfNode('edge-ai', NodeType.AppServer, null, 'Edge AI');
    seedAutosave([edgeAi], []);

    render(<App />);

    expect(screen.getByText('Edge AI')).toBeDefined();
  });

  it('boots clean when there is no autosaved session', () => {
    render(<App />);
    expect(screen.getByText(/system overview|Components/)).toBeDefined();
  });

  it('drills into a component via the node affordance and shows its children', () => {
    useTopologyStore.setState({
      nodes: [
        rfNode('web-tier', NodeType.AppServer, null, 'Web Tier'),
        rfNode('app-1', NodeType.AppServer, 'web-tier', 'App-1'),
      ],
      edges: [],
      past: [],
      future: [],
    });

    render(<App />);

    const affordance = screen.getByRole('button', { name: 'Open component Web Tier' });
    expect(affordance.textContent).toContain('1');

    fireEvent.click(affordance);
    expect(screen.getByText('App-1')).toBeDefined();
    expect(screen.getByText('Web Tier')).toBeDefined();
  });

  it('shows an empty-state hint when drilling into an empty component', () => {
    useTopologyStore.setState({
      nodes: [rfNode('web-tier', NodeType.AppServer, null, 'Web Tier')],
      edges: [],
      past: [],
      future: [],
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open component Web Tier' }));
    expect(screen.getByText(/this component layer is empty/i)).toBeDefined();
  });

  it('opens the details panel and selects the node on a single click', () => {
    useTopologyStore.setState({
      nodes: [rfNode('app-1', NodeType.AppServer, null, 'App-1')],
      edges: [],
      past: [],
      future: [],
    });

    render(<App />);
    const chip = screen.getByRole('button', { name: 'Open component App-1' });
    const frameContent = chip.parentElement!.querySelector('div') ?? chip.parentElement!;
    fireEvent.pointerDown(frameContent);
    fireEvent.pointerUp(frameContent);

    expect(screen.getByLabelText('Node configuration panel')).toBeDefined();
    expect(useTopologyStore.getState().nodes[0].selected).toBe(true);
  });

  it('repositions a node on drag without opening the details panel', () => {
    useTopologyStore.setState({
      nodes: [rfNode('app-1', NodeType.AppServer, null, 'App-1')],
      edges: [],
      past: [],
      future: [],
    });

    render(<App />);
    const chip = screen.getByRole('button', { name: 'Open component App-1' });
    const frameContent = chip.parentElement!.querySelector('div') ?? chip.parentElement!;
    fireEvent.pointerDown(frameContent, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(frameContent, { clientX: 180, clientY: 140 });
    fireEvent.pointerUp(frameContent, { clientX: 180, clientY: 140 });

    expect(screen.queryByLabelText('Node configuration panel')).toBeNull();
    expect(useTopologyStore.getState().nodes[0].position.x).not.toBe(120);
    expect(useTopologyStore.getState().nodes[0].position.y).not.toBe(120);
  });

  it('opens the details panel from the node context menu', () => {
    useTopologyStore.setState({
      nodes: [rfNode('app-1', NodeType.AppServer, null, 'App-1')],
      edges: [],
      past: [],
      future: [],
    });

    render(<App />);
    const chip = screen.getByRole('button', { name: 'Open component App-1' });
    fireEvent.contextMenu(chip.parentElement!, { clientX: 200, clientY: 150 });

    const menu = screen.getByRole('menu', { name: 'Node menu' });
    expect(menu).toBeDefined();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Details' }));
    expect(screen.getByLabelText('Node configuration panel')).toBeDefined();
  });

  it('deletes a node from the context menu', () => {
    useTopologyStore.setState({
      nodes: [rfNode('app-1', NodeType.AppServer, null, 'App-1')],
      edges: [],
      past: [],
      future: [],
    });

    render(<App />);
    const chip = screen.getByRole('button', { name: 'Open component App-1' });
    fireEvent.contextMenu(chip.parentElement!, { clientX: 200, clientY: 150 });

    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(useTopologyStore.getState().nodes).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Open component App-1' })).toBeNull();
  });

  it('dismisses the context menu on a background click', () => {
    useTopologyStore.setState({
      nodes: [rfNode('app-1', NodeType.AppServer, null, 'App-1')],
      edges: [],
      past: [],
      future: [],
    });

    const { container } = render(<App />);
    const chip = screen.getByRole('button', { name: 'Open component App-1' });
    fireEvent.contextMenu(chip.parentElement!, { clientX: 200, clientY: 150 });
    expect(screen.getByRole('menu', { name: 'Node menu' })).toBeDefined();

    fireEvent.pointerDown(container.querySelector('[data-testid="canvas-engine"] svg')!, { button: 0 });
    expect(screen.queryByRole('menu', { name: 'Node menu' })).toBeNull();
  });

  it('deselects nodes and closes the panel when the canvas background is clicked', () => {
    useTopologyStore.setState({
      nodes: [rfNode('app-1', NodeType.AppServer, null, 'App-1')],
      edges: [],
      past: [],
      future: [],
    });

    const { container } = render(<App />);
    const chip = screen.getByRole('button', { name: 'Open component App-1' });
    const frame = chip.parentElement!;
    fireEvent.pointerDown(frame.querySelector('div') ?? frame);
    fireEvent.contextMenu(frame, { clientX: 200, clientY: 150 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Details' }));
    expect(screen.getByLabelText('Node configuration panel')).toBeDefined();

    const selectedBefore = useTopologyStore.getState().nodes[0].selected;
    expect(selectedBefore).toBe(true);

    const canvasSvg = container.querySelector('[data-testid="canvas-engine"] svg')!;
    expect(canvasSvg).toBeDefined();
    fireEvent.pointerDown(canvasSvg, { button: 0 });
    expect(useTopologyStore.getState().nodes[0].selected).toBe(false);
    expect(screen.queryByLabelText('Node configuration panel')).toBeNull();
  });

  it('moves the selection ring to the most recently clicked node', () => {
    useTopologyStore.setState({
      nodes: [
        rfNode('web-tier', NodeType.AppServer, null, 'Web Tier'),
        rfNode('app-1', NodeType.AppServer, null, 'App-1'),
      ],
      edges: [],
      past: [],
      future: [],
    });

    render(<App />);

    const clickNode = (name: string) => {
      const chip = screen.getByRole('button', { name: `Open component ${name}` });
      fireEvent.pointerDown(chip.parentElement!.querySelector('div') ?? chip.parentElement!);
    };

    clickNode('Web Tier');
    const afterFirst = useTopologyStore.getState().nodes.map((n) => n.selected);
    expect(afterFirst).toEqual([true, false]);

    clickNode('App-1');
    const afterSecond = useTopologyStore.getState().nodes.map((n) => n.selected);
    expect(afterSecond).toEqual([false, true]);
  });

  it('only service nodes expose the component-layer affordance', () => {
    useTopologyStore.setState({
      nodes: [
        rfNode('svc-1', NodeType.AppServer, null, 'Svc-1'),
        rfNode('db-1', NodeType.Database, null, 'Db-1'),
      ],
      edges: [],
      past: [],
      future: [],
    });

    render(<App />);

    expect(screen.getByRole('button', { name: 'Open component Svc-1' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Open component Db-1' })).toBeNull();
  });

  it('clears every node and edge from the canvas', () => {
    useTopologyStore.setState({
      nodes: [
        rfNode('app-1', NodeType.AppServer, null, 'App-1'),
        rfNode('db-1', NodeType.Database, null, 'Db-1'),
      ],
      edges: [],
      past: [],
      future: [],
    });

    render(<App />);

    expect(screen.getByRole('button', { name: 'Open component App-1' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Clear canvas' }));

    expect(useTopologyStore.getState().nodes).toHaveLength(0);
    expect(useTopologyStore.getState().edges).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Open component App-1' })).toBeNull();
  });

  it('restores the canvas after clearing via undo', () => {
    useTopologyStore.setState({
      nodes: [rfNode('app-1', NodeType.AppServer, null, 'App-1')],
      edges: [],
      past: [],
      future: [],
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear canvas' }));
    expect(useTopologyStore.getState().nodes).toHaveLength(0);

    useTopologyStore.getState().undo();
    expect(useTopologyStore.getState().nodes).toHaveLength(1);
    expect(useTopologyStore.getState().nodes[0].id).toBe('app-1');
  });

  it('shows a resizable border when a text note is selected or focused', () => {
    const note = createTextNoteNode({ x: 120, y: 120 }, 'Meeting notes');
    useTopologyStore.setState({ nodes: [note], edges: [], past: [], future: [] });

    render(<App />);

    const noteEl = screen.getByLabelText('Text note');
    expect(screen.queryByRole('slider', { name: 'Resize note' })).toBeNull();
    expect(noteEl.className).toContain('border-transparent');

    // Focus alone (typing into the note) reveals the border, resize handle, and
    // color palette without selecting the node.
    fireEvent.focus(screen.getByLabelText('Note text'));
    expect(screen.getByLabelText('Text note').className).toContain('border-[#b8402e]/70');
    expect(useTopologyStore.getState().nodes[0].selected).toBe(false);
    expect(screen.getByRole('slider', { name: 'Resize note' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Note color #b8402e' })).toBeDefined();

    // Clicking a swatch while focused keeps focus and restyles without selection.
    fireEvent.click(screen.getByRole('button', { name: 'Note color #b8402e' }));
    expect(useTopologyStore.getState().nodes[0].data.color).toBe('#b8402e');
    expect(useTopologyStore.getState().nodes[0].selected).toBe(false);

    fireEvent.blur(screen.getByLabelText('Note text'));
    expect(screen.getByLabelText('Text note').className).toContain('border-transparent');
    expect(screen.queryByRole('slider', { name: 'Resize note' })).toBeNull();

    fireEvent.pointerDown(noteEl);
    fireEvent.pointerUp(noteEl);

    expect(screen.getByLabelText('Text note').className).toContain('border-[#b8402e]/70');
    const handle = screen.getByRole('slider', { name: 'Resize note' });

    fireEvent.pointerDown(handle, { clientX: 200, clientY: 150 });
    fireEvent.pointerMove(handle, { clientX: 260, clientY: 190 });
    fireEvent.pointerUp(handle);

    const resized = useTopologyStore.getState().nodes[0];
    expect(resized.width).toBe(240);
    expect(resized.height).toBe(160);
  });

  it('clearing the canvas also clears the telemetry dashboard', () => {
    useTopologyStore.setState({
      nodes: [rfNode('app-1', NodeType.AppServer, null, 'App-1')],
      edges: [],
      past: [],
      future: [],
    });
    const metrics: MetricsBatchPayload = {
      simulatedTimeMs: 1000,
      nodes: [],
      systemWide: {
        totalThroughput: 100,
        endToEndLatency: { p50: 10, p90: 50, p99: 100 },
        totalErrorRate: 0.01,
        activeRequests: 5,
      },
    };
    const logEntry: SimEventLogEntry = {
      id: 1,
      timestamp: 100,
      type: 'REQUEST_ARRIVAL',
      nodeId: 'app-1',
      message: 'Request arrived',
    };
    useSimulationStore.setState({ metrics, eventLog: [logEntry] });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear canvas' }));

    expect(useTopologyStore.getState().nodes).toHaveLength(0);
    expect(useSimulationStore.getState().metrics).toBeNull();
    expect(useSimulationStore.getState().eventLog).toEqual([]);
  });
});