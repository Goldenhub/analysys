import { NodeType } from '@/types/nodes';

// ─── Composite / container eligibility ────────────────────────────
//
// A node is either atomic (its own processor handles requests) or composite
// (it has children on its component layer, and the children handle requests).
// The role switch is driven purely by the presence of children — a parent node
// with children is a boundary: requests pass straight through to its internals
// and its own processing settings are bypassed.
//
// Only component-like nodes that genuinely encapsulate logic may own a layer.
// Pure data-plane primitives (queues, caches, databases, object stores) and the
// traffic generator (the load source itself) cannot be parents.

export const PARENTABLE_NODE_TYPES: ReadonlySet<NodeType> = new Set([
  NodeType.ApiGateway,
  NodeType.AppServer,
  NodeType.WorkerPool,
  NodeType.AuthService,
  NodeType.AuthzService,
]);

/** Whether a node of this type may own a component layer (be a container). */
export function canBeParent(nodeType: NodeType): boolean {
  return PARENTABLE_NODE_TYPES.has(nodeType);
}