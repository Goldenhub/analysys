/**
 * Half-up rounding at 6 decimal places.
 *
 * Negatives are handled explicitly so the rounding direction is uniformly
 * half-up (towards +∞ at the midpoint) rather than the default Math.round
 * behaviour of half-away-from-zero for negatives.
 *
 * The result is asserted finite — a non-finite input throws.
 */
export class AnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalysisError';
  }
}

export function round6(x: number): number {
  if (!Number.isFinite(x)) {
    throw new AnalysisError('non-finite value in Finding');
  }
  const scaled = x * 1e6;
  const rounded = x < 0 ? -Math.round(-scaled) : Math.round(scaled);
  const result = rounded / 1e6;
  // Final assertion — belt-and-suspenders for any edge case
  if (!Number.isFinite(result)) {
    throw new AnalysisError('non-finite value in Finding');
  }
  // Normalize -0 to 0
  return result === 0 ? 0 : result;
}
