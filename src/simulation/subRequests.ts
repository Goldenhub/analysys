/**
 * Sub-Request Dispatch & Settle Mechanism (Requirement 32)
 *
 * One shared mechanism used by Fan_Out, Auth_Introspection, and Authz_Lookup.
 * Branches are full SimRequests with their own path rooted at the dispatch node.
 */
import type { EdgeData } from '@/types/edges';
import { EdgeProtocol } from '@/types/edges';
import type { SimRequest, ProcessorContext } from './types';
import { SimEventType, RequestStatus, SubRequestPolicy } from './types';

// ─── Branch Dispatch ─────────────────────────────────────────────

export interface DispatchOptions {
  /** The parent request dispatching branches. */
  parent: SimRequest;
  /** The node where the fan-out is happening. */
  dispatchNodeId: string;
  /** The edges to dispatch branches along (in ascending stored index order). */
  edges: EdgeData[];
  /** The policy governing failure mapping. */
  policy: SubRequestPolicy;
  /** Current simulation time. */
  timestamp: number;
  /** ProcessorContext for scheduling events and creating requests. */
  context: ProcessorContext;
  /** Engine-level request map for registering branches. */
  requestMap: Map<string, SimRequest>;
  /** Engine-level request counter reference. */
  getNextRequestId: () => string;
}

/**
 * Dispatches one branch per edge at a single simulated timestamp.
 * Each branch is a full SimRequest with:
 *   - path = [dispatchNodeId]
 *   - hopCount copied from the parent
 *   - fanOutDepth = parent's depth + 1
 *   - settleOnAccept = true for Async edges
 *
 * The parent is suspended until all branches settle.
 * Returns the branch IDs created.
 */
export function dispatchBranches(options: DispatchOptions): string[] {
  const {
    parent,
    dispatchNodeId,
    edges,
    policy,
    timestamp,
    context,
    requestMap,
    getNextRequestId,
  } = options;

  // Initialize parent's pending branch tracking
  parent.pendingBranchIds = new Set<string>();
  parent.maxBranchSettleMs = 0;
  parent.branchPolicy = policy;

  const branchIds: string[] = [];

  for (const edge of edges) {
    const branchId = getNextRequestId();
    const isAsync = edge.protocol === EdgeProtocol.Async;

    const branch: SimRequest = {
      id: branchId,
      originNodeId: parent.originNodeId,
      createdAt: timestamp,
      status: RequestStatus.InFlight,
      hopCount: parent.hopCount, // Shared budget
      maxHops: parent.maxHops,
      path: [dispatchNodeId],
      accumulatedLatencyMs: 0,
      fanOutDepth: parent.fanOutDepth + 1,
      emittedByNodeId: parent.emittedByNodeId,

      // Branch lineage
      parentRequestId: parent.id,
      dispatchedAtNodeId: dispatchNodeId,
      dispatchedAtMs: timestamp,
      settleOnAccept: isAsync,
    };

    requestMap.set(branchId, branch);
    parent.pendingBranchIds.add(branchId);
    branchIds.push(branchId);

    // Schedule the branch to route to its target node
    context.scheduleEvent({
      type: SimEventType.RequestRoute,
      timestamp,
      nodeId: edge.target,
      requestId: branchId,
      payload: { fromNodeId: dispatchNodeId, branchEdgeIndex: edges.indexOf(edge) },
    });
  }

  return branchIds;
}

// ─── Branch Settlement ───────────────────────────────────────────

export interface SettleResult {
  /** Whether the parent should resume (all branches settled successfully). */
  parentResumes: boolean;
  /** Whether a failure occurred and the parent was terminated. */
  parentTerminated: boolean;
  /** The IDs of siblings that were discarded due to failure. */
  discardedSiblings: string[];
}

/**
 * Handles a branch reaching settlement (success or failure).
 * Called from the SubRequestSettled event handler.
 *
 * On success: accumulates maxBranchSettleMs, removes from pendingBranchIds.
 *   When the last branch settles, adds the max settle time to the parent's latency.
 *
 * On failure: applies the branchPolicy to determine the parent's terminal status,
 *   marks unsettled siblings as discarded.
 */
export function settleBranch(
  branch: SimRequest,
  parent: SimRequest,
  requestMap: Map<string, SimRequest>,
  timestamp: number,
): SettleResult {
  if (!parent.pendingBranchIds) {
    return { parentResumes: false, parentTerminated: false, discardedSiblings: [] };
  }

  // Calculate settle duration
  const settleMs = timestamp - (branch.dispatchedAtMs ?? timestamp);
  parent.maxBranchSettleMs = Math.max(parent.maxBranchSettleMs ?? 0, settleMs);

  // Remove this branch from pending
  parent.pendingBranchIds.delete(branch.id);

  // Check for failure
  if (branch.status !== RequestStatus.Success && branch.status !== RequestStatus.InFlight) {
    // Branch failed — apply policy
    const discardedSiblings = discardUnsettledSiblings(parent, branch.id, requestMap);

    return {
      parentResumes: false,
      parentTerminated: true,
      discardedSiblings,
    };
  }

  // Check if all branches have settled
  if (parent.pendingBranchIds.size === 0) {
    // All branches settled successfully — add max settle time to parent's latency
    parent.accumulatedLatencyMs += parent.maxBranchSettleMs ?? 0;
    return {
      parentResumes: true,
      parentTerminated: false,
      discardedSiblings: [],
    };
  }

  // Still waiting for other branches
  return { parentResumes: false, parentTerminated: false, discardedSiblings: [] };
}

/**
 * Maps a branch failure to the parent's terminal status per branchPolicy.
 *
 * - FanOut: propagates the branch's status
 * - AuthIntrospection: maps to Unauthenticated
 * - AuthzLookup: propagates the branch's status
 */
export function mapBranchFailureToParent(
  branch: SimRequest,
  policy: SubRequestPolicy,
): RequestStatus {
  switch (policy) {
    case SubRequestPolicy.FanOut:
      return branch.status;
    case SubRequestPolicy.AuthIntrospection:
      return RequestStatus.Unauthenticated;
    case SubRequestPolicy.AuthzLookup:
      return branch.status;
  }
}

/**
 * Marks every unsettled sibling of a failed branch as `isDiscarded`.
 * Discarded siblings are counted under no terminal status.
 */
function discardUnsettledSiblings(
  parent: SimRequest,
  failedBranchId: string,
  requestMap: Map<string, SimRequest>,
): string[] {
  const discarded: string[] = [];
  if (!parent.pendingBranchIds) return discarded;

  for (const siblingId of parent.pendingBranchIds) {
    if (siblingId === failedBranchId) continue;
    const sibling = requestMap.get(siblingId);
    if (sibling) {
      sibling.isDiscarded = true;
      discarded.push(siblingId);
    }
  }

  // Clear pending — parent is being terminated
  parent.pendingBranchIds.clear();
  return discarded;
}
