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
    allowedTargets: [
      NodeType.ApiGateway,
      NodeType.RateLimiter,
      NodeType.CircuitBreaker,
      NodeType.LoadBalancer,
      NodeType.AppServer,
      NodeType.MessageQueue,
      // R30.1
      NodeType.AuthService,
    ],
    allowedProtocols: [EdgeProtocol.Sync, EdgeProtocol.Async],
  },
  [NodeType.ApiGateway]: {
    allowedTargets: [
      NodeType.RateLimiter,
      NodeType.CircuitBreaker,
      NodeType.LoadBalancer,
      NodeType.AppServer,
      // R30.2
      NodeType.AuthService,
      NodeType.AuthzService,
    ],
    allowedProtocols: [EdgeProtocol.Sync],
  },
  [NodeType.RateLimiter]: {
    allowedTargets: [NodeType.CircuitBreaker, NodeType.LoadBalancer, NodeType.AppServer],
    allowedProtocols: [EdgeProtocol.Sync],
  },
  [NodeType.LoadBalancer]: {
    allowedTargets: [NodeType.AppServer, NodeType.CircuitBreaker],
    allowedProtocols: [EdgeProtocol.Sync],
  },
  [NodeType.CircuitBreaker]: {
    allowedTargets: [
      NodeType.AppServer,
      NodeType.Database,
      NodeType.Cache,
      NodeType.MessageQueue,
    ],
    allowedProtocols: [EdgeProtocol.Sync, EdgeProtocol.Async],
  },
  [NodeType.AppServer]: {
    allowedTargets: [
      NodeType.Cache,
      NodeType.Database,
      NodeType.MessageQueue,
      NodeType.AppServer,
      NodeType.CircuitBreaker,
      // R30.5
      NodeType.AuthService,
      NodeType.AuthzService,
      NodeType.ObjectStore,
    ],
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
    // R30.6 adds WorkerPool
    allowedTargets: [NodeType.AppServer, NodeType.WorkerPool],
    allowedProtocols: [EdgeProtocol.Async],
  },

  // ─── Requirement 23–28 Node Types ──────────────────────────────

  /** R30.3 — Cache and Database are the complete permitted target set. */
  [NodeType.AuthService]: {
    allowedTargets: [NodeType.Cache, NodeType.Database],
    allowedProtocols: [EdgeProtocol.Sync],
  },
  /** R30.4 — Cache and Database are the complete permitted target set. */
  [NodeType.AuthzService]: {
    allowedTargets: [NodeType.Cache, NodeType.Database],
    allowedProtocols: [EdgeProtocol.Sync],
  },
  /**
   * R30.7 — these six are the complete permitted target set. `WorkerPool` is deliberately
   * absent from its own list, which is what rejects a Worker_Pool → Worker_Pool edge
   * through the pair table alone rather than through a special case.
   */
  [NodeType.WorkerPool]: {
    allowedTargets: [
      NodeType.Database,
      NodeType.Cache,
      NodeType.ObjectStore,
      NodeType.AppServer,
      NodeType.MessageQueue,
      NodeType.DeadLetterQueue,
    ],
    allowedProtocols: [EdgeProtocol.Sync, EdgeProtocol.Async],
  },
  /** R30.9 — Message_Queue and Worker_Pool, asynchronously, are the complete set. */
  [NodeType.DeadLetterQueue]: {
    allowedTargets: [NodeType.MessageQueue, NodeType.WorkerPool],
    allowedProtocols: [EdgeProtocol.Async],
  },
  /** R30.10 — terminal: an Object_Store node is a sink and has no permitted outgoing edge. */
  [NodeType.ObjectStore]: {
    allowedTargets: [],
    allowedProtocols: [],
  },
  /** R30.8 — these four are the complete permitted target set. */
  [NodeType.Scheduler]: {
    allowedTargets: [
      NodeType.MessageQueue,
      NodeType.WorkerPool,
      NodeType.AppServer,
      NodeType.ApiGateway,
    ],
    allowedProtocols: [EdgeProtocol.Sync, EdgeProtocol.Async],
  },
};

// ─── Per-Pair Protocol Overrides ─────────────────────────────────

