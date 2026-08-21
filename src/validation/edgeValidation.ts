import { NodeType, type SimulationNode } from '@/types/nodes';
import { EdgeProtocol, type EdgeData } from '@/types/edges';

// ─── Validation Result ───────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

// ─── Connection Compatibility Matrix ─────────────────────────────

export const CONNECTION_RULES: Record<
  NodeType,
  { allowedTargets: NodeType[]; allowedProtocols: EdgeProtocol[] }
> = {
  [NodeType.TrafficGenerator]: {
    allowedTargets: [NodeType.LoadBalancer, NodeType.AppServer, NodeType.MessageQueue],
    allowedProtocols: [EdgeProtocol.Sync, EdgeProtocol.Async],
  },
  [NodeType.LoadBalancer]: {
    allowedTargets: [NodeType.AppServer],
    allowedProtocols: [EdgeProtocol.Sync],
  },
  [NodeType.AppServer]: {
    allowedTargets: [NodeType.Cache, NodeType.Database, NodeType.MessageQueue, NodeType.AppServer],
    allowedProtocols: [EdgeProtocol.Sync, EdgeProtocol.Async],
  },
  [NodeType.Cache]: {
    allowedTargets: [NodeType.Database],
    allowedProtocols: [EdgeProtocol.Sync],
  },
  [NodeType.Database]: {
    allowedTargets: [],
    allowedProtocols: [],
  },
  [NodeType.MessageQueue]: {
    allowedTargets: [NodeType.AppServer],
    allowedProtocols: [EdgeProtocol.Async],
  },
};

// ─── Edge Connection Validator ───────────────────────────────────

/**
 * Validates whether a proposed edge connection is allowed.
 * Called on drag-connect in the canvas and during JSON import.
 */
export function validateEdgeConnection(
  source: SimulationNode,
  target: SimulationNode,
  existingEdges: EdgeData[],
): ValidationResult {
  // Rule 1: No self-referencing edges
  if (source.id === target.id) {
    return { valid: false, reason: 'Self-referencing edges are not allowed.' };
  }

  // Rule 2: No duplicate edges (same source → same target)
  const duplicate = existingEdges.some(
    (e) => e.source === source.id && e.target === target.id,
  );
  if (duplicate) {
    return { valid: false, reason: 'A connection already exists between these nodes.' };
  }

  // Rule 3: Check connection compatibility matrix
  const rules = CONNECTION_RULES[source.nodeType];
  if (!rules.allowedTargets.includes(target.nodeType)) {
    return {
      valid: false,
      reason: `${source.nodeType} cannot connect to ${target.nodeType}.`,
    };
  }

  return { valid: true };
}

// ─── Protocol Lookup ─────────────────────────────────────────────

/**
 * Returns valid protocols for a given source→target connection.
 * Returns an empty array if the connection itself is not allowed.
 */
export function getValidProtocols(
  sourceType: NodeType,
  targetType: NodeType,
): EdgeProtocol[] {
  const rules = CONNECTION_RULES[sourceType];
  if (!rules.allowedTargets.includes(targetType)) {
    return [];
  }
  return rules.allowedProtocols;
}
