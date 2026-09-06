import type { SimulationNode } from '@/types/nodes';
import type { EdgeData } from '@/types/edges';
import type { ChaosEventPayload } from '@/types/messages';
import type { RequestStatus } from '@/simulation/types';

import dbExhaustionData from './dbExhaustion.json';
import queueBackpressureData from './queueBackpressure.json';
import cacheStampedeData from './cacheStampede.json';
import authenticatedWebApiData from './authenticatedWebApi.json';
import asyncJobPlatformData from './asyncJobPlatform.json';
import scheduledBatchWithLiveTrafficData from './scheduledBatchWithLiveTraffic.json';

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

// ─── Reference Architecture Preset (schema v2) ───────────────────

/**
 * Extended preset type for reference architectures (Requirement 42).
 * Stores all the metadata needed to auto-start the simulation with the correct
 * parameters and to assert expected analysis outcomes. (The former
 * `subsystemGroups` field was removed with the group system.)
 */
export interface ReferencePreset extends PresetTopology {
  schemaVersion: 2;
  seed: number;
  simulatedDurationMs: number;
  speedMultiplier: number;
  totalOfferedRps: number;
  expectedBottleneckNodeId: string;
  expectedDominantTerminalStatus: RequestStatus;
}

/** Type guard distinguishing reference architecture presets from failure-mode presets. */
export function isReferencePreset(preset: PresetTopology): preset is ReferencePreset {
  return preset.schemaVersion === 2 && 'seed' in preset;
}

// ─── Exported Presets ────────────────────────────────────────────

/** Failure-mode demo presets (schema v1). */
export const failureModePresets: PresetTopology[] = [
  dbExhaustionData as unknown as PresetTopology,
  queueBackpressureData as unknown as PresetTopology,
  cacheStampedeData as unknown as PresetTopology,
];

/** Reference architecture presets (schema v2). */
export const referencePresets: ReferencePreset[] = [
  authenticatedWebApiData as unknown as ReferencePreset,
  asyncJobPlatformData as unknown as ReferencePreset,
  scheduledBatchWithLiveTrafficData as unknown as ReferencePreset,
];

/** All presets for backward compatibility. */
export const presets: PresetTopology[] = [...failureModePresets, ...referencePresets];

export function getPresetByName(name: string): PresetTopology | undefined {
  return presets.find((p) => p.name === name);
}
