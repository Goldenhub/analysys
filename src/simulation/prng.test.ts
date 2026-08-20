import { describe, it, expect } from 'vitest';
import { SeededRNG } from './prng';

describe('SeededRNG', () => {
  it('produces deterministic sequences from the same seed', () => {
    const rng1 = new SeededRNG(12345);
    const rng2 = new SeededRNG(12345);

    const seq1 = Array.from({ length: 100 }, () => rng1.next());
    const seq2 = Array.from({ length: 100 }, () => rng2.next());

    expect(seq1).toEqual(seq2);
  });

  it('produces different sequences for different seeds', () => {
    const rng1 = new SeededRNG(1);
    const rng2 = new SeededRNG(2);

    const seq1 = Array.from({ length: 10 }, () => rng1.next());
    const seq2 = Array.from({ length: 10 }, () => rng2.next());

    expect(seq1).not.toEqual(seq2);
  });

  it('produces values in [0, 1)', () => {
    const rng = new SeededRNG(42);
    for (let i = 0; i < 10000; i++) {
      const val = rng.next();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });

  it('uniform distribution has expected mean (~0.5)', () => {
    const rng = new SeededRNG(99);
    const samples = Array.from({ length: 10000 }, () => rng.next());
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    // Should be within 5% of 0.5
    expect(mean).toBeGreaterThan(0.475);
    expect(mean).toBeLessThan(0.525);
  });

  it('normal distribution has expected mean', () => {
    const rng = new SeededRNG(7);
    const targetMean = 50;
    const targetStdDev = 10;
    const samples = Array.from({ length: 10000 }, () => rng.normal(targetMean, targetStdDev));
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    // Within 5% of target
    expect(mean).toBeGreaterThan(targetMean * 0.95);
    expect(mean).toBeLessThan(targetMean * 1.05);
  });

  it('normal distribution has expected standard deviation', () => {
    const rng = new SeededRNG(13);
    const targetMean = 100;
    const targetStdDev = 20;
    const samples = Array.from({ length: 10000 }, () => rng.normal(targetMean, targetStdDev));
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const variance = samples.reduce((sum, x) => sum + (x - mean) ** 2, 0) / samples.length;
    const stdDev = Math.sqrt(variance);
    // Within 10% of target
    expect(stdDev).toBeGreaterThan(targetStdDev * 0.9);
    expect(stdDev).toBeLessThan(targetStdDev * 1.1);
  });

  it('exponential distribution produces non-negative values', () => {
    const rng = new SeededRNG(55);
    for (let i = 0; i < 1000; i++) {
      const val = rng.exponential(0.1);
      expect(val).toBeGreaterThanOrEqual(0);
    }
  });

  it('exponential distribution has expected mean (1/rate)', () => {
    const rng = new SeededRNG(77);
    const rate = 0.5; // expected mean = 2
    const samples = Array.from({ length: 10000 }, () => rng.exponential(rate));
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const expectedMean = 1 / rate;
    expect(mean).toBeGreaterThan(expectedMean * 0.9);
    expect(mean).toBeLessThan(expectedMean * 1.1);
  });

  it('normalPositive never returns negative values', () => {
    const rng = new SeededRNG(33);
    for (let i = 0; i < 10000; i++) {
      const val = rng.normalPositive(5, 10); // high stddev relative to mean
      expect(val).toBeGreaterThanOrEqual(0);
    }
  });

  it('poisson distribution has expected mean', () => {
    const rng = new SeededRNG(101);
    const lambda = 5;
    const samples = Array.from({ length: 5000 }, () => rng.poisson(lambda));
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(mean).toBeGreaterThan(lambda * 0.85);
    expect(mean).toBeLessThan(lambda * 1.15);
  });
});
