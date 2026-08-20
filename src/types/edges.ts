import type { Edge as RFEdge } from '@xyflow/react';

export enum EdgeProtocol {
  Sync = 'SYNC',
  Async = 'ASYNC',
}

export interface EdgeData {
  id: string;
  source: string;
  target: string;
  protocol: EdgeProtocol;
}

export type AnalysysEdge = RFEdge<Record<string, unknown> & EdgeData>;
