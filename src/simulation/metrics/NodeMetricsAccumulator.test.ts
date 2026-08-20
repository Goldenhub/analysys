import { describe, it, expect } from 'vitest';
import { NodeMetricsAccumulator } from './NodeMetricsAccumulator';

describe('NodeMetricsAccumulator', () => {
  it('returns empty metrics when no events recorded', () => {
    const acc = new NodeMetricsAccumulator('node-1', 5000);
    const metrics = acc.compute(1000);
    expect(metrics.L).toBe(0);
    expect(metrics.lambda).toBe(0);
    expect(metrics.W).toBe(0);
    expect(metrics.isStable).toBe(true);
  });

  it('tracks arrival and departure correctly', () => {
    const acc = new NodeMetricsAccumulator('node-1', 5000);

    acc.recordArrival('req-1', 100);
    expect(acc.getCurrentOccupancy()).toBe(1);

    acc.recordArrival('req-2', 200);
    expect(acc.getCurrentOccupancy()).toBe(2);

    acc.recordDeparture('req-1', 300);
    expect(acc.getCurrentOccupancy()).toBe(1);

    acc.recordDeparture('req-2', 400);
    expect(acc.getCurrentOccupancy()).toBe(0);
  });

  it('computes lambda (arrival rate) correctly', () => {
    const acc = new NodeMetricsAccumulator('node-1', 5000);

    // 10 arrivals over 1000ms = 10 per second
    for (let i = 0; i < 10; i++) {
      acc.recordArrival(`req-${i}`, i * 100);
      acc.recordDeparture(`req-${i}`, i * 100 + 50);
    }

    const metrics = acc.compute(1000);
    expect(metrics.lambda).toBeGreaterThan(8);
    expect(metrics.lambda).toBeLessThan(12);
  });

  it('computes W (sojourn time) correctly', () => {
    const acc = new NodeMetricsAccumulator('node-1', 5000);

    // Each request stays for exactly 100ms
    for (let i = 0; i < 10; i++) {
      acc.recordArrival(`req-${i}`, i * 200);
      acc.recordDeparture(`req-${i}`, i * 200 + 100);
    }

    const metrics = acc.compute(2000);
    // Average sojourn time should be ~100ms
    expect(metrics.W).toBeGreaterThan(90);
    expect(metrics.W).toBeLessThan(110);
  });

  it('validates Little\'s Law (L ≈ λ × W) under steady state', () => {
    const acc = new NodeMetricsAccumulator('node-1', 10000);

    // Simulate steady state: 100 req/sec, each staying 50ms → L ≈ 5
    const arrivalRate = 100; // per second
    const sojournMs = 50;
    const duration = 10000; // ms
    const interArrival = 1000 / arrivalRate; // 10ms

    for (let t = 0; t < duration; t += interArrival) {
      acc.recordArrival(`req-${t}`, t);
      acc.recordDeparture(`req-${t}`, t + sojournMs);
    }

    const metrics = acc.compute(duration);

    // L should be approximately arrivalRate * sojournMs / 1000 = 100 * 0.05 = 5
    const expectedL = arrivalRate * (sojournMs / 1000);
    const lambdaW = metrics.lambda * (metrics.W / 1000);

    // Verify Little's Law holds within reasonable tolerance
    // Note: with sliding window approximation, we accept wider tolerance
    expect(metrics.lambda).toBeGreaterThan(arrivalRate * 0.8);
    expect(metrics.W).toBeGreaterThan(sojournMs * 0.8);
    expect(metrics.W).toBeLessThan(sojournMs * 1.2);

    // L ≈ λW should hold
    if (metrics.L > 0.1) {
      expect(Math.abs(metrics.L - lambdaW) / Math.max(metrics.L, lambdaW)).toBeLessThan(0.5);
    }

    // The computed L should be in the right ballpark
    expect(metrics.L).toBeGreaterThan(expectedL * 0.3);
    expect(metrics.L).toBeLessThan(expectedL * 3);
  });

  it('reset clears all state', () => {
    const acc = new NodeMetricsAccumulator('node-1', 5000);
    acc.recordArrival('req-1', 100);
    acc.reset();

    expect(acc.getCurrentOccupancy()).toBe(0);
    const metrics = acc.compute(200);
    expect(metrics.L).toBe(0);
    expect(metrics.lambda).toBe(0);
  });

  it('occupancy never goes below zero', () => {
    const acc = new NodeMetricsAccumulator('node-1', 5000);
    acc.recordDeparture('phantom', 100);
    expect(acc.getCurrentOccupancy()).toBe(0);
  });
});
