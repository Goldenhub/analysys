import { describe, it, expect } from 'vitest';
import { RunCumulativeAccumulator } from './RunCumulativeAccumulator';
import { SeededRNG } from '../prng';
import type { SimRequest } from '../types';
import { RequestStatus } from '../types';

function makeRequest(id: string, latencyMs: number): SimRequest {
  return {
    id,
    originNodeId: 'gen-1',
    createdAt: 0,
    status: RequestStatus.Success,
    hopCount: 1,
    maxHops: 20,
    path: ['gen-1', 'app-1'],
    accumulatedLatencyMs: latencyMs,
    fanOutDepth: 0,
    emittedByNodeId: 'gen-1',
  };
}

/** Feed >10k successful terminations so reservoir replacement kicks in. */
function fill(seed: number, count: number): RunCumulativeAccumulator {
  const rng = new SeededRNG(seed);
  const accumulator = new RunCumulativeAccumulator(() => rng.next());
  for (let i = 0; i < count; i++) {
    accumulator.recordTermination(makeRequest(`req-${i}`, i), RequestStatus.Success, i);
  }
  return accumulator;
}

describe('RunCumulativeAccumulator', () => {
  it('reservoir percentiles are identical for identical rng seeds', () => {
    expect(fill(1234, 20_000).getLatencyPercentiles()).toEqual(fill(1234, 20_000).getLatencyPercentiles());
  });

  it('reservoir contents diverge across different rng seeds', () => {
    const a = fill(1234, 20_000).getLatencyPercentiles();
    const b = fill(4321, 20_000).getLatencyPercentiles();
    // With 10k replacements over a deterministic but distinct sequence, the two
    // reservoirs almost surely hold different samples.
    expect(a).not.toEqual(b);
  });
});
