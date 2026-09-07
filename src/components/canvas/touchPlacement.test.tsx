// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { NodePalette } from './NodePalette';
import { useTopologyStore } from '@/store/topologyStore';

let canvasEl: HTMLDivElement;

beforeEach(() => {
  // Provide the real canvas-engine marker + svg that the palette's drop path
  // resolves against (jsdom has no layout, so elementFromPoint/getBoundingClientRect
  // are stubbed to this container).
  canvasEl = document.createElement('div');
  canvasEl.setAttribute('data-testid', 'canvas-engine');
  canvasEl.appendChild(document.createElement('svg'));
  document.body.appendChild(canvasEl);

  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: () => canvasEl,
  });
});

afterEach(() => {
  cleanup();
  canvasEl.remove();
  useTopologyStore.setState({ nodes: [], edges: [], past: [], future: [] });
});

describe('touch placement', () => {
  it('places a node where a touch swipe-drag is released over the canvas', () => {
    render(<NodePalette parentNodeId={null} />);
    const item = screen.getByRole('button', { name: /Add App Server node/ });

    fireEvent.pointerDown(item, { pointerType: 'touch', pointerId: 1, clientX: 10, clientY: 20 });
    // Rightward swipe past the pickup threshold lifts the node into a ghost.
    fireEvent.pointerMove(document.body, {
      pointerType: 'touch',
      pointerId: 1,
      clientX: 60,
      clientY: 20,
    });
    expect(document.body.querySelector('[role="status"]')).not.toBeNull();

    fireEvent.pointerMove(document.body, {
      pointerType: 'touch',
      pointerId: 1,
      clientX: 300,
      clientY: 200,
    });
    fireEvent.pointerUp(document.body, {
      pointerType: 'touch',
      pointerId: 1,
      clientX: 300,
      clientY: 200,
    });

    // Ghost is gone and exactly one node landed at the drop point.
    expect(document.body.querySelector('[role="status"]')).toBeNull();
    const { nodes } = useTopologyStore.getState();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.position).toEqual({ x: 300, y: 200 });
  });

  it('does not place a node when released somewhere that is not the canvas', () => {
    render(<NodePalette parentNodeId={null} />);
    const item = screen.getByRole('button', { name: /Add API Gateway node/ });

    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => null,
    });

    fireEvent.pointerDown(item, { pointerType: 'touch', pointerId: 2, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(document.body, {
      pointerType: 'touch',
      pointerId: 2,
      clientX: 50,
      clientY: 10,
    });
    fireEvent.pointerUp(document.body, { pointerType: 'touch', pointerId: 2, clientX: 50, clientY: 10 });

    expect(useTopologyStore.getState().nodes).toHaveLength(0);
  });

  it('releases the palette on pointercancel without placing a node', () => {
    render(<NodePalette parentNodeId={null} />);
    const item = screen.getByRole('button', { name: /Add Database node/ });

    fireEvent.pointerDown(item, { pointerType: 'touch', pointerId: 3, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(document.body, {
      pointerType: 'touch',
      pointerId: 3,
      clientX: 60,
      clientY: 10,
    });
    expect(document.body.querySelector('[role="status"]')).not.toBeNull();
    fireEvent.pointerCancel(document.body, { pointerType: 'touch', pointerId: 3, clientX: 60, clientY: 10 });

    expect(document.body.querySelector('[role="status"]')).toBeNull();
    expect(useTopologyStore.getState().nodes).toHaveLength(0);
    expect(document.body.style.touchAction).toBe('');
  });

  it('lets vertical movement scroll instead of picking the node up', () => {
    render(<NodePalette parentNodeId={null} />);
    const item = screen.getByRole('button', { name: /Add Message Queue node/ });

    fireEvent.pointerDown(item, { pointerType: 'touch', pointerId: 4, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(document.body, {
      pointerType: 'touch',
      pointerId: 4,
      clientX: 12,
      clientY: 60,
    });

    expect(document.body.querySelector('[role="status"]')).toBeNull();
  });
});