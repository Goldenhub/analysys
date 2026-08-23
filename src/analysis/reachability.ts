/**
 * Reachability Analysis and Single Point of Failure Detection — Requirement 39
 *
 * Purely structural analysis over the directed graph.
 * - Ignores: edge protocol, weight, routing policy, Subsystem_Group state.
 * - Sources: Traffic_Generator and Scheduler nodes.
 * - Terminals: out-degree-0 nodes (type-independent).
 * - SPOF: removing a candidate leaves at least one source with 0 reachable terminals
 *   (having had >=1 in the intact graph). Per-source test, stricter than global disconnection.
 *
 * Yields every 8 candidates so main-thread occupancy stays at or below ~33 ms.
 */

import { NodeType } from '@/types/nodes';
import type { SimulationNode } from '@/types/nodes';
import type { EdgeData } from '@/types/edges';

// ─── Constants ───────────────────────────────────────────────────

/** Yield every N candidates to keep main-thread occupancy <=33ms. */
const YIELD_BATCH_SIZE = 8;

// ─── Types ───────────────────────────────────────────────────────

export interface SpofDesignation {
  /** The node designated as a Single Point of Failure. */
  nodeId: string;
  /** Source node IDs whose reachable terminal set becomes empty when this node is removed. */
  losingSources: string[];
  /** Count of distinct nodes holding an edge INTO this node (fan-in). */
  fanIn: number;
}

export interface ReachabilityResult {
  /** Nodes identified as sources (Traffic_Generator or Scheduler). */
  sourceIds: string[];
  /** Nodes identified as terminals (out-degree 0). */
  terminalIds: string[];
  /** Nodes designated as SPOFs. */
  spofs: SpofDesignation[];
  /** Sources that have 0 reachable terminals in the baseline (before any removal). */
  unreachableSources: string[];
  /** Nodes excluded from candidate consideration (sources). */
  excludedFromCandidates: string[];
}

// ─── Adjacency Helpers ───────────────────────────────────────────

function buildOutAdjacency(edges: EdgeData[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const edge of edges) {
    let list = adj.get(edge.source);
    if (!list) {
      list = [];
      adj.set(edge.source, list);
    }
    list.push(edge.target);
  }
  return adj;
}

function buildInAdjacency(edges: EdgeData[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const edge of edges) {
    let set = adj.get(edge.target);
    if (!set) {
      set = new Set();
      adj.set(edge.target, set);
    }
    set.add(edge.source);
  }
  return adj;
}

// ─── BFS ─────────────────────────────────────────────────────────

/**
 * BFS from a source node, skipping `excludeNode` and any edge incident to it.
 * Returns the set of terminal nodes reachable.
 */
function bfsReachableTerminals(
  sourceId: string,
  outAdj: Map<string, string[]>,
  terminalSet: Set<string>,
  excludeNode: string | null,
): Set<string> {
  if (excludeNode === sourceId) return new Set();

  const visited = new Set<string>();
  const queue: string[] = [sourceId];
  visited.add(sourceId);

  const reachableTerminals = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (terminalSet.has(current)) {
      reachableTerminals.add(current);
    }

    const neighbors = outAdj.get(current);
    if (!neighbors) continue;

    for (const neighbor of neighbors) {
      if (neighbor === excludeNode) continue;
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      queue.push(neighbor);
    }
  }

  return reachableTerminals;
}

// ─── Main Reachability Generator ─────────────────────────────────

/**
 * Generator that computes SPOF designations over the topology graph.
 * Yields every `YIELD_BATCH_SIZE` candidates for cooperative scheduling.
 *
 * Produces results whether or not a simulation run has completed (R39.1).
 */
export function* computeSpofs(
  nodes: SimulationNode[],
  edges: EdgeData[],
): Generator<void, ReachabilityResult, void> {
  const outAdj = buildOutAdjacency(edges);
  const inAdj = buildInAdjacency(edges);

  // Identify sources and terminals
  const sourceIds: string[] = [];
  const terminalIds: string[] = [];
  const allNodeIds = new Set<string>();

  for (const node of nodes) {
    allNodeIds.add(node.id);
    if (node.nodeType === NodeType.TrafficGenerator || node.nodeType === NodeType.Scheduler) {
      sourceIds.push(node.id);
    }
  }

  // Terminals = out-degree 0 (nodes with no outgoing edges)
  for (const node of nodes) {
    const outNeighbors = outAdj.get(node.id);
    if (!outNeighbors || outNeighbors.length === 0) {
      terminalIds.push(node.id);
    }
  }

  const terminalSet = new Set(terminalIds);
  const sourceSet = new Set(sourceIds);

  // Compute baseline reachable terminal sets per source
  const baseline = new Map<string, Set<string>>();
  for (const srcId of sourceIds) {
    baseline.set(srcId, bfsReachableTerminals(srcId, outAdj, terminalSet, null));
  }

  // Identify sources with 0 reachable terminals at baseline
  const unreachableSources: string[] = [];
  for (const srcId of sourceIds) {
    if (baseline.get(srcId)!.size === 0) {
      unreachableSources.push(srcId);
    }
  }

  // Candidates = every node that is not a source
  const candidates: string[] = [];
  for (const node of nodes) {
    if (!sourceSet.has(node.id)) {
      candidates.push(node.id);
    }
  }

  // For each candidate, check if removing it makes any source lose all terminals
  const spofs: SpofDesignation[] = [];
  let processed = 0;

  for (const candidateId of candidates) {
    const losingSources: string[] = [];

    for (const srcId of sourceIds) {
      const baselineTerminals = baseline.get(srcId)!;
      if (baselineTerminals.size === 0) continue; // Already unreachable at baseline

      const reachable = bfsReachableTerminals(srcId, outAdj, terminalSet, candidateId);
      if (reachable.size === 0) {
        losingSources.push(srcId);
      }
    }

    if (losingSources.length > 0) {
      // Compute fan-in: distinct nodes holding an edge INTO the subject
      const incomingNodes = inAdj.get(candidateId);
      const fanIn = incomingNodes ? incomingNodes.size : 0;

      spofs.push({
        nodeId: candidateId,
        losingSources,
        fanIn,
      });
    }

    processed++;
    if (processed % YIELD_BATCH_SIZE === 0) {
      yield; // Yield to scheduler every 8 candidates
    }
  }

  return {
    sourceIds,
    terminalIds,
    spofs,
    unreachableSources,
    excludedFromCandidates: sourceIds,
  };
}

/**
 * Non-generator wrapper for synchronous use in tests or single-pass contexts.
 */
export function computeSpofsSync(
  nodes: SimulationNode[],
  edges: EdgeData[],
): ReachabilityResult {
  const gen = computeSpofs(nodes, edges);
  let result = gen.next();
  while (!result.done) {
    result = gen.next();
  }
  return result.value;
}