type ConnectionPair = `${NodeType}->${NodeType}`;

/**
 * Pairs whose permitted protocol is narrower than the source type's `allowedProtocols`.
 *
 * `CONNECTION_RULES.allowedProtocols` is per *source type*, but R30.7 and R30.8 pin the
 * protocol per *pair*: a Worker_Pool reaches a Database synchronously and a Message_Queue
 * asynchronously, and a Scheduler splits the same way. The flat shape cannot express that,
 * so `getValidProtocols` consults this table first and only falls back to the flat set for
 * a pair no criterion narrows.
 *
 * Every pair R30.1–R30.9 names a specific protocol for appears here, including pairs whose
 * source type happens to permit only that one protocol anyway — an entry that agrees with
 * the flat set costs nothing and keeps the criteria auditable against one table.
 */
export const PROTOCOL_OVERRIDES: Partial<Record<ConnectionPair, EdgeProtocol[]>> = {
  // R30.1 — Traffic_Generator → Auth_Service is Synchronous, though the source type
  // permits both protocols for its other targets.
  [`${NodeType.TrafficGenerator}->${NodeType.AuthService}`]: [EdgeProtocol.Sync],

  // R30.2
  [`${NodeType.ApiGateway}->${NodeType.AuthService}`]: [EdgeProtocol.Sync],
  [`${NodeType.ApiGateway}->${NodeType.AuthzService}`]: [EdgeProtocol.Sync],

  // R30.3
  [`${NodeType.AuthService}->${NodeType.Cache}`]: [EdgeProtocol.Sync],
  [`${NodeType.AuthService}->${NodeType.Database}`]: [EdgeProtocol.Sync],

  // R30.4
  [`${NodeType.AuthzService}->${NodeType.Cache}`]: [EdgeProtocol.Sync],
  [`${NodeType.AuthzService}->${NodeType.Database}`]: [EdgeProtocol.Sync],

  // R30.5 — App_Server permits both protocols generally; these three are Synchronous only.
  [`${NodeType.AppServer}->${NodeType.AuthService}`]: [EdgeProtocol.Sync],
  [`${NodeType.AppServer}->${NodeType.AuthzService}`]: [EdgeProtocol.Sync],
  [`${NodeType.AppServer}->${NodeType.ObjectStore}`]: [EdgeProtocol.Sync],

  // R30.6
  [`${NodeType.MessageQueue}->${NodeType.WorkerPool}`]: [EdgeProtocol.Async],

  // R30.7 — the split that motivates this table.
  [`${NodeType.WorkerPool}->${NodeType.Database}`]: [EdgeProtocol.Sync],
  [`${NodeType.WorkerPool}->${NodeType.Cache}`]: [EdgeProtocol.Sync],
  [`${NodeType.WorkerPool}->${NodeType.ObjectStore}`]: [EdgeProtocol.Sync],
  [`${NodeType.WorkerPool}->${NodeType.AppServer}`]: [EdgeProtocol.Sync],
  [`${NodeType.WorkerPool}->${NodeType.MessageQueue}`]: [EdgeProtocol.Async],
  [`${NodeType.WorkerPool}->${NodeType.DeadLetterQueue}`]: [EdgeProtocol.Async],

  // R30.8 — the same split for a Scheduler.
  [`${NodeType.Scheduler}->${NodeType.MessageQueue}`]: [EdgeProtocol.Async],
  [`${NodeType.Scheduler}->${NodeType.WorkerPool}`]: [EdgeProtocol.Async],
  [`${NodeType.Scheduler}->${NodeType.AppServer}`]: [EdgeProtocol.Sync],
  [`${NodeType.Scheduler}->${NodeType.ApiGateway}`]: [EdgeProtocol.Sync],

  // R30.9
  [`${NodeType.DeadLetterQueue}->${NodeType.MessageQueue}`]: [EdgeProtocol.Async],
  [`${NodeType.DeadLetterQueue}->${NodeType.WorkerPool}`]: [EdgeProtocol.Async],
};

function pairKey(sourceType: NodeType, targetType: NodeType): ConnectionPair {
  return `${sourceType}->${targetType}`;
}

