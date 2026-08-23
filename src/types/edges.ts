import type { Edge as RFEdge } from '@xyflow/react';

/** Communication protocol for edges between nodes. */
export enum EdgeProtocol {
  Sync = 'SYNC',
  Async = 'ASYNC',
}

/**
 * Data associated with a topology edge (connection between nodes).
 *
 * The serialized edge array's order *is* the stored index the routing policies of
 * Requirement 32 are defined over: `buildAdjacency` yields a node's outgoing edges in
 * ascending stored index order, and Weighted/RoundRobin selection breaks ties on that
 * index. Persistence — save, load, export, import — must therefore preserve edge array
 * order, or an unchanged topology will route differently after a round trip.
 */
export interface EdgeData {
  id: string;
  source: string;
  target: string;
  protocol: EdgeProtocol;
  /** R32.4 — relative share under the Weighted routing policy. Defaults to 1.0. */
  weight: number;
}

/** React Flow edge wrapper for EdgeData. */
export type AnalysysEdge = RFEdge<Record<string, unknown> & EdgeData>;
