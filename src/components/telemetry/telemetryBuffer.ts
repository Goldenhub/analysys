/**
 * Shared bounded buffer for telemetry chart points.
 *
 * Two properties matter:
 *  - Same-tick batches are dropped (metrics can repeat a timestamp).
 *  - A point whose time is EARLIER than the last buffered point means a new run
 *    started (virtual clocks begin at 0) — the buffer resets instead of letting
 *    the new run's points interleave with the previous run's tail.
 */
export const MAX_TELEMETRY_POINTS = 120;

export function appendTelemetryPoint<T extends { time: number }>(
  buffer: T[],
  point: T,
  maxSize: number = MAX_TELEMETRY_POINTS,
): T[] {
  const last = buffer[buffer.length - 1];
  if (last && last.time === point.time) return buffer;
  if (last && point.time < last.time) return [point];
  return [...buffer, point].slice(-maxSize);
}