// ─── Edge Connection Validator ───────────────────────────────────

/**
 * Validates whether a proposed edge connection is allowed.
 * Called on drag-connect in the canvas and during JSON import.
 *
 * `nodesById` supplies the labels the R30.11 cardinality rejection has to name; it covers
 * the whole node set rather than just the two endpoints because that message identifies a
 * *third* node — the Dead_Letter_Queue the pool's existing edge already targets.
 */
export function validateEdgeConnection(
  source: SimulationNode,
  target: SimulationNode,
  protocol: EdgeProtocol,
  existingEdges: EdgeData[],
  nodesById: Map<string, SimulationNode>,
): ValidationResult {
  // Rule 1: No self-referencing edges (R30.14)
  if (source.id === target.id) {
    return { valid: false, reason: 'Self-referencing edges are not allowed.' };
  }

  // Rule 2: No duplicate edges (same source → same target) (R30.14)
  const duplicate = existingEdges.some(
    (e) => e.source === source.id && e.target === target.id,
  );
  if (duplicate) {
    return { valid: false, reason: 'A connection already exists between these nodes.' };
  }

  // Rule 3: R30.10 requires an Object_Store rejection to name the source type as
  // terminal, so it gets its own message ahead of the generic pair failure. Database is
  // also a sink but keeps the generic message it has carried since Requirement 2.
  const rules = CONNECTION_RULES[source.nodeType];
  if (source.nodeType === NodeType.ObjectStore) {
    return {
      valid: false,
      reason: `${source.nodeType} is a terminal node type and cannot have outgoing connections.`,
    };
  }

  // Rule 4: Check connection compatibility matrix (R30.12)
  if (!rules.allowedTargets.includes(target.nodeType)) {
    return {
      valid: false,
      reason: `${source.nodeType} cannot connect to ${target.nodeType}.`,
    };
  }

  // Rule 5: Protocol mismatch (R30.13) — the selected protocol must be in the pair's
  // permitted set, which the override table narrows for the R30.7/R30.8 pairs.
  const permitted = getValidProtocols(source.nodeType, target.nodeType);
  if (!permitted.includes(protocol)) {
    return {
      valid: false,
      reason:
        `${source.nodeType} cannot connect to ${target.nodeType} over ${protocol}. ` +
        `The permitted protocol for this pair is ${permitted.join(' or ')}.`,
    };
  }

  // Rule 6: Worker_Pool → Dead_Letter_Queue cardinality (R30.11) — at most one such
  // outgoing edge per Worker_Pool. Two distinct pools may target the same DLQ, so the
  // check is scoped to this source node rather than to the target.
  if (
    source.nodeType === NodeType.WorkerPool &&
    target.nodeType === NodeType.DeadLetterQueue
  ) {
    const existingDlqEdge = existingEdges.find(
      (e) =>
        e.source === source.id &&
        nodesById.get(e.target)?.nodeType === NodeType.DeadLetterQueue,
    );
    if (existingDlqEdge) {
      const heldDlqLabel =
        nodesById.get(existingDlqEdge.target)?.label ?? existingDlqEdge.target;
      return {
        valid: false,
        reason:
          `${source.label} already has a dead letter queue connection to ${heldDlqLabel}. ` +
          'A Worker Pool may have at most one outgoing Dead Letter Queue edge.',
      };
    }
  }

  return { valid: true };
}

// ─── Protocol Lookup ─────────────────────────────────────────────

/**
 * Returns valid protocols for a given source→target connection.
 * Returns an empty array if the connection itself is not allowed.
 *
 * Consults `PROTOCOL_OVERRIDES` before the source type's flat `allowedProtocols`, because
 * R30.7 and R30.8 pin protocol per pair rather than per source type.
 */
export function getValidProtocols(
  sourceType: NodeType,
  targetType: NodeType,
): EdgeProtocol[] {
  const rules = CONNECTION_RULES[sourceType];
  if (!rules.allowedTargets.includes(targetType)) {
    return [];
  }
  return PROTOCOL_OVERRIDES[pairKey(sourceType, targetType)] ?? rules.allowedProtocols;
}
