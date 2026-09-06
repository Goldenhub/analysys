import { describe, it, expect } from 'vitest';
import { TrafficGeneratorProcessor } from './processors/TrafficGeneratorProcessor';
import { SeededRNG } from './prng';
import { Distribution } from '@/types/nodes';

/**
 * Guards the offered-load math: a generator configured for N RPS must actually
 * emit ~N requests/sec. The POISSON path historically multiplied its already-
 * millisecond sample by 1000 again, silently running 800-RPS presets at ~0.8 RPS
 * (every dashboard reading near zero) — invisible as long as tests used UNIFORM.
 */
describe('TrafficGenerator inter-arrival scaling', () => {
  const processor = (rps: number, distribution: Distribution) =>
    new TrafficGeneratorProcessor({
      rps,
      distribution,
      spikeMultiplier: 1,
      spikeDurationSec: 0,
    });

  function meanInterArrivalMs(rps: number, distribution: Distribution): number {
    const rng = new SeededRNG(7);
    const p = processor(rps, distribution);
    const samples = Array.from({ length: 5000 }, () => p.computeInterArrival(rng));
    return samples.reduce((a, b) => a + b, 0) / samples.length;
  }

  it('POISSON mean inter-arrival is 1000/rps milliseconds', () => {
    expect(meanInterArrivalMs(800, Distribution.Poisson)).toBeCloseTo(1000 / 800, 0);
    expect(meanInterArrivalMs(50, Distribution.Poisson)).toBeCloseTo(1000 / 50, 0);
  });

  it('UNIFORM mean inter-arrival is 1000/rps milliseconds', () => {
    expect(meanInterArrivalMs(100, Distribution.Uniform)).toBeCloseTo(10, 1);
  });

  it('spike multiplier scales the offered rate', () => {
    const rng = new SeededRNG(7);
    const p = processor(100, Distribution.Poisson);
    // Simulate chaos-applied spike: effective rps becomes 500
    p.onChaosApplied('SPIKE_TRAFFIC', { multiplier: 5 });
    const samples = Array.from({ length: 5000 }, () => p.computeInterArrival(rng));
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(mean).toBeCloseTo(2, 0); // 1000/500 = 2ms
  });
});
