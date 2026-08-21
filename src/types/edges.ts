import type { Edge as RFEdge } from '@xyflow/react';

/** Communication protocol for edges between nodes. */
export enum EdgeProtocol {
  Sync = 'SYNC',
  Async = 'ASYNC',
}

/** Data associated with a topology edge (connection between nodes). */
export interface EdgeData {
  id: string;
  source: string;
  target: string;
  protocol: EdgeProtocol;
}

/** React Flow edge wrapper for EdgeData. */
export type AnalysysEdge = RFEdge<Record<string, unknown> & EdgeData>;
