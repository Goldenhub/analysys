import { describe, it, expect } from 'vitest';
import { appendTelemetryPoint, MAX_TELEMETRY_POINTS } from './telemetryBuffer';

interface Point {
  time: number;
  value: number;
}

const p = (time: number, value = time): Point => ({ time, value });

describe('appendTelemetryPoint', () => {
  it('appends points in order', () => {
    let buffer: Point[] = [];
    buffer = appendTelemetryPoint(buffer, p(0));
    buffer = appendTelemetryPoint(buffer, p(500));
    expect(buffer).toEqual([p(0), p(500)]);
  });

  it('drops same-tick duplicates', () => {
    let buffer: Point[] = [p(0), p(500)];
    buffer = appendTelemetryPoint(buffer, p(500, 999));
    expect(buffer).toHaveLength(2);
    // Original point preserved
    expect(buffer[1]!.value).toBe(500);
  });

  it('caps the buffer at the maximum size', () => {
    let buffer: Point[] = [];
    for (let i = 0; i < MAX_TELEMETRY_POINTS + 25; i++) {
      buffer = appendTelemetryPoint(buffer, p(i * 100));
    }
    expect(buffer).toHaveLength(MAX_TELEMETRY_POINTS);
    expect(buffer[0]!.time).toBe(25 * 100);
  });

  it('resets the buffer when a new run rewinds the clock', () => {
    let buffer: Point[] = [p(0), p(1000), p(2000)];
    buffer = appendTelemetryPoint(buffer, p(500));
    expect(buffer).toEqual([p(500)]);
  });

  it('supports a custom max size', () => {
    let buffer: Point[] = [];
    for (let i = 0; i < 5; i++) {
      buffer = appendTelemetryPoint(buffer, p(i), 3);
    }
    expect(buffer).toHaveLength(3);
  });
});
