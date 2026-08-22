import { describe, it, expect } from 'vitest';
import { createDefaultNodeData } from './nodeDefaults';
import { NodeType, RoutingPolicy } from './nodes';
import { validateNodeConfig } from '@/validation/configValidation';

// ─── Fixtures ────────────────────────────────────────────────────

const ALL_NODE_TYPES = Object.values(NodeType);

// ─── Every type has a default ────────────────────────────────────

describe('createDefaultNodeData', () => {
  it('covers all fifteen node types', () => {
    expect(ALL_NODE_TYPES).toHaveLength(15);
  });

  it('returns a node of the requested type at the requested position', () => {
    for (const nodeType of ALL_NODE_TYPES) {
      const node = createDefaultNodeData(nodeType, { x: 10, y: 20 });

      expect(node.nodeType).toBe(nodeType);
      expect(node.position).toEqual({ x: 10, y: 20 });
      expect(node.label.length).toBeGreaterThan(0);
      expect(node.id.length).toBeGreaterThan(0);
    }
  });

  it('routes with First on placement for every type (R32.1)', () => {
    for (const nodeType of ALL_NODE_TYPES) {
      const node = createDefaultNodeData(nodeType, { x: 0, y: 0 });
      expect(node.routingPolicy).toBe(RoutingPolicy.First);
    }
  });

  it('gives each node a distinct identifier', () => {
    const ids = ALL_NODE_TYPES.map((t) => createDefaultNodeData(t, { x: 0, y: 0 }).id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─── Every default passes validation ─────────────────────────────

describe('createDefaultNodeData validity', () => {
  it('produces a configuration that passes validateNodeConfig for all fifteen types (R29.3)', () => {
    for (const nodeType of ALL_NODE_TYPES) {
      const node = createDefaultNodeData(nodeType, { x: 0, y: 0 });
      const result = validateNodeConfig(node);

      expect(result.errors, `${nodeType} defaults are out of range`).toEqual([]);
      expect(result.valid, `${nodeType} defaults should be valid`).toBe(true);
    }
  });

  it.each(ALL_NODE_TYPES)('%s default config is within validator bounds', (nodeType) => {
    const node = createDefaultNodeData(nodeType, { x: 5, y: 5 });
    const { valid, errors } = validateNodeConfig(node);

    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });
});

// ─── Canvas drop handler and palette keyboard path share createDefaultNodeData ───

describe('placement path convergence (no-drift guarantee)', () => {
  /**
   * Both the canvas drop handler (CanvasEditor.onDrop) and the palette keyboard
   * placement path (NodePalette placeAtCenter) call createDefaultNodeData as their
   * single source of truth for node defaults. This is verified at the integration
   * level in src/components/canvas/nodePlacement.test.tsx, which renders both
   * components and asserts their placed nodes match createDefaultNodeData output.
   *
   * This test confirms the structural guarantee: createDefaultNodeData is
   * exhaustive over all NodeType members, so neither path can produce a node type
   * without a matching default.
   */
  it('createDefaultNodeData is exhaustive — every NodeType value produces a result', () => {
    for (const nodeType of ALL_NODE_TYPES) {
      const node = createDefaultNodeData(nodeType, { x: 0, y: 0 });

      // If the switch were missing a case, TypeScript would error at compile time,
      // but at runtime we'd get undefined. Guard against that.
      expect(node).toBeDefined();
      expect(node.nodeType).toBe(nodeType);
      expect(node.config).toBeDefined();
    }
  });
});
