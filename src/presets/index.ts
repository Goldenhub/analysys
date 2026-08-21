import type { SimulationNode } from '@/types/nodes';
import type { EdgeData } from '@/types/edges';
import type { ChaosEventPayload } from '@/types/messages';

import dbExhaustionData from './dbExhaustion.json';
import queueBackpressureData from './queueBackpressure.json';
import cacheStampedeData from './cacheStampede.json';

// ─── Preset Schema ───────────────────────────────────────────────

export interface ChaosTimelineEntry {
  timeMs: number;
  event: ChaosEventPayload;
}

export interface PresetTopology {
  schemaVersion: number;
  name: string;
  description: string;
  createdAt: string;
  topology: {
    nodes: SimulationNode[];
    edges: EdgeData[];
  };
  chaosTimeline: ChaosTimelineEntry[];
}

// ─── Exported Presets ────────────────────────────────────────────

export const presets: PresetTopology[] = [
  dbExhaustionData as unknown as PresetTopology,
  queueBackpressureData as unknown as PresetTopology,
  cacheStampedeData as unknown as PresetTopology,
];

export function getPresetByName(name: string): PresetTopology | undefined {
  return presets.find((p) => p.name === name);
}
